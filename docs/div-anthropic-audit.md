# 去 Anthropic SDK 审计清单

> 分支 feat/div-anthropic 基线 (2026-08-15)
> typecheck/test/build 全绿 | 38 tests 0 fail | bundle 162650210 bytes

## 运行时 (value) import @anthropic-ai/sdk

src/components/agents/new-agent-creation/wizard-steps/GenerateStep.tsx
src/hooks/useCanUseTool.tsx
src/services/api/client.ts
src/services/api/errors.ts
src/services/api/logging.ts
src/services/api/withRetry.ts
src/services/compact/compact.ts
src/tools/BashTool/bashPermissions.ts
src/types/anthropic-protocol.ts
src/utils/permissions/permissions.ts

## 类型 (type-only) import @anthropic-ai/sdk

src/types/anthropic-protocol.ts

## anthropic-protocol.ts 垫片消费者数
     103

## package.json @anthropic-ai/* 依赖
		"@anthropic-ai/claude-agent-sdk": "^0.2.87",
		"@anthropic-ai/foundry-sdk": "^0.2.3",
		"@anthropic-ai/mcpb": "^2.1.2",
		"@anthropic-ai/sandbox-runtime": "^0.0.44",
		"@anthropic-ai/sdk": "^0.80.0",
