import { afterEach, describe, expect, it } from "bun:test";
import { MIN_COLS_FOR_FULL_SPRITE } from "../../buddy/CompanionSprite.js";
import {
	deriveCenteredModal,
	deriveCompanionLayoutState,
	deriveCompanionNarrow,
	deriveCompanionVisible,
	deriveToolJsxCentered,
} from "../../utils/companionLayoutState.js";

// audit 1.1.1: companion 布局状态推导单元测试。行为等价 REPL.tsx:5777-5799 内联块。
// 4 derive: companionNarrow (cols<100) / companionVisible (无隐藏门控) /
// toolJsxCentered (fullscreen+local-jsx) / centeredModal (centered? jsx : null)。
// isFullscreenEnvEnabled() 读 FUSION_CODE_NO_FLICKER env: =1 truthy→true, =0 falsy→false。
// 每个用例显式设/清 env, 不依赖默认。

const base = {
	transcriptCols: 120,
	toolJSX: null,
	focusedInputDialog: undefined,
	showBashesDialog: false,
} as const;

const savedFlicker = process.env.FUSION_CODE_NO_FLICKER;
const savedUserType = process.env.USER_TYPE;

afterEach(() => {
	if (savedFlicker === undefined) delete process.env.FUSION_CODE_NO_FLICKER;
	else process.env.FUSION_CODE_NO_FLICKER = savedFlicker;
	if (savedUserType === undefined) delete process.env.USER_TYPE;
	else process.env.USER_TYPE = savedUserType;
});

const setFullscreen = (on: boolean) => {
	process.env.FUSION_CODE_NO_FLICKER = on ? "1" : "0";
};

describe("deriveCompanionNarrow", () => {
	it("true when cols below sprite threshold", () => {
		expect(deriveCompanionNarrow(MIN_COLS_FOR_FULL_SPRITE - 1)).toBe(true);
	});

	it("false when cols at threshold", () => {
		expect(deriveCompanionNarrow(MIN_COLS_FOR_FULL_SPRITE)).toBe(false);
	});

	it("false on wide terminal", () => {
		expect(deriveCompanionNarrow(200)).toBe(false);
	});
});

describe("deriveCompanionVisible", () => {
	it("visible when no hiding gate active", () => {
		expect(deriveCompanionVisible(null, undefined, false)).toBe(true);
	});

	it("hidden when toolJSX.shouldHidePromptInput true", () => {
		expect(
			deriveCompanionVisible(
				{ jsx: null, shouldHidePromptInput: true },
				undefined,
				false,
			),
		).toBe(false);
	});

	it("hidden when a dialog is focused", () => {
		expect(deriveCompanionVisible(null, "tool-permission", false)).toBe(false);
	});

	it("hidden when bashes dialog open (truthy string)", () => {
		expect(deriveCompanionVisible(null, undefined, "bashes")).toBe(false);
	});

	it("hidden when bashes dialog open (true)", () => {
		expect(deriveCompanionVisible(null, undefined, true)).toBe(false);
	});

	it("visible when shouldHidePromptInput absent (toolJSX null)", () => {
		expect(deriveCompanionVisible(null, undefined, false)).toBe(true);
	});

	it("visible when shouldHidePromptInput false explicitly", () => {
		expect(
			deriveCompanionVisible(
				{ jsx: null, shouldHidePromptInput: false },
				undefined,
				false,
			),
		).toBe(true);
	});
});

describe("deriveToolJsxCentered", () => {
	it("true when fullscreen + local jsx command", () => {
		setFullscreen(true);
		expect(deriveToolJsxCentered({ jsx: null, isLocalJSXCommand: true })).toBe(
			true,
		);
	});

	it("false when local jsx but not fullscreen", () => {
		setFullscreen(false);
		expect(deriveToolJsxCentered({ jsx: null, isLocalJSXCommand: true })).toBe(
			false,
		);
	});

	it("false when fullscreen but not a local jsx command", () => {
		setFullscreen(true);
		expect(deriveToolJsxCentered({ jsx: null, isLocalJSXCommand: false })).toBe(
			false,
		);
	});

	it("false when toolJSX null (no command at all)", () => {
		setFullscreen(true);
		expect(deriveToolJsxCentered(null)).toBe(false);
	});

	it("false when isLocalJSXCommand absent", () => {
		setFullscreen(true);
		expect(deriveToolJsxCentered({ jsx: null })).toBe(false);
	});
});

describe("deriveCenteredModal", () => {
	it("returns toolJSX.jsx when centered", () => {
		const node = "modal-content" as never;
		expect(
			deriveCenteredModal(true, { jsx: node, isLocalJSXCommand: true }),
		).toBe(node);
	});

	it("returns null when not centered", () => {
		expect(deriveCenteredModal(false, { jsx: "x" as never })).toBe(null);
	});

	it("returns null jsx as null when centered", () => {
		expect(
			deriveCenteredModal(true, { jsx: null, isLocalJSXCommand: true }),
		).toBe(null);
	});
});

describe("deriveCompanionLayoutState (aggregate)", () => {
	it("wide idle: not narrow, visible, not centered, null modal", () => {
		setFullscreen(false);
		const state = deriveCompanionLayoutState({ ...base });
		expect(state.companionNarrow).toBe(false);
		expect(state.companionVisible).toBe(true);
		expect(state.toolJsxCentered).toBe(false);
		expect(state.centeredModal).toBe(null);
	});

	it("narrow terminal flags companionNarrow", () => {
		setFullscreen(false);
		const state = deriveCompanionLayoutState({
			...base,
			transcriptCols: 80,
		});
		expect(state.companionNarrow).toBe(true);
		expect(state.companionVisible).toBe(true);
	});

	it("bashes dialog hides companion but keeps narrow flag independent", () => {
		setFullscreen(false);
		const state = deriveCompanionLayoutState({
			...base,
			transcriptCols: 80,
			showBashesDialog: true,
		});
		expect(state.companionNarrow).toBe(true);
		expect(state.companionVisible).toBe(false);
	});

	it("focused dialog hides companion", () => {
		setFullscreen(false);
		const state = deriveCompanionLayoutState({
			...base,
			focusedInputDialog: "cost",
		});
		expect(state.companionVisible).toBe(false);
	});

	it("local jsx command in fullscreen centers modal", () => {
		setFullscreen(true);
		const node = "centered-jsx" as never;
		const state = deriveCompanionLayoutState({
			...base,
			toolJSX: { jsx: node, isLocalJSXCommand: true },
		});
		expect(state.toolJsxCentered).toBe(true);
		expect(state.centeredModal).toBe(node);
	});

	it("non-local toolJSX in fullscreen stays inline (not centered)", () => {
		setFullscreen(true);
		const state = deriveCompanionLayoutState({
			...base,
			toolJSX: { jsx: "x" as never, isLocalJSXCommand: false },
		});
		expect(state.toolJsxCentered).toBe(false);
		expect(state.centeredModal).toBe(null);
	});

	it("toolJSX.shouldHidePromptInput hides companion regardless of centering", () => {
		setFullscreen(true);
		const state = deriveCompanionLayoutState({
			...base,
			toolJSX: {
				jsx: "x" as never,
				shouldHidePromptInput: true,
				isLocalJSXCommand: true,
			},
		});
		expect(state.companionVisible).toBe(false);
		expect(state.toolJsxCentered).toBe(true);
	});
});
