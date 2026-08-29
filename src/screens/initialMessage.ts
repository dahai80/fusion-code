// audit 1.1.1 slice #31: processInitialMessage useEffect body 外移 (PURE-ASYNC-HELPER).
// REPL() initial-message effect 的 3 阶段异步流程: clearContext → applyPermissions → routeMessage.
// 闭包依赖经 ctx 传入 (refs/setters/funcs), 导入型 helper 直接 import, 行为字节等价。
// 无 JSX/无 hook/无复杂返回 (void, 单次调用, replay 风险低 — 区别于 #18 getToolUseContext 39-field 返回)。

import type { UUID } from "crypto";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { getSessionId } from "../bootstrap/state.js";
import { buildPermissionUpdates } from "../components/permissions/ExitPlanModePermissionRequest/ExitPlanModePermissionRequest.js";
import type { AppState } from "../state/AppStateStore.js";
import type { SetAppState } from "../Task.js";
import type { AllowedPrompt } from "../tools/ExitPlanModeTool/ExitPlanModeV2Tool.js";
import type { UserMessage } from "../types/message.js";
import { createAbortController } from "../utils/abortController.js";
import { isInternalBuild } from "../utils/buildConstants.js";
import { isEnvTruthy } from "../utils/envUtils.js";
import {
	type FileHistoryState,
	fileHistoryEnabled,
	fileHistoryMakeSnapshot,
} from "../utils/fileHistory.js";
import type { FileStateCache } from "../utils/fileStateCache.js";
import type { PermissionMode } from "../utils/permissions/PermissionMode.js";
import { applyPermissionUpdates } from "../utils/permissions/PermissionUpdate.js";
import { stripDangerousPermissionsForAutoMode } from "../utils/permissions/permissionSetup.js";
import { getPlanSlug, setPlanSlug } from "../utils/plans.js";

export type InitialMessage = {
	message: UserMessage;
	clearContext?: boolean;
	mode?: PermissionMode;
	allowedPrompts?: AllowedPrompt[];
};

type OnQueryFn = (
	msgs: unknown[],
	abort: unknown,
	shouldQuery: boolean,
	additionalAllowedTools: unknown[],
	model: string,
) => void;

type OnSubmitFn = (
	input: string,
	helpers: {
		setCursorOffset: (n: number) => void;
		clearBuffer: () => void;
		resetHistory: () => void;
	},
) => void;

export type ProcessInitialMessageCtx = {
	// refs (closure-captured state)
	haikuTitleAttemptedRef: MutableRefObject<boolean>;
	bashTools: MutableRefObject<Set<string>>;
	bashToolsProcessedIdx: MutableRefObject<number>;
	discoveredSkillNamesRef: MutableRefObject<Set<string>>;
	loadedNestedMemoryPathsRef: MutableRefObject<Set<string>>;
	readFileState: MutableRefObject<FileStateCache>;
	// setters
	setMessages: (updater: SetStateAction<unknown[]>) => void;
	setAppState: SetAppState;
	setConversationId: Dispatch<SetStateAction<UUID>>;
	setHaikuTitle: (t: string | undefined) => void;
	setAbortController: (c: unknown) => void;
	// funcs
	onQuery: OnQueryFn;
	onSubmit: OnSubmitFn;
	awaitPendingHooks: () => Promise<void>;
	getAppState: () => AppState;
	mainLoopModel: string;
	// effect-local guard ref (set true before call, reset on delay inside)
	initialMessageRef: MutableRefObject<boolean>;
};

export async function applyInitialMessage(
	initialMsg: InitialMessage,
	ctx: ProcessInitialMessageCtx,
): Promise<void> {
	// Clear context if requested (plan mode exit)
	if (initialMsg.clearContext) {
		// Preserve the plan slug before clearing context, so the new session
		// can access the same plan file after regenerateSessionId()
		const oldPlanSlug = initialMsg.message.planContent
			? getPlanSlug()
			: undefined;
		const { clearConversation } = await import(
			"../commands/clear/conversation.js"
		);
		await clearConversation({
			setMessages: ctx.setMessages,
			readFileState: ctx.readFileState.current,
			discoveredSkillNames: ctx.discoveredSkillNamesRef.current,
			loadedNestedMemoryPaths: ctx.loadedNestedMemoryPathsRef.current,
			getAppState: ctx.getAppState,
			setAppState: ctx.setAppState,
			setConversationId: ctx.setConversationId,
		});
		ctx.haikuTitleAttemptedRef.current = false;
		ctx.setHaikuTitle(undefined);
		ctx.bashTools.current.clear();
		ctx.bashToolsProcessedIdx.current = 0;

		// Restore the plan slug for the new session so getPlan() finds the file
		if (oldPlanSlug) {
			setPlanSlug(getSessionId(), oldPlanSlug);
		}
	}

	// Atomically: clear initial message, set permission mode and rules, and store plan for verification
	const shouldStorePlanForVerification =
		initialMsg.message.planContent &&
		isInternalBuild() &&
		isEnvTruthy(undefined);
	ctx.setAppState((prev) => {
		// Build and apply permission updates (mode + allowedPrompts rules)
		let updatedToolPermissionContext = initialMsg.mode
			? applyPermissionUpdates(
					prev.toolPermissionContext,
					buildPermissionUpdates(initialMsg.mode, initialMsg.allowedPrompts),
				)
			: prev.toolPermissionContext;
		// For auto, override the mode (buildPermissionUpdates maps
		// it to 'default' via toExternalPermissionMode) and strip dangerous rules
		if (initialMsg.mode === "auto") {
			updatedToolPermissionContext = stripDangerousPermissionsForAutoMode({
				...updatedToolPermissionContext,
				mode: "auto",
				prePlanMode: undefined,
			});
		}
		return {
			...prev,
			initialMessage: null,
			toolPermissionContext: updatedToolPermissionContext,
			...(shouldStorePlanForVerification && {
				pendingPlanVerification: {
					plan: initialMsg.message.planContent!,
					verificationStarted: false,
					verificationCompleted: false,
				},
			}),
		};
	});

	// Create file history snapshot for code rewind
	if (fileHistoryEnabled()) {
		void fileHistoryMakeSnapshot(
			(updater: (prev: FileHistoryState) => FileHistoryState) => {
				ctx.setAppState((prev) => ({
					...prev,
					fileHistory: updater(prev.fileHistory),
				}));
			},
			initialMsg.message.uuid,
		);
	}

	// Ensure SessionStart hook context is available before the first API
	// call. onSubmit calls this internally but the onQuery path below
	// bypasses onSubmit — hoist here so both paths see hook messages.
	await ctx.awaitPendingHooks();

	// Route all initial prompts through onSubmit to ensure UserPromptSubmit hooks fire
	// TODO: Simplify by always routing through onSubmit once it supports
	// ContentBlockParam arrays (images) as input
	const content = initialMsg.message.message.content;

	// Route all string content through onSubmit to ensure hooks fire
	// For complex content (images, etc.), fall back to direct onQuery
	// Plan messages bypass onSubmit to preserve planContent metadata for rendering
	if (typeof content === "string" && !initialMsg.message.planContent) {
		// Route through onSubmit for proper processing including UserPromptSubmit hooks
		void ctx.onSubmit(content, {
			setCursorOffset: () => {},
			clearBuffer: () => {},
			resetHistory: () => {},
		});
	} else {
		// Plan messages or complex content (images, etc.) - send directly to model
		// Plan messages use onQuery to preserve planContent metadata for rendering
		// TODO: Once onSubmit supports ContentBlockParam arrays, remove this branch
		const newAbortController = createAbortController();
		ctx.setAbortController(newAbortController);
		void ctx.onQuery(
			[initialMsg.message],
			newAbortController,
			true,
			// shouldQuery
			[],
			// additionalAllowedTools
			ctx.mainLoopModel,
		);
	}

	// Reset ref after a delay to allow new initial messages
	setTimeout(
		(ref) => {
			ref.current = false;
		},
		100,
		ctx.initialMessageRef,
	);
}
