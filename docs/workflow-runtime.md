# Workflow Runtime (item 25A)

最小 workflow 执行 runtime。落地于 PR #105 (closes #104, CC 2.1.229)。

## 概述

`WorkflowTool.execute()` 原为纯验证桩——生成 `runId`、检查 `export const meta`、写 `activeRuns`、立即返回 `status:"started"`，**从不执行脚本**。

item 25A 落地最小可执行 runtime：脚本能跑 `agent()`/`parallel()`/`pipeline()`/`phase()`/`log()`，产出结果，`runId` 传播到 transcript + telemetry。

## 双门禁 (default-off)

两层都满足才执行 runtime，否则 byte-identical 旧桩：

1. **编译期**: `feature("WORKFLOW_SCRIPTS")` —— 仅 `build:dev:full` 启用 (加入 `scripts/build.ts` `fullExperimentalFeatures`)。标准构建里 runtime 死码消除。
2. **运行期**: `FUSION_WORKFLOW_RUNTIME_ENABLED=1` env。

### 启用

```bash
# dev:full 构建 (含 runtime)
bun run build:dev:full

# 运行时开 env
FUSION_WORKFLOW_RUNTIME_ENABLED=1 ./fusion-code-dev
```

未设 env → Workflow 工具返回 `started` 桩，不执行 (byte-identical 旧行为)。

## 脚本契约

脚本 = JS 模块体，以 `export const meta` 开头，然后用裸全局调原语，`args` 作全局：

```js
export const meta = {
    name: "find-flaky-tests",
    description: "Find flaky tests and propose fixes",
    phases: [{ title: "Scan" }, { title: "Fix" }],
}

phase("Scan")
const flaky = await agent("grep CI logs for retry markers")
const fixed = await parallel([() => agent(`fix ${flaky}`)])
return fixed
```

YAML 源经 `yamlLoader.ts` 转成此 JS 串。

## 原语

| 原语 | 行为 |
|------|------|
| `agent(prompt, opts?)` | drain `runAgent` → `getAssistantMessageText` 取最终 assistant 文本。`opts: { label?, phase?, model?, effort?, agentType? }`。subagent 死/无文本 → `null` |
| `parallel(thunks)` | `Array<()=>Promise>`，并发限流 `min(16, cpu-2)`。每 thunk throw→该项 `null` (不 reject 整体) |
| `pipeline(items, ...stages)` | 每 item 独立穿所有 stage (无 barrier)。stage `(prev, original, index)`。stage throw→该 item drop `null` |
| `phase(title)` | 记当前 phase 名 (progress 分组) + `emitPerfettoInstant` |
| `log(message)` | `onProgress?.({type:"log"})` + `logForDebugging` |
| `workflow(nameOrRef, args)` | **DEFERRED**: 嵌套 workflow。v1 抛 `Error("not supported in minimal runtime")` |
| `budget` | **DEFERRED**: stub `{ total: null, spent: 0, remaining: Infinity }` |
| `args` | 从 tool input 透传 |

### DEFERRED v1

- **`schema`** (agent() 结构化输出): 传 `opts.schema` 记 warn 忽略，返回纯文本。需 StructuredOutput 工具注入，超 v1。
- **嵌套 `workflow()`**: spec 限一层，v1 抛 NotImplemented。
- **`budget`**: stub，无真实 token 预算强制。

## Eval 路径

`evaluateScript(scriptSource, primitives)` (`runtime.ts`):

1. `export const meta` → `const __meta__` (去 export 关键字)
2. 包 `async function _w(){...}` (使顶层 await/return 合法)
3. `new Bun.Transpiler({ loader: "ts" }).transformSync()` (剥 TS 类型注解)
4. 拆包 → 花括号平衡计数器抽 meta (支持嵌套对象 + 字符串含 `}`) → 剥 meta 语句 → body
5. 校验无残留语句级 `export`
6. `new Function("args","agent","parallel","pipeline","phase","log","workflow","budget", "return (async()=>{<body>})();")` —— 原语作函数参数在作用域内，顶层 await/return 在 async IIFE 内合法

转译失败 → 退回原串抽 meta (仅支持纯 JS 源)。

## 安全

model-authored 脚本经 `new Function` 在全局作用域跑，理论可触危险全局。**不做完整 sandbox** (Bun 无 Node vm 等价)。靠双门禁防护：仅 opted-in dev-full 用户 + 显式 env。对齐 CC 自身 Workflow 工具 (同样跑 model-authored 脚本，接受此风险)。完整沙箱超 v1 范围。

## runId 传播

- `transcriptSubdir: "workflows/<runId>"` → `runAgent` → 子代理 transcript 落 `subagents/workflows/<runId>/agent-<id>.jsonl` (0 caller → 接通)
- `emitPerfettoInstant("workflow_run_started|completed|error|agent_start|agent_end|phase", "workflow", {runId, ...})` → trace event args
- `activeRuns` Map: `running` → `completed`/`error` (原只写 `started`)

## 关键文件

- `src/tools/WorkflowTool/runtime.ts` — runtime 核心 (executeWorkflow + evaluateScript + 原语 + 并发池 + isWorkflowRuntimeEnabled)
- `src/tools/WorkflowTool/WorkflowTool.ts` — 双门禁分支 + activeRuns 生命周期 + emitPerfettoInstant
- `scripts/build.ts` — `WORKFLOW_SCRIPTS` 入 fullExperimentalFeatures
- `src/__tests__/workflowRuntime.test.ts` — 23 单测
