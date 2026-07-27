// log: created for TS2307 fix

export async function rollback(
	target?: string,
	options?: {
		list?: boolean;
		dryRun?: boolean;
		safe?: boolean;
	},
): Promise<void> {
	console.log(
		"[rollback] rollback command called (ant-only stub)",
		target,
		options,
	);
}
