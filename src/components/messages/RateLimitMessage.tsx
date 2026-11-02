import { Text } from "src/ink.js";

// Claude.ai rate-limit upsell UI removed with the cloud account stack.
// The component keeps its props API (AssistantTextMessage renders it when a
// 429 message is detected) but now shows the raw notice text unstyled.

type RateLimitMessageProps = {
	text: string;
	onOpenRateLimitOptions?: () => void;
};

export function RateLimitMessage({ text }: RateLimitMessageProps) {
	return <Text>{text}</Text>;
}

export function getUpsellMessage(_opts?: unknown): string | null {
	return null;
}
