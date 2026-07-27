export function sanitizeInboundWebhookContent(content: unknown): string {
	return typeof content === "string" ? content : String(content);
}
