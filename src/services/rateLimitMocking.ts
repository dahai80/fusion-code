// Rate-limit mock infrastructure removed with the claude.ai account stack
// (/mock-limits was an internal-only testing command; mockRateLimits.ts
// deleted). The header-processing gates remain and now depend only on real
// subscriber status.

export function shouldProcessRateLimits(subscriber: boolean): boolean {
	return subscriber;
}

export function processRateLimitHeaders< HeadersT >(headers: HeadersT): HeadersT {
	return headers;
}
