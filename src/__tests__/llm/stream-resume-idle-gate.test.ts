// audit 2.2.2: idle-watchdog abort 门控 + refs survivor 单测。
//
// 覆盖两缺陷修复:
//   Defect 1 (gate): abort 形错误无 user signal, resume 开 + idle 触发 → 跳过 synthetic
//     timeout throw, 落 resume 检查。其余三格 byte-identical (旧 throw)。
//   Defect 2 (dead refs): watchdog releaseStreamResources 先于 catch null streamResponse,
//     WeakMap 项键 Response 强引用断即 GC → refs=undefined → resume 跳过。survivor 在
//     release 前捕获, resolveResumeRefs 回退 survivor → refs 存活 → resume 真起。

import { describe, expect, test } from "bun:test";
import {
	attachResumeRefs,
	getResumeRefs,
	isResumeEligibleError,
	resolveResumeRefs,
	shouldDeferIdleAbortToResume,
} from "../../services/llm/streamResume.js";

describe("audit 2.2.2 — idle-watchdog abort gate + refs survivor", () => {
	// Defect 1 修复: 仅 resume-on + idle 跳过 throw。
	describe("shouldDeferIdleAbortToResume (gate contract)", () => {
		test("resume-on + idle → defer (skip synthetic timeout throw)", () => {
			expect(shouldDeferIdleAbortToResume(true, true)).toBe(true);
		});
		test("resume-off + idle → old throw (byte-identical)", () => {
			expect(shouldDeferIdleAbortToResume(true, false)).toBe(false);
		});
		test("resume-on + non-idle abort → old throw", () => {
			expect(shouldDeferIdleAbortToResume(false, true)).toBe(false);
		});
		test("resume-off + non-idle → old throw", () => {
			expect(shouldDeferIdleAbortToResume(false, false)).toBe(false);
		});
	});

	// Defect 2 修复: refs 存活过 watchdog releaseStreamResources null streamResponse。
	describe("resolveResumeRefs (survivor fallback)", () => {
		const makeRefs = () => ({
			cursorRef: { current: "sid:5" },
			stateRef: { current: undefined },
			sid: "sid",
			baseUrl: "http://127.0.0.1:11432",
			authHeaders: {},
		});

		test("live Response 在场 → live refs 胜 (无 race 回退)", () => {
			const resp = new Response();
			const refs = makeRefs();
			attachResumeRefs(resp, refs);
			expect(resolveResumeRefs(resp, undefined)).toBe(refs);
		});

		test("Response 被 null (watchdog released) → 返回 survivor refs", () => {
			const survivor = makeRefs();
			// streamResponse 此处 undefined (watchdog null 了它)。catch 对 idle drop
			// 正处此态。无 survivor 则 getResumeRefs(undefined) 返回 undefined,
			// :2540 resume 跳过 — 即原 dead-refs bug。
			expect(resolveResumeRefs(undefined, survivor)).toBe(survivor);
		});

		test("两者皆无 → undefined (非-idle abort, 无 survivor)", () => {
			expect(resolveResumeRefs(undefined, undefined)).toBeUndefined();
		});

		test("一致性: getResumeRefs(Response) === resolveResumeRefs(Response, _)", () => {
			const resp = new Response();
			const refs = makeRefs();
			attachResumeRefs(resp, refs);
			expect(resolveResumeRefs(resp, makeRefs())).toBe(getResumeRefs(resp));
		});
	});

	// 端到端契约: defer=true ⇒ 下游 isResumeEligibleError(_, true)=true
	// ⇒ 落下是真 resume 尝试, 非静默落 fallback。
	describe("defer ⇒ resume-eligible (full fall-through contract)", () => {
		test("idle drop 是 resume-eligible (defer 路径落到 resume 尝试)", () => {
			expect(isResumeEligibleError(new Error("body canceled"), true)).toBe(
				true,
			);
		});
		test("非-idle abort 非 resume-eligible (throw 路径, 不 resume)", () => {
			expect(isResumeEligibleError(new Error("aborted"), false)).toBe(false);
		});
	});
});
