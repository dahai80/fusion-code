在处理长上下文（Long Context）的 Code Agent 时，“KV Cache 爆炸”是所有本地模型绕不开的物理定律。尤其是当 fusion-code 进行多轮对话，且触发了 autocompact（将历史记录压缩/摘要）时，如果处理不当，会导致新的推理计算与旧的内存释放产生碎片化叠加，从而撑爆 M5 的统一内存。
针对 fusion-mlx 后端和 fusion-code 前端，你需要建立一套“显式内存管理”机制，而非依赖 Python 的自动垃圾回收。
1. 后端：将“全量 Compact”改为“滑动窗口 KV 剪裁”
目前的 autocompact 往往逻辑是：读取全部历史 -> 生成摘要 -> 重构整个 Prompt -> 重新 Prefill。这会瞬间产生一个巨大的临时内存峰值。
优化方案： 放弃重构整个 Prompt，改为 KV Cache 层级的“逻辑修剪”。
·       KV Cache 显式回滚： 利用 mlx-lm 的 ArrayCache 接口，在执行摘要生成前，手动截断历史对话对应的 KV 层级索引。
·       分段式 Cache 存储： 不要把所有历史都存在一个巨大的 Cache 里。将 System Prompt、Project Context、Current Conversation 分为三个独立的 ArrayCache 块。
o   当需要 Compact 时，只重新计算“Current Conversation”块，然后将它与前两块进行合并（Concatenate）。这样你永远不需要重新计算高昂的 System Prompt 或项目结构缓存。
2. 前端：从“无状态摘要”转向“分层记忆结构”
如果 fusion-code 把所有的历史记录都当成线性字符串丢给后端，内存必然暴涨。你需要引入 “记忆分层协议”：
·       长期记忆 (Long-term Memory)： 用向量数据库（LanceDB）存储关键的 API 定义、文档摘要。查询时只按需挂载。
·       短期记忆 (Short-term Working Memory)： 仅保留最近 3-5 轮的完整对话（精确的 Token），用于推理。
·       摘要记忆 (Summarized Context)： 将更早的历史记录压缩成一个 JSON 格式的 {"summary": "..."} 放入 System Prompt，而不是将其作为 User 消息发送。
代码逻辑改造（在 LocalMlxProvider.ts 中）：
TypeScript
// 永远只发送最近 N 轮 + 一个动态更新的摘要块
async function buildOptimizedPrompt(history: Message[]) {
  const recent = history.slice(-5); // 只取最近 5 轮
  const summary = await getSummary(history.slice(0, -5)); // 异步获取旧历史的摘要
 
  return [
    { role: "system", content: `工程摘要: ${summary}` },
    ...recent
  ];
}
3. 内存风控：引入“主动式内存清理” (Proactive GC)
在 M 系列芯片上，MLX 的张量计算非常高效，但 Python 侧的引用计数有时释放不及时。
·       强制清理： 在 fusion-mlx 处理完 Compact 请求后，显式执行：
Python
import gc
import mlx.core as mx
 
# 清空 MLX 的缓存池
mx.metal.release_cache()
gc.collect()
·       监控阈值（熔断）： 在 FastAPI 服务中添加一个 Middleware，监控 psutil.virtual_memory().percent。如果超过 90%，立即清理所有非活跃的 lru_cache 状态机，甚至主动清除 PromptCache。
4. 彻底解决“内存暴涨”的架构绝招：KV Cache 序列化（Disk-backed Cache）
这是对付 128GB 内存也不够用的终极方案：将不活跃的 KV Cache 溢写到 NVMe SSD。
·       虽然 mlx 默认在内存中运行，但你可以实现一个“缓存交换机制”：
o   将旧对话的 KV Cache 转换为 np.save 格式存入临时文件。
o   当用户切换回旧对话时，再从磁盘 Load 回内存。
o   这虽然会带来几百毫秒的磁盘 IO 延迟，但能将你的 Agent 上下文从 100k 扩展到 1M+，彻底终结内存溢出导致的崩溃。
💡 给你的建议执行优先级
1.    高（明天能改）： 修改前端 LocalMlxProvider，强制执行“摘要块 + N 轮短期记忆”的 Prompt 策略，停止把所有历史全量丢给后端。
2.    中（下周能改）： 在后端接口加一个 mx.metal.release_cache()，在每轮推理结束后（特别是触发 Compact 后）强制释放 GPU 显存。
3.    低（架构演进）： 引入 LanceDB 做 RAG（检索增强生成），把 Compact 的任务从“全量总结”变为“按需检索”，从而完全规避“上下文过载”这个伪需求。

在长会话或多轮 Tool Call 的场景下，Compact / AutoCompact（上下文压缩）引发的内存暴涨是本地 Agent（特别是配合 M 芯片统一内存架构）最典型的工程痛点之一。
内存暴涨的核心原因在于：压缩动作本身往往需要模型生成摘要，而在 Python (fusion-mlx) 和 Node.js (fusion-code) 两个层面，旧的 KV Cache/内存对象尚未被完全释放，新的 Prefill 阶段又瞬间开辟了巨大的新显存/内存空间，造成了内存峰值（Memory Spike）叠加。
针对这个问题，可以从 后端显存管理 和 前端瘦身策略 两个层面进行针对性的解决：
一、 fusion-mlx（Python 后端）：显存强制回收与缓存重置
在 MLX 中，统一内存（Unified Memory）由 Metal 内存池统一托管。如果仅仅在 Python 里面把对象设为 None，MLX 的 Metal 缓存池并不会立即将物理内存还给操作系统，导致下一次 Prefill 直接触发内存暴涨甚至 Swap。
1. 显式触发 Metal 垃圾回收与缓存清理
在触发 Compact 前或释放旧 Prompt Cache 时，必须强行清空 Metal Cache。
在 fusion-mlx 的 KV Cache 替换逻辑中加入以下清理流程：
Python
import gc
import mlx.core as mx
 
def reset_and_clear_kv_cache(prompt_cache):
    """
    在发生 AutoCompact、上下文截断或重置时调用的硬清理函数
    """
    # 1. 显式清空 KV Cache 对象引用的数组
    if prompt_cache is not None:
        # 如果是 mlx_lm 的 Prompt Cache，重置或释放其内部状态
        prompt_cache.state = None
        
    # 2. 触发 Python 垃圾回收，断开强引用
    gc.collect()
   
    # 3. 核心：强行释放 MLX 在 Metal 层面的内存缓存池！
    mx.metal.clear_cache()
2. Prefill 阶段的内存上限约束
如果你用的是 27B 模型（MXFP8），在 Prefill（预填）长上下文时会短暂消耗大量的临时矩阵计算内存。可以在 fusion-mlx 初始化时，为 Metal 显存设置上限保护，防止暴涨压垮系统：
Python
# 限制 MLX 能够占用的最大 GPU 内存比例，为系统和终端 UI 留出缓冲区
mx.metal.set_wire_limit(int(128 * 1024 * 1024 * 1024 * 0.75)) # 设定 75% 阈值
二、 fusion-code（TS 前端）：无 LLM 损耗的“硬剪裁”策略
很多 Agent 的 AutoCompact 喜欢让大模型去生成“上一阶段对话摘要”，这本身极度消耗 Token 和内存。
对于 Code Agent 来说，80% 以上的上下文垃圾都来自于旧工具的输出（如 read_file 读到的上千行代码、grep 的巨量日志）。用确定性的逻辑进行“结构化硬剪裁”，效果远胜于让模型生成摘要。
1. 工具输出截断（Tool Output Truncation）
修改 fusion-code 的历史记录管理器，当对话轮数超过阈值触发 autocompact 时，不要清空对话，只对历史 Message 中的旧工具输出做无损抹水：
TypeScript
// fusion-code/src/utils/contextOptimizer.ts
 
export function applyHardCompact(messages: any[], keepRecentCount: number = 6) {
  const total = messages.length;
 
  return messages.map((msg, index) => {
    // 保留最近 N 轮对话原样不动
    if (index >= total - keepRecentCount) {
      return msg;
    }
 
    // 对于很久以前的工具输出，直接替换为占位符，瞬间释放 80% 的 Token 压力！
    if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.startsWith('Tool Output:')) {
      // 如果是庞大的文件读取或命令输出
      if (msg.content.length > 500) {
        return {
          ...msg,
          content: `Tool Output: [Content truncated by AutoCompact to save memory. Lines count: ${msg.content.split('\n').length}]`
        };
      }
    }
 
    return msg;
  });
}
2. 差分前缀保留（Prefix Preservation）
如果改变了历史 Message 的开头（系统提示词或最早的几条 User 消息），fusion-mlx 底层的 Prefix Caching（前缀缓存） 就会全部失效，导致模型必须从头重新 Prefill 整个上下文，这正是引发内存峰值的主要元凶。
最佳的 AutoCompact 规则：
·       第 1 条（System Prompt）： 绝对保持不变（锁死 Cache 前缀）。
·       第 2 ~ 4 条（初始 User 需求与项目结构）： 保持不变。
·       中间历史： 仅剪裁其中的 Tool Output，保留 thinking 和 tool_name 结构。
·       最后 N 条： 保持最新完整的细节。
这样既完成了压缩，又保证了前缀 KV Cache 极大程度的复用，避开了重新 Prefill 带来的显存暴涨。
💡 总结与落地步骤
1.    后端（Python）： 只要发现上下文发生截断或重置，必须调用 gc.collect() + mx.metal.clear_cache()，手动驱逐 Metal 显存池。
2.    前端（TS）： 将 AutoCompact 的默认行为从“让 LLM 总结上下文”改为“针对旧 Tool Output 的正则/长度裁剪”。
3.    架构： 保持 System Prompt 和早期 Prompt 的强稳定性，防止触发全局 KV Cache 重算。

方案 B（前端针对旧 Tool Output 进行确定性的“硬剪裁”）在工程落地上不仅效果最立竿见影，而且能从根本上解决内存暴涨的问题。
让 LLM 去生成摘要（Soft Compact）在本地架构下其实是一个“逻辑悖论”：
内存雪上加霜： 触发 Compact 时说明上下文已经接近极限，此时再让 27B 模型去 Prefill 几万 Token 并生成摘要，正好撞在内存峰值最高的高危区，瞬间触发 Swap 甚至 OOM（内存溢出）。
丢失关键代码细节： 模型的摘要往往是模糊概括，容易丢掉文件名、行号、具体函数名等关键信息，导致后半程 Agent 出现“幻觉”或找不到文件。
相比之下，针对旧 Tool Output 的“硬剪裁”（Hard Truncation）优势极大：
💡 为什么方案 B 如此高效？
零算力/零内存开销： 这是纯 TypeScript 层的字符串切片操作，耗时 0 毫秒，完全不需要触发 MLX 后端的任何矩阵计算或额外内存分配。
保护 Prefix Cache（前缀缓存）： 代码文件（如 read_file 的几千行内容）占用了 80%~90% 的 Token。把旧的 Tool Output 压缩成一行简单的占位符标签，既释放了大段上下文，又保留了历史对话的骨架结构（Agent 依然记得自己曾经读过哪个文件、执行过哪个工具）。
彻底规避内存峰值（Memory Spike）： 在剪裁发生后，下一次发给 fusion-mlx 的 Token 数量急剧减少，后端的 Prefill 压力瞬间降低，Metal 内存也能平稳释放。
🛠️ 建议直接落地的滑动窗口硬剪裁逻辑
你可以直接在 fusion-code 的历史记录管理器（History Manager）中挂载下面这个轻量剪裁器：
TypeScript
// fusion-code/src/utils/contextOptimizer.ts
 
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
 
/**
* 确定性的无损上下文硬剪裁
* @param messages 完整历史
* @param keepRecentTools 保留最近多少次工具调用的完整输出（建议 3-5 次）
* @param maxToolOutputChars 超过多少字符的旧工具输出将被阶段（建议 300 字符）
*/
export function compactHistory(
  messages: Message[],
  keepRecentTools: number = 3,
  maxToolOutputChars: number = 300
): Message[] {
  // 统计消息中所有工具输出的位置
  const toolIndices: number[] = [];
  messages.forEach((msg, idx) => {
    // 假设你的工具输出格式带有特定标记
    if (msg.role === 'user' && msg.content.startsWith('Tool Output:')) {
      toolIndices.push(idx);
    }
  });
 
  // 如果工具调用次数未超过保留阈值，不做处理
  if (toolIndices.length <= keepRecentTools) {
    return messages;
  }
 
  // 需要被剪裁的旧工具输出索引集合
  const indicesToTruncate = new Set(
    toolIndices.slice(0, toolIndices.length - keepRecentTools)
  );
 
  return messages.map((msg, idx) => {
    if (indicesToTruncate.has(idx)) {
      if (msg.content.length > maxToolOutputChars) {
        // 抓取前 100 个字符保留关键头信息，其余截断
        const head = msg.content.slice(0, 100);
        const lineCount = msg.content.split('\n').length;
       
        return {
          ...msg,
          content: `${head}\n... [AutoCompact: Older tool output truncated (${lineCount} lines / ${msg.content.length} chars) to protect local memory] ...`
        };
      }
    }
    return msg;
  });
}
配合后端的一句话小优化
前端采用 B 方案硬剪裁后，在 fusion-mlx 后端只需要在接收到剪裁后的请求时，加一行手动释放 Metal 缓存的逻辑即可：
Python
# 在 Python 后端处理完变短的请求后，或者在发现 Token 数大幅减少时
import gc
import mlx.core as mx
 
# 强行驱逐上一次长上下文留在 Metal 显存池里的脏缓存
gc.collect()
mx.metal.clear_cache()
你可以先在 fusion-code 中把这个硬剪裁函数挂上去试一下，多跑几轮读写长文件的复杂任务，看看内存曲线是不是直接平稳下来了！
