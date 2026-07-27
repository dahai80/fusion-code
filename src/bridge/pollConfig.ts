export const getPollIntervalConfig = (): {
	defaultMs: number;
	maxMs: number;
	session_keepalive_interval_v2_ms: number; // log: fix TS2339
} => ({
	defaultMs: 5000,
	maxMs: 30000,
	session_keepalive_interval_v2_ms: 120000,
});
