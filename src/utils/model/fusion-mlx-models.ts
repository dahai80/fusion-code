/**
 * Fusion-MLX 本地模型配置
 *
 * 管理 fusion-code 可用的本地模型配置。
 * 模型列表在运行时通过 fusion-mlx 的 /v1/models 动态获取，
 * 同时也提供静态配置作为回退。
 */

import type { MLXModelInfo } from '../../services/api/index.js'
import { getFusionMlxModels } from '../../services/api/index.js'

// ─── 本地模型配置 ────────────────────────────────────────────

export interface LocalModelConfig {
  id: string
  name: string
  description: string
  maxInputTokens: number
  maxOutputTokens: number
  supportsTools: boolean
  supportsVision: boolean
  supportsStreaming: boolean
  /** 推荐用于代码任务 */
  recommendedForCode: boolean
  /** 推荐用于快速任务（小模型） */
  recommendedForFast: boolean
}

/**
 * 静态本地模型配置（作为运行时检测的回退）。
 * 这些是常见的本地 MLX 模型配置。
 */
const STATIC_MODEL_CONFIGS: LocalModelConfig[] = [
  {
    id: 'default',
    name: 'MLX 默认模型',
    description: 'fusion-mlx 自动选择的默认模型',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    recommendedForCode: false,
    recommendedForFast: false,
  },
  {
    id: 'code',
    name: 'MLX 代码模型',
    description: 'fusion-mlx 代码专用模型',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    recommendedForCode: true,
    recommendedForFast: false,
  },
  {
    id: 'qwen2.5-coder',
    name: 'Qwen 2.5 Coder',
    description: 'Qwen 2.5 代码专用模型',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    recommendedForCode: true,
    recommendedForFast: false,
  },
  {
    id: 'deepseek-coder',
    name: 'DeepSeek Coder',
    description: 'DeepSeek 代码专用模型',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    recommendedForCode: true,
    recommendedForFast: false,
  },
  {
    id: 'codestral',
    name: 'Codestral',
    description: 'Mistral Codestral 代码模型',
    maxInputTokens: 32768,
    maxOutputTokens: 4096,
    supportsTools: true,
    supportsVision: false,
    supportsStreaming: true,
    recommendedForCode: true,
    recommendedForFast: false,
  },
  {
    id: 'llama3.2',
    name: 'Llama 3.2',
    description: 'Meta Llama 3.2 通用模型',
    maxInputTokens: 16384,
    maxOutputTokens: 2048,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    recommendedForCode: false,
    recommendedForFast: true,
  },
  {
    id: 'phi3',
    name: 'Phi-3',
    description: 'Microsoft Phi-3 轻量模型',
    maxInputTokens: 16384,
    maxOutputTokens: 2048,
    supportsTools: false,
    supportsVision: false,
    supportsStreaming: true,
    recommendedForCode: false,
    recommendedForFast: true,
  },
]

// ─── 模型配置管理 ────────────────────────────────────────────

let cachedModels: LocalModelConfig[] | null = null

/**
 * 获取可用本地模型列表。
 * 优先从运行时 fusion-mlx 获取，回退到静态配置。
 */
export async function getLocalModels(): Promise<LocalModelConfig[]> {
  if (cachedModels) return cachedModels

  try {
    // 尝试从 fusion-mlx 运行时获取
    const mlxModels = await getFusionMlxModels()
    if (mlxModels.length > 0) {
      cachedModels = mlxModels.map(mergeWithStaticConfig)
      return cachedModels
    }
  } catch {
    // 回退到静态配置
  }

  cachedModels = STATIC_MODEL_CONFIGS
  return cachedModels
}

/**
 * 将运行时模型信息与静态配置合并。
 */
function mergeWithStaticConfig(mlxModel: MLXModelInfo): LocalModelConfig {
  const staticConfig = STATIC_MODEL_CONFIGS.find(
    s => mlxModel.id.includes(s.id) || s.id.includes(mlxModel.id),
  )

  return {
    id: mlxModel.id,
    name: staticConfig?.name || mlxModel.id,
    description: staticConfig?.description || `fusion-mlx 模型: ${mlxModel.id}`,
    maxInputTokens: mlxModel.max_input_tokens || staticConfig?.maxInputTokens || 32768,
    maxOutputTokens: mlxModel.max_output_tokens || staticConfig?.maxOutputTokens || 4096,
    supportsTools: staticConfig?.supportsTools ?? true,
    supportsVision: staticConfig?.supportsVision ?? false,
    supportsStreaming: true,
    recommendedForCode: (staticConfig?.recommendedForCode ?? mlxModel.id.toLowerCase().includes('code')) || mlxModel.id.toLowerCase().includes('coder'),
    recommendedForFast: (staticConfig?.recommendedForFast ?? mlxModel.id.toLowerCase().includes('tiny')) || mlxModel.id.toLowerCase().includes('small') || mlxModel.id.toLowerCase().includes('3.2'),
  }
}

// ─── 默认模型选择 ────────────────────────────────────────────

/**
 * 获取推荐的代码模型。
 */
export async function getRecommendedCodeModel(): Promise<string | null> {
  const models = await getLocalModels()
  const codeModel = models.find(m => m.recommendedForCode)
  return codeModel?.id || models[0]?.id || null
}

/**
 * 获取推荐的快速模型（用于简单任务）。
 */
export async function getRecommendedFastModel(): Promise<string | null> {
  const models = await getLocalModels()
  const fastModel = models.find(m => m.recommendedForFast)
  return fastModel?.id || null
}

/**
 * 检查模型是否支持工具调用。
 */
export async function modelSupportsTools(modelId: string): Promise<boolean> {
  const models = await getLocalModels()
  const model = models.find(m => m.id === modelId || modelId.includes(m.id))
  return model?.supportsTools ?? true
}

/**
 * 清除模型缓存（在模型切换时调用）。
 */
export function clearModelCache(): void {
  cachedModels = null
}

/**
 * 设置默认模型选择策略。
 */
export type ModelSelectionStrategy = 'auto' | 'code' | 'fast' | 'manual'

export function getDefaultModelStrategy(): ModelSelectionStrategy {
  const strategy = process.env.FUSION_MLX_MODEL_STRATEGY as ModelSelectionStrategy | undefined
  if (strategy && ['auto', 'code', 'fast', 'manual'].includes(strategy)) {
    return strategy
  }
  return 'code'
}