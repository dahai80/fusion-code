# Fusion-Code 竞争力提升实施计划

> 基于用户指令 "深度研读 suggest1.md和suggest2.md 制定方案和计划，修复问题，提升fusion-code竞争力"
> 本文件是方案规划文档，不涉及 importers/callers/API/data schemas
> 参考: suggest1.md (hard compact 提案), suggest2.md (演化路线图)

---

## Phase 1: Hard Compact — 确定性工具输出截断 [HIGH] ✅ DONE

**核心问题**: 当前 compact 始终走 LLM 摘要路径。对本地模型这是逻辑悖论——
compact 触发时已接近上下文上限，再发送全量消息给模型做摘要，KV cache 直接 OOM。

**现状**:
- `compactConversation()` 始终调用 `queryModelWithStreaming()` 做摘要
- `preflightMlxTokenTruncate()` 只做 API-round 级别丢弃，且仅作为 pre-flight 安全检查
- `contextCollapse/index.ts` 的 `applyCollapsesIfNeeded()` 用 `<collapsed>` 标记，但粒度粗、不针对 tool_result

**方案**: 在 MLX provider 下，compact 时优先走 hard compact 路径：

1. **新增 `hardCompactMessages()` 函数** (`src/services/compact/hardCompact.ts`)
   - 遍历消息，对 `tool_result` 类型的内容块：
     - 保留前 200 字符 + 最后 100 字符
     - 中间替换为 `[truncated: N chars removed]`
   - 对 `assistant` 消息中的 `text` 块：超过 1000 token 的截断到 500 token
   - 保留最近 N 轮（N=3）完整不动
   - 不调用 LLM，零 token 开销

2. **修改 `compactConversation()` 入口逻辑**
   - 当 `isFusionMlxProvider() === true` 时，优先尝试 hard compact
   - 只有 hard compact 后 token 数仍超阈值，才 fallback 到 LLM 摘要
   - LLM 摘要路径保留 preflight 逻辑不变

3. **修改 `autoCompactIfNeeded()` 触发逻辑**
   - MLX provider: 触发阈值从 70% 降到 60%，给 KV cache 更多余量
   - Hard compact 完成后无需等待模型响应，即时生效

**涉及文件**:
- 新建: `src/services/compact/hardCompact.ts`
- 修改: `src/services/compact/compact.ts` (compactConversation 入口分支)
- 修改: `src/services/compact/autoCompact.ts` (MLX 阈值调整)
- 修改: `src/query.ts` (hard compact 状态追踪)

**验收标准**:
- 32K 上下文模型在 20 轮对话后 compact 不 OOM
- Hard compact 路径 token 开销 = 0
- 最近 3 轮对话内容完整保留
- Fallback 到 LLM 摘要路径仍正常工作

---

## Phase 2: 后端 GC 集成 — 主动释放 KV Cache [MEDIUM] ✅ DONE (frontend part)

**核心问题**: compact 后旧 KV cache 不会立即释放，新 Prefill 叠加旧 cache 导致内存尖峰。

**方案**: 在 fusion-mlx 后端添加 compact 后 GC hook:

1. **fusion-mlx 端**: 添加 `/api/v1/gc` endpoint
   - 调用 `gc.collect()` + `mx.metal.clear_cache()`
   - 返回释放前后的内存统计

2. **fusion-code 端**: compact 完成后调用 GC endpoint
   - 在 `compactConversation()` 成功后，若 `isFusionMlxProvider()`
   - 调用 `POST http://127.0.0.1:11434/api/v1/gc`
   - 超时 5s，失败仅 log warning，不阻塞

3. **hard compact 后也触发 GC**: 旧 KV cache 完全失效，必须清理

**涉及文件**:
- 修改: `src/services/api/fusion-mlx-adapter.ts` (添加 gc() 方法)
- 修改: `src/services/compact/compact.ts` (compact 后调用 gc)
- 修改: `src/services/compact/hardCompact.ts` (hard compact 后调用 gc)
- fusion-mlx 后端: 新增 `/api/v1/gc` route

**验收标准**:
- Compact 后 MLX 内存立即下降（可通过 `/api/v1/stats` 观察）
- GC 调用失败不阻塞后续流程
- 5s 超时内完成

---

## Phase 3: Prefix Cache 保留 — 稳定 System Prompt 前缀 [MEDIUM]

**核心问题**: compact 后 system prompt 变化（attachment 增减）导致 prefix cache 全部失效，
下次请求需重新 Prefill 整个 system prompt，延迟和内存双增。

**现状**:
- `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 已存在，标记了 system prompt 的静态/动态分界
- Compact 后会 re-inject attachments，但位置在 boundary 之前还是之后不确定
- MLX 的 prefix cache 依赖前缀完全匹配

**方案**:

1. **确保 compact 后 system prompt 静态部分不变**
   - `buildSystemPromptBlocks()` 中，boundary 之前的内容（核心指令、工具描述）compact 后保持原样
   - Attachments（文件状态、skill listing）放在 boundary 之后

2. **Hard compact 后保持消息序列稳定**
   - 只修改 tool_result 内容（截断），不增删消息
   - 这样 KV cache 中 system prompt + 前 N 条消息的 prefix 仍然有效

**涉及文件**:
- 修改: `src/services/api/claude.ts` (buildSystemPromptBlocks 顺序保证)
- 修改: `src/services/compact/hardCompact.ts` (只截断不增删原则)
- 验证: `src/utils/api.ts` (boundary 处理逻辑)

**验收标准**:
- Compact 后首请求的 cache_read_input_tokens > 0（prefix 命中）
- 连续两次 compact 后 system prompt 静态部分字节一致

---

## Phase 4: 自修正循环 — Test-Driven Fix Loop [LOWER]

**核心问题**: 当前模型写代码后需人工验证，无法自动运行测试→捕获错误→修复循环。

**方案**: 添加 `/loop-test` 命令，封装测试驱动修复循环：

1. **解析项目测试框架**: 检测 jest/vitest/pytest/bun test 等
2. **循环逻辑**: 
   - 执行测试命令
   - 解析失败用例（正则提取文件名+行号+错误信息）
   - 生成修复 prompt
   - 应用修复
   - 重复直到全部通过或达到最大迭代次数
3. **安全边界**: 最大 5 轮，每轮 token 预算递减

**涉及文件**:
- 新建: `src/commands/loop-test/` (命令注册 + 循环逻辑)
- 修改: `src/commands.ts` (注册新命令)

**验收标准**:
- 对有 failing test 的项目，执行 `/loop-test` 后自动修复到全部通过
- 不超过 5 轮迭代
- 每轮输出清晰的测试结果摘要

---

## Phase 5: 多模型路由 — Fast/Slow Path [LOWER]

**核心问题**: 所有请求都走同一模型，简单意图（确认/取消/简单查询）浪费大模型资源。

**方案**: 
1. 意图分类层：1.5B/3B 模型快速分类（chat/code/complex）
2. 路由策略：chat→小模型，code/complex→大模型
3. 降级策略：小模型不可用时全部走大模型

**优先级低**的原因：当前本地模型选择有限，路由收益待验证。先聚焦 Phase 1-3。

---

## Phase 6: 仓库感知 — Tree-Sitter AST + RAG [LOWEST]

**核心问题**: 长对话中模型丢失文件上下文，无法按需检索代码。

**方案**:
1. Tree-Sitter AST 索引：解析项目文件结构，存储符号定义/引用关系
2. LanceDB RAG：向量索引代码片段，compact 后按需检索相关代码
3. HyDE 查询：用模型生成假设性文档，检索最相关片段注入 context

**优先级最低**的原因：实现复杂度高，收益需 Phase 1-3 先落地才能验证。

---

## 实施优先级总结

| Phase | 优先级 | 预估工时 | 核心收益 |
|-------|--------|---------|---------|
| 1. Hard Compact | HIGH | 2-3天 | 解决 MLX OOM 根因，零成本 compact |
| 2. 后端 GC | MEDIUM | 1天 | Compact 后立即释放内存 |
| 3. Prefix Cache | MEDIUM | 1-2天 | Compact 后首请求加速 |
| 4. 自修正循环 | LOWER | 2-3天 | 自动测试修复，减少人工 |
| 5. 多模型路由 | LOWER | 3-5天 | 简单请求加速，资源节省 |
| 6. 仓库感知 | LOWEST | 5-7天 | 长对话上下文保持 |

**建议先完成 Phase 1-3，验证 MLX 稳定性后再推进 4-6。**
