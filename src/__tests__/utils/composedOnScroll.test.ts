import { describe, expect, it, mock } from "bun:test";
import type { AppState } from "../../state/AppStateStore.js";
import {
	applyComposedOnScroll,
	type ComposedOnScrollSetters,
} from "../../utils/composedOnScroll.js";

// audit 1.1.1: applyComposedOnScroll 单元测试。行为等价 REPL.tsx 内联
// composedOnScroll useCallback 体。三动作:
//   (1) lastUserScrollTsRef.current = Date.now() (每次滚动打时间戳);
//   (2) sticky=true → onRepin() (重新钉底);
//   (3) sticky=false → onScrollAway(handle) + (KAIROS) maybeLoadOlder(handle)
//       + (BUDDY) setAppState 清 companionReaction (undefined 时原样返回 prev)。
// NOTE: feature("KAIROS")/feature("BUDDY") = bun:bundle 编译期 DCE 宏。bun test 无
//   该 flag → 两 arm 编译期 false → 不可达 (见 focusedDialogSelector.test.ts 同模式)。
//   本测试覆盖非 feature 分支: 时间戳 + sticky 路由 + onScrollAway。KAIROS/BUDDY
//   arm 在生产构建 (flag on) 时由 build:dev:full 覆盖, 非 unit-test 范围。

function makeHandle() {
	return {} as never; // ScrollBoxHandle 形状不影响路由测试 (透传给回调)
}

function makeSetters(): {
	setters: ComposedOnScrollSetters;
	onRepin: ReturnType<typeof mock>;
	onScrollAway: ReturnType<typeof mock>;
	maybeLoadOlder: ReturnType<typeof mock>;
	setAppState: ReturnType<typeof mock>;
	lastUserScrollTsRef: { current: number };
	appStateCalls: AppState[];
} {
	const onRepin = mock(() => {});
	const onScrollAway = mock((_handle: never) => {});
	const maybeLoadOlder = mock((_handle: never) => {});
	const appStateCalls: AppState[] = [];
	const setAppState = mock((updater: (prev: AppState) => AppState) => {
		appStateCalls.push(updater({ companionReaction: "wave" } as never));
	});
	const lastUserScrollTsRef = { current: 0 };
	return {
		setters: {
			lastUserScrollTsRef,
			onRepin,
			onScrollAway,
			maybeLoadOlder,
			setAppState: setAppState as never,
		},
		onRepin,
		onScrollAway,
		maybeLoadOlder,
		setAppState,
		lastUserScrollTsRef,
		appStateCalls,
	};
}

describe("applyComposedOnScroll", () => {
	it("writes timestamp on every scroll (sticky branch)", () => {
		const { setters, lastUserScrollTsRef } = makeSetters();
		expect(lastUserScrollTsRef.current).toBe(0);
		applyComposedOnScroll(true, makeHandle(), setters);
		expect(lastUserScrollTsRef.current).not.toBe(0);
		expect(typeof lastUserScrollTsRef.current).toBe("number");
	});

	it("sticky=true calls onRepin, NOT onScrollAway", () => {
		const { setters, onRepin, onScrollAway, maybeLoadOlder } = makeSetters();
		applyComposedOnScroll(true, makeHandle(), setters);
		expect(onRepin).toHaveBeenCalledTimes(1);
		expect(onScrollAway).not.toHaveBeenCalled();
		expect(maybeLoadOlder).not.toHaveBeenCalled();
	});

	it("sticky=false calls onScrollAway with handle, NOT onRepin", () => {
		const { setters, onRepin, onScrollAway } = makeSetters();
		const handle = makeHandle();
		applyComposedOnScroll(false, handle, setters);
		expect(onScrollAway).toHaveBeenCalledTimes(1);
		expect(onScrollAway).toHaveBeenCalledWith(handle);
		expect(onRepin).not.toHaveBeenCalled();
	});

	it("sticky=false writes timestamp too (every-scroll invariant)", () => {
		const { setters, lastUserScrollTsRef } = makeSetters();
		applyComposedOnScroll(false, makeHandle(), setters);
		expect(lastUserScrollTsRef.current).not.toBe(0);
	});

	// feature("KAIROS")/feature("BUDDY") = 编译期 OFF under bun test (no flag)。
	// maybeLoadOlder + setAppState 清 companionReaction 两 arm 不可达 → 0 调用。
	// 断言这两 arm 在测试环境下确实 DCE 消除 (与生产 build:dev:full 行为互补)。
	it("KAIROS/BUDDY arms DCE-off under bun test: maybeLoadOlder + setAppState NOT called", () => {
		const { setters, maybeLoadOlder, setAppState, appStateCalls } =
			makeSetters();
		applyComposedOnScroll(false, makeHandle(), setters);
		expect(maybeLoadOlder).not.toHaveBeenCalled();
		expect(setAppState).not.toHaveBeenCalled();
		expect(appStateCalls).toHaveLength(0);
	});
});
