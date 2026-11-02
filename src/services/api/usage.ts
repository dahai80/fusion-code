export type RateLimit = {
	utilization: number | null; // a percentage from 0 to 100
	resets_at: string | null; // ISO 8601 timestamp
};

export type ExtraUsage = {
	is_enabled: boolean;
	monthly_limit: number | null;
	used_credits: number | null;
	utilization: number | null;
};

export type Utilization = {
	five_hour?: RateLimit | null;
	seven_day?: RateLimit | null;
	seven_day_oauth_apps?: RateLimit | null;
	seven_day_opus?: RateLimit | null;
	seven_day_sonnet?: RateLimit | null;
	extra_usage?: ExtraUsage | null;
};
