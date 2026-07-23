# fusion-code 性能基准 (Benchmarks)

本目录包含 fusion-code 的性能基准测试脚本，用于量化二进制启动速度、构建耗时、产物体积和本地 MLX 推理延迟。

## 运行方法

```bash
# 在仓库根目录执行
bun run benchmarks/benchmark.ts
```

前置条件：

- 已安装 [Bun](https://bun.sh) >= 1.3.11
- 已执行过 `bun install`
- （可选）已运行 `bun run build` 生成 `./fusion-code` 二进制
- （可选）fusion-mlx 服务在 `127.0.0.1:11434` 监听（用于推理延迟测试）

如果 `./fusion-code` 二进制不存在，启动时间和体积测试会被跳过并记录日志。如果 11434 端口未监听，推理延迟测试会被跳过。

## 各指标说明

| 指标 | 测量方法 | 说明 |
|---|---|---|
| 二进制启动时间 | 多次运行 `./fusion-code --version` 计时 | 反映冷启动开销，取 5 次运行的 avg/min/max |
| 构建时间 | 执行 `bun run build` 全流程计时 | 包含 Bun 编译、minify、bytecode 全过程 |
| 二进制大小 | `stat ./fusion-code` | 编译后单文件体积（通常约 145 MB） |
| MLX 推理延迟 | 向 `127.0.0.1:11434/v1/chat/completions` 发送流式请求 | 测量首 token 延迟和总耗时；端口未监听时自动跳过 |

## results.json 格式

每次运行后，结果会写入 `benchmarks/results.json`，结构如下：

```json
{
    "timestamp": "2026-07-23T12:00:00.000Z",
    "version": "0.2.0 (Fusion-Code)",
    "binaryPath": "/path/to/fusion-code",
    "startupTime": {
        "avg": 120.5,
        "min": 115.2,
        "max": 130.8,
        "runs": [118, 122, 115, 120, 130]
    },
    "buildTime": {
        "ms": 45000,
        "success": true
    },
    "binarySize": {
        "bytes": 152000000,
        "mb": "145.0 MB"
    },
    "mlxInference": {
        "available": true,
        "model": "qwen3-coder-30b",
        "firstTokenMs": 85.3,
        "totalMs": 210.5,
        "error": null
    }
}
```

字段含义：

- `timestamp` — 基准运行时间（ISO 8601）
- `version` — 二进制版本号（来自 `--version` 输出）
- `startupTime` — 启动时间统计（单位 ms），`null` 表示二进制不存在
- `buildTime` — 构建耗时（单位 ms）及是否成功
- `binarySize` — 二进制体积（bytes + 人类可读 MB）
- `mlxInference` — MLX 推理延迟；`available` 为 `false` 时其余字段为 `null`

## 如何对比版本

对比两个版本的性能表现：

```bash
# 1. 在当前版本运行基准
bun run benchmarks/benchmark.ts
cp benchmarks/results.json benchmarks/results-old.json

# 2. 切换到另一个版本（git checkout / git pull / rebuild）
git checkout v2.2.0
bun run build

# 3. 再次运行基准
bun run benchmarks/benchmark.ts

# 4. 手动对比两个 JSON 文件
diff benchmarks/results-old.json benchmarks/results.json
```

重点关注：

- `startupTime.avg` 是否回归（增大说明启动变慢）
- `buildTime.ms` 是否回归
- `binarySize.bytes` 是否异常膨胀
- `mlxInference.firstTokenMs` 和 `totalMs` 是否改善

## 依赖

| 依赖 | 用途 | 必需 |
|---|---|---|
| Bun >= 1.3.11 | 运行基准脚本 + 构建二进制 | 是 |
| fusion-mlx (port 11434) | 本地 MLX 推理延迟测试 | 否（自动跳过） |

## 注意事项

- 构建时间测试会实际执行 `bun run build`，耗时通常在 30-90 秒，会覆盖现有 `./fusion-code` 二进制。
- 推理延迟测试发送的请求为 `Say hello in one word.`，`max_tokens` 设为 16，不会产生显著负载。
- 脚本设计为失败不崩溃：任何步骤出错都会被 try/catch 捕获并记录日志，最终仍输出 results.json。
