// audit 1.1.1: 从 REPL.tsx onSubmit pasted-attachment 子块抽出 (PURE-ROUTING SUB-BLOCK class, 像 slice #25/#26/#27)。
// 行为等价 REPL.tsx:4011-4067。无 React hooks, 无 JSX, 无 await。
// 仅当有 pasted 附件时构建 content blocks (text + image base64); 否则透传 trimmed input。
// 输出 3 locals: messageContent (string | ContentBlockParam[]) + remoteContent (RemoteMessageContent) + imagePasteIds (image paste id 数组 或 undefined)。
// 2 个闭包依赖 (pastedContents + input) 直接作参数传入, helper 不持有 React state。
import type { ContentBlockParam } from "src/types/anthropic-protocol.js";
import type { PastedContent } from "./config.js";
import type { RemoteMessageContent } from "./teleport/api.js";

export type RemoteMessageContentResult = {
	messageContent: string | ContentBlockParam[];
	remoteContent: RemoteMessageContent;
	imagePasteIds: number[] | undefined;
};

// REPL 保留薄调用:
//   const { messageContent, remoteContent, imagePasteIds } = buildRemoteMessageContent(input, pastedContents);
export function buildRemoteMessageContent(
	input: string,
	pastedContents: Record<number, PastedContent>,
): RemoteMessageContentResult {
	const pastedValues = Object.values(pastedContents);
	const imageContents = pastedValues.filter((c) => c.type === "image");
	const imagePasteIds =
		imageContents.length > 0 ? imageContents.map((c) => c.id) : undefined;
	let messageContent: string | ContentBlockParam[] = input.trim();
	let remoteContent: RemoteMessageContent = input.trim();
	if (pastedValues.length > 0) {
		const contentBlocks: ContentBlockParam[] = [];
		const remoteBlocks: Array<{
			type: string;
			[key: string]: unknown;
		}> = [];
		const trimmedInput = input.trim();
		if (trimmedInput) {
			contentBlocks.push({
				type: "text",
				text: trimmedInput,
			});
			remoteBlocks.push({
				type: "text",
				text: trimmedInput,
			});
		}
		for (const pasted of pastedValues) {
			if (pasted.type === "image") {
				const source = {
					type: "base64" as const,
					media_type: (pasted.mediaType ?? "image/png") as
						| "image/jpeg"
						| "image/png"
						| "image/gif"
						| "image/webp",
					data: pasted.content,
				};
				contentBlocks.push({
					type: "image",
					source,
				});
				remoteBlocks.push({
					type: "image",
					source,
				});
			} else {
				contentBlocks.push({
					type: "text",
					text: pasted.content,
				});
				remoteBlocks.push({
					type: "text",
					text: pasted.content,
				});
			}
		}
		messageContent = contentBlocks;
		remoteContent = remoteBlocks;
	}
	return { messageContent, remoteContent, imagePasteIds };
}
