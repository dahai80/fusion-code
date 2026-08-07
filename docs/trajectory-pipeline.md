# D1 轨迹飞轮 (Trajectory Flywheel)

> Issues: #50 (统一汇聚目录 + is_error 标注) · #51 (三格式导出 CLI: SFT/DPO/GRPO)

fusion-code 在每次会话中产生丰富的工具调用轨迹 (tool_use ↔ tool_result 配对, 含 `is_error` 信号)。
D1 轨迹飞轮把这些散落的 session jsonl 清洗、汇聚、标注, 导出为 fusion-trainer 可消费的标准训练格式,
形成"使用 → 采集 → 训练 → 更强模型 → 更好使用"的数据飞轮。

## 数据流

```
~/.fusion-code/projects/<cwd-slug>/<session-id>.jsonl   (源: 每次会话产生)
            │  collect
            ▼
~/.fusion/trajectories/
  ├── manifest.json          (汇聚清单 + 统计)
  └── raw/<product>-<session>.jsonl   (清洗后的 TrajectoryStep 序列)
            │  export --format
            ▼
~/.fusion/trajectories/{sft,dpo,grpo}.jsonl   (训练集, fusion-trainer 消费)
```

## 标注规则

每条 session 轨迹按 `tool_result.is_error` 标注:

- **positive** — 全程无任何 `is_error=true` 的 tool_result。理想成功轨迹, 进入 SFT。
- **self_correction** — 至少一次 tool 失败后模型自我纠正。进入 DPO (失败作 rejected / 最终成功作 chosen) 与 GRPO (reward=0)。

## CLI 用法

`trajectory` 是 fusion-code 的顶层快速子命令 (无需进入 REPL):

```bash
# 1. 收集: 扫描 session jsonl, 清洗配对, 汇聚标注
fusion-code trajectory collect [--source DIR] [--dest DIR] [--product NAME]
#   --source  session jsonl 根目录, 默认 ~/.fusion-code/projects
#   --dest    汇聚目录, 默认 ~/.fusion/trajectories
#   --product 产品标记, 默认 fusion-code

# 2. 导出: 从汇聚库导出训练集
fusion-code trajectory export --format sft|dpo|grpo [--dest DIR] [--session ID]
#   --format  必填: sft | dpo | grpo
#   --dest    汇聚库目录 (collect 的 --dest), 输出也写入该目录
#   --session 仅导出指定 session

# 3. 查看
fusion-code trajectory manifest [--dest DIR]   # 汇聚清单 + 逐 session 统计
fusion-code trajectory list     [--dest DIR]   # 轻量列表
```

## 输出格式

### SFT (ShareGPT messages-JSONL)

仅 `positive` 轨迹。每行:

```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful coding assistant."},
    {"role": "user", "content": "<首轮 user prompt>"},
    {"role": "assistant", "content": "<整段 assistant 轨迹: thinking + tool_call + final>"}
  ],
  "source": "<原始 session jsonl 路径>"
}
```

### DPO (偏好对)

仅 `self_correction` 轨迹。每行:

```json
{
  "prompt": "<首轮 user prompt>",
  "chosen": "<最终成功 answer (理想正确响应)>",
  "rejected": "<含失败 tool_result 的整段 assistant 轨迹>",
  "source": "<原始 session jsonl 路径>"
}
```

### GRPO (prompt + reward)

全部轨迹。每行:

```json
{
  "prompt": "<首轮 user prompt>",
  "completion": "<整段 assistant 轨迹>",
  "reward": 1,
  "source": "<原始 session jsonl 路径>"
}
```

## 模块结构

```
src/services/trajectory/
  types.ts       共享类型 (ToolCall/ToolResult/TrajectoryStep/CollectedTrajectory/...)
  collector.ts   #50 汇聚器: collectTrajectories / readManifest / loadCollectedTrajectory
  exporters.ts   #51 导出器: exportTrajectories / toSFTSample / toGRPOSample / buildDPOPairs
  index.ts       统一出口
src/cli/handlers/trajectory.ts   CLI 处理器 (trajectoryMain)
src/entrypoints/cli.tsx          快速路径注册 (args[0] === "trajectory")
src/__tests__/trajectory/trajectory.test.ts   11 用例
```

## 测试

```bash
bun test src/__tests__/trajectory/trajectory.test.ts
# 11 pass — collect 正例/自纠正标注, raw+manifest 落盘, 空会话跳过,
#           SFT 仅正例, DPO 自纠正对, GRPO 全量 reward 0/1, 单元变换
```

## 与 fusion-trainer 的衔接

导出的 `sft.jsonl` / `dpo.jsonl` / `grpo.jsonl` 落在 `~/.fusion/trajectories/`,
fusion-trainer 直接读取作为训练数据集:
- SFT → 监督微调 (教模型复现成功轨迹)
- DPO → 偏好优化 (惩罚失败轨迹, 强化正确回答)
- GRPO → 强化学习 (reward 信号驱动策略优化)
