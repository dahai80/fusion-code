// audit 1.1.1: 从 REPL.tsx 抽出的 setResponseLength 包装纯路由。无 React hooks, 无 JSX,
// 无 await。唯一副作用 = mutate 2 个 ref.current (与原 useCallback 体一致)。
// 语义: 模型流式输出累积 response length 时三件事:
//   (1) responseLengthRef.current = f(prev) (记录当前 turn 累积长度, 供 pushApiMetricsEntry
//       读 baseline + setResponseLength 自身增量判断);
//   (2) 仅当新值 > prev (长度增长) 时才更新 metrics 末条 — 平坦期 (无新 token) 不刷时间戳;
//   (3) 末条 lastTokenTime = now + endResponseLength = 当前累积值 (ttft baseline 在
//       pushApiMetricsEntry 建条时定, 这里只推进 lastTokenTime + 终值, 供 TTFT→末token
//       时长 + 总响应长统计)。
// 原 useCallback deps = [] (refs 不在 deps; 空数组 = 永不重建)。REPL 保留薄包装, deps 不变;
//   下游读取同名 const (字节等价)。

// ApiMetricsEntry 最小形状 (helper 只写这两个字段, 读 baseline 不在此)。
type ApiMetricsEntryLike = {
	lastTokenTime: number;
	endResponseLength: number;
};

export type ResponseLengthStateSetters = {
	responseLengthRef: { current: number };
	apiMetricsRef: { current: ApiMetricsEntryLike[] };
};

// 行为等价 REPL.tsx:1681-1696 useCallback 体。REPL 保留 useCallback 薄包装
// (deps [] 不变)。
export function applySetResponseLength(
	f: (prev: number) => number,
	setters: ResponseLengthStateSetters,
): void {
	const prev = setters.responseLengthRef.current;
	setters.responseLengthRef.current = f(prev);
	if (setters.responseLengthRef.current > prev) {
		const entries = setters.apiMetricsRef.current;
		if (entries.length > 0) {
			const lastEntry = entries.at(-1)!;
			lastEntry.lastTokenTime = Date.now();
			lastEntry.endResponseLength = setters.responseLengthRef.current;
		}
	}
}
