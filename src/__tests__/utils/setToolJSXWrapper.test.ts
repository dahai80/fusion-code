import { describe, expect, it, mock } from "bun:test";
import {
	applyToolJSXUpdate,
	type LocalJSXCommand,
	type SetToolJSXSetters,
	type ToolJSXInternalState,
} from "../../utils/setToolJSXWrapper.js";

// audit 1.1.1: applyToolJSXUpdate 单元测试。行为等价 REPL.tsx 内联 setToolJSX useCallback 体。
// 路由 4 分支: (1) 设置 local JSX 命令 → ref 存 + setter(rest, strip clearLocalJSX);
//   (2) 已有 local JSX + clearLocalJSX → ref 清 null + setter(null);
//   (3) 已有 local JSX + 非 clear → ref 不变, setter 不调 (工具更新被忽略);
//   (4) 无 local JSX + clearLocalJSX → setter(null);
//   (5) 无 local JSX + 普通 args → setter(args)。

function makeSetters(initialRef: LocalJSXCommand = null): {
	setters: SetToolJSXSetters;
	setToolJSXInternal: ReturnType<typeof mock>;
	localJSXCommandRef: { current: LocalJSXCommand };
	calls: ToolJSXInternalState[];
} {
	const calls: ToolJSXInternalState[] = [];
	const setToolJSXInternal = mock((value: ToolJSXInternalState) => {
		calls.push(value);
	});
	const localJSXCommandRef = { current: initialRef };
	return {
		setters: {
			localJSXCommandRef,
			setToolJSXInternal: setToolJSXInternal as never,
		},
		setToolJSXInternal,
		localJSXCommandRef,
		calls,
	};
}

describe("applyToolJSXUpdate", () => {
	it("stores a local JSX command in the ref + calls setter with rest (clearLocalJSX stripped)", () => {
		const { setters, localJSXCommandRef, calls } = makeSetters();
		applyToolJSXUpdate(
			{
				jsx: null,
				shouldHidePromptInput: true,
				isLocalJSXCommand: true,
				clearLocalJSX: true, // should be stripped from stored ref + setter arg
			},
			setters,
		);
		expect(localJSXCommandRef.current).not.toBeNull();
		expect(localJSXCommandRef.current?.isLocalJSXCommand).toBe(true);
		expect(
			(localJSXCommandRef.current as Record<string, unknown>).clearLocalJSX,
		).toBeUndefined(); // stripped
		expect(calls).toHaveLength(1);
		expect((calls[0] as Record<string, unknown>).clearLocalJSX).toBeUndefined(); // stripped from setter arg too
		expect(calls[0]?.isLocalJSXCommand).toBe(true);
	});

	it("clears the ref + setter(null) when local JSX active + clearLocalJSX set", () => {
		const initial: LocalJSXCommand = {
			jsx: null,
			shouldHidePromptInput: true,
			isLocalJSXCommand: true,
		};
		const { setters, localJSXCommandRef, calls } = makeSetters(initial);
		applyToolJSXUpdate(
			{ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true },
			setters,
		);
		expect(localJSXCommandRef.current).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBeNull();
	});

	it("ignores tool update when local JSX active + clearLocalJSX absent (ref + setter untouched)", () => {
		const initial: LocalJSXCommand = {
			jsx: null,
			shouldHidePromptInput: true,
			isLocalJSXCommand: true,
		};
		const { setters, localJSXCommandRef, calls } = makeSetters(initial);
		applyToolJSXUpdate(
			{ jsx: null, shouldHidePromptInput: false }, // tool update, no clear
			setters,
		);
		expect(localJSXCommandRef.current).toBe(initial); // unchanged ref
		expect(calls).toHaveLength(0); // setter never called
	});

	it("clears via setter(null) when no local JSX + clearLocalJSX set", () => {
		const { setters, localJSXCommandRef, calls } = makeSetters();
		applyToolJSXUpdate(
			{ jsx: null, shouldHidePromptInput: false, clearLocalJSX: true },
			setters,
		);
		expect(localJSXCommandRef.current).toBeNull(); // stays null
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBeNull();
	});

	it("passes normal args to setter when no local JSX active", () => {
		const { setters, localJSXCommandRef, calls } = makeSetters();
		const args = {
			jsx: null,
			shouldHidePromptInput: true,
			showSpinner: true,
		};
		applyToolJSXUpdate(args, setters);
		expect(localJSXCommandRef.current).toBeNull(); // ref untouched (not a local command)
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe(args);
	});

	it("null args with no local JSX calls setter(null)", () => {
		const { setters, calls } = makeSetters();
		applyToolJSXUpdate(null, setters);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBeNull();
	});

	it("falsy isLocalJSXCommand (undefined) does not enter local-command branch", () => {
		// args with isLocalJSXCommand absent → falls through to normal routing
		const { setters, localJSXCommandRef, calls } = makeSetters();
		applyToolJSXUpdate({ jsx: null, shouldHidePromptInput: false }, setters);
		expect(localJSXCommandRef.current).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0]?.isLocalJSXCommand).toBeUndefined();
	});
});
