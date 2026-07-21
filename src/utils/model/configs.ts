import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

// ─── Fusion-MLX 本地模型配置 ─────────────────────────────────
// 这些模型 ID 对应 fusion-mlx 上可用的本地模型。
// 实际可用模型列表在运行时通过 /v1/models 动态获取。

export const FUSION_MLX_DEFAULT_CONFIG = {
  firstParty: 'fusion-mlx-local',
  bedrock: 'fusion-mlx-local',
  vertex: 'fusion-mlx-local',
  foundry: 'fusion-mlx-local',
  openai: 'fusion-mlx-local',
  fusionMlx: 'default', // fusion-mlx 自动选择默认模型
} as const satisfies ModelConfig

export const FUSION_MLX_CODE_CONFIG = {
  firstParty: 'fusion-mlx-code',
  bedrock: 'fusion-mlx-code',
  vertex: 'fusion-mlx-code',
  foundry: 'fusion-mlx-code',
  openai: 'fusion-mlx-code',
  fusionMlx: 'code', // fusion-mlx 代码专用模型
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Add a new CLAUDE_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const CLAUDE_3_7_SONNET_CONFIG = {
  firstParty: 'claude-3-7-sonnet-20250219',
  bedrock: 'claude-3-7-sonnet-20250219',
  vertex: 'claude-3-7-sonnet@20250219',
  foundry: 'claude-3-7-sonnet',
  openai: 'claude-3-7-sonnet-20250219',
} as const satisfies ModelConfig

export const CLAUDE_3_5_V2_SONNET_CONFIG = {
  firstParty: 'claude-3-5-sonnet-20241022',
  bedrock: 'claude-3-5-sonnet-20241022',
  vertex: 'claude-3-5-sonnet-v2@20241022',
  foundry: 'claude-3-5-sonnet',
  openai: 'claude-3-5-sonnet-20241022',
} as const satisfies ModelConfig

export const CLAUDE_3_5_HAIKU_CONFIG = {
  firstParty: 'claude-3-5-haiku-20241022',
  bedrock: 'claude-3-5-haiku-20241022',
  vertex: 'claude-3-5-haiku@20241022',
  foundry: 'claude-3-5-haiku',
  openai: 'claude-3-5-haiku-20241022',
} as const satisfies ModelConfig

export const CLAUDE_HAIKU_4_5_CONFIG = {
  firstParty: 'claude-haiku-4-5-20251001',
  bedrock: 'claude-haiku-4-5-20251001',
  vertex: 'claude-haiku-4-5@20251001',
  foundry: 'claude-haiku-4-5',
  openai: 'claude-haiku-4-5-20251001',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_CONFIG = {
  firstParty: 'claude-sonnet-4-20250514',
  bedrock: 'claude-sonnet-4-20250514',
  vertex: 'claude-sonnet-4@20250514',
  foundry: 'claude-sonnet-4',
  openai: 'claude-sonnet-4-20250514',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_5_CONFIG = {
  firstParty: 'claude-sonnet-4-5-20250929',
  bedrock: 'claude-sonnet-4-5-20250929',
  vertex: 'claude-sonnet-4-5@20250929',
  foundry: 'claude-sonnet-4-5',
  openai: 'claude-sonnet-4-5-20250929',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_CONFIG = {
  firstParty: 'claude-opus-4-20250514',
  bedrock: 'claude-opus-4-20250514',
  vertex: 'claude-opus-4@20250514',
  foundry: 'claude-opus-4',
  openai: 'claude-opus-4-20250514',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_1_CONFIG = {
  firstParty: 'claude-opus-4-1-20250805',
  bedrock: 'claude-opus-4-1-20250805',
  vertex: 'claude-opus-4-1@20250805',
  foundry: 'claude-opus-4-1',
  openai: 'claude-opus-4-1-20250805',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_5_CONFIG = {
  firstParty: 'claude-opus-4-5-20251101',
  bedrock: 'claude-opus-4-5-20251101',
  vertex: 'claude-opus-4-5@20251101',
  foundry: 'claude-opus-4-5',
  openai: 'claude-opus-4-5-20251101',
} as const satisfies ModelConfig

export const CLAUDE_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'claude-opus-4-6',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
  openai: 'claude-opus-4-6',
} as const satisfies ModelConfig

export const CLAUDE_SONNET_4_6_CONFIG = {
  firstParty: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  vertex: 'claude-sonnet-4-6',
  foundry: 'claude-sonnet-4-6',
  openai: 'claude-sonnet-4-6',
} as const satisfies ModelConfig

// OpenAI Codex models
export const GPT_5_4_CONFIG = {
  firstParty: 'gpt-5.4',
  bedrock: 'gpt-5.4',
  vertex: 'gpt-5.4',
  foundry: 'gpt-5.4',
  openai: 'gpt-5.4',
} as const satisfies ModelConfig

export const GPT_5_3_CODEX_CONFIG = {
  firstParty: 'gpt-5.3-codex',
  bedrock: 'gpt-5.3-codex',
  vertex: 'gpt-5.3-codex',
  foundry: 'gpt-5.3-codex',
  openai: 'gpt-5.3-codex',
} as const satisfies ModelConfig

export const GPT_5_4_MINI_CONFIG = {
  firstParty: 'gpt-5.4-mini',
  bedrock: 'gpt-5.4-mini',
  vertex: 'gpt-5.4-mini',
  foundry: 'gpt-5.4-mini',
  openai: 'gpt-5.4-mini',
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: CLAUDE_3_5_HAIKU_CONFIG,
  haiku45: CLAUDE_HAIKU_4_5_CONFIG,
  sonnet35: CLAUDE_3_5_V2_SONNET_CONFIG,
  sonnet37: CLAUDE_3_7_SONNET_CONFIG,
  sonnet40: CLAUDE_SONNET_4_CONFIG,
  sonnet45: CLAUDE_SONNET_4_5_CONFIG,
  sonnet46: CLAUDE_SONNET_4_6_CONFIG,
  opus40: CLAUDE_OPUS_4_CONFIG,
  opus41: CLAUDE_OPUS_4_1_CONFIG,
  opus45: CLAUDE_OPUS_4_5_CONFIG,
  opus46: CLAUDE_OPUS_4_6_CONFIG,
  // OpenAI Codex models
  gpt54: GPT_5_4_CONFIG,
  gpt53codex: GPT_5_3_CODEX_CONFIG,
  gpt54mini: GPT_5_4_MINI_CONFIG,
  // Fusion-MLX 本地模型
  fusionMlxDefault: FUSION_MLX_DEFAULT_CONFIG,
  fusionMlxCode: FUSION_MLX_CODE_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'claude-opus-4-6' | 'claude-sonnet-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
