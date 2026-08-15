// 通用 SSE 解析 (text/event-stream -> 事件流)
//
// 替代 Anthropic SDK 的 Stream: 把 fetch Response.body 按字节流读入, 按 SSE 帧边界
// (空行分隔事件, data:/event:/: 注释行) 切成结构化事件。
//
// 规范依据: MDN Server-sent events
// - 多行 data: 用 "\n" 连接为单个 data 字段
// - event: 行指定事件类型 (缺省 "message")
// - 以 ":" 开头为注释/心跳, 忽略
// - 一个空行触发一个事件派发
//
// 容错: 部分块跨 chunk 边界时, 未完成的行留在 buffer 直到下次读取 (参考 fusion-mlx-stream.ts 现有实现)。

export interface SseEvent {
    event: string;
    data: string;
    id?: string;
}

// 把一个 ReadableStream<Uint8Array> (fetch Response.body) 解析成 SseEvent 异步迭代器。
export async function* parseSseStream(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
): AsyncIterable<SseEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";
    let dataLines: string[] = [];
    let lastId: string | undefined;

    try {
        while (true) {
            if (signal?.aborted) {
                throw new DOMException("SSE stream aborted", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // 按换行切行; 末尾未完成行留在 buffer
            const lines = buffer.split(/\r\n|\r|\n/);
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                // 空行: 派发当前事件并重置
                if (line === "") {
                    if (dataLines.length > 0) {
                        yield {
                            event,
                            data: dataLines.join("\n"),
                            id: lastId,
                        };
                    }
                    event = "message";
                    dataLines = [];
                    continue;
                }
                // 注释/心跳
                if (line.startsWith(":")) continue;
                const colonIdx = line.indexOf(":");
                if (colonIdx === -1) {
                    continue;
                }
                const field = line.slice(0, colonIdx);
                let val = line.slice(colonIdx + 1);
                if (val.startsWith(" ")) val = val.slice(1);
                switch (field) {
                    case "event":
                        event = val;
                        break;
                    case "data":
                        dataLines.push(val);
                        break;
                    case "id":
                        lastId = val;
                        break;
                    case "retry":
                        break;
                    default:
                        break;
                }
            }
        }

        // 处理尾部残留 buffer (流未以空行结尾的边界)
        buffer += decoder.decode();
        if (buffer !== "") {
            const trailing = buffer.split(/\r\n|\r|\n/);
            for (const line of trailing) {
                if (line === "") continue;
                if (line.startsWith(":")) continue;
                const colonIdx = line.indexOf(":");
                if (colonIdx === -1) continue;
                const field = line.slice(0, colonIdx);
                let val = line.slice(colonIdx + 1);
                if (val.startsWith(" ")) val = val.slice(1);
                if (field === "data") dataLines.push(val);
                else if (field === "event") event = val;
            }
        }
        if (dataLines.length > 0) {
            yield { event, data: dataLines.join("\n"), id: lastId };
        }
    } finally {
        reader.releaseLock();
    }
}
