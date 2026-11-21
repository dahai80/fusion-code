export function intersperse<A>(as: A[], separator: (index: number) => A): A[] {
	return as.flatMap((a, i) => (i ? [separator(i), a] : [a]));
}

export function count<T>(arr: readonly T[], pred: (x: T) => unknown): number {
	let n = 0;
	for (const x of arr) n += +!!pred(x);
	return n;
}

export function uniq<T>(xs: Iterable<T>): T[] {
	return [...new Set(xs)];
}

// audit 1.1.1: pure function extracted from REPL.tsx. Returns the median of ttft/otps across multiple requests.
// Input is a plain array of primitives only, no side effects.
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
		: sorted[mid];
}
