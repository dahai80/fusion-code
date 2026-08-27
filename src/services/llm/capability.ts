// LlmCapability seam (ar-plan PR #3, S1.a).
// Provider-neutral capability interface — centralizes per-model/provider
// capability facts so consumers can read ctx.llm.supportsX() instead of
// scattering provider-if branches. Old provider-if paths stay intact
// (ctx-optional fallback = byte-identical); this seam is the future home.
import { logForDebugging } from "../../utils/debug.js";
import { getMlxModelCapabilities } from "../api/fusion-mlx-adapter.js";
import type { MlxModelCapabilities } from "../api/fusion-mlx-adapter.js";
import { getCanonicalName } from "../../utils/model/model.js";
import { getAPIProvider } from "../../utils/model/providers.js";
import type { APIProvider } from "../../utils/model/providers.js";

export interface LlmCapability {
	readonly provider: APIProvider;
	readonly modelId: string;
	supportsStreaming(): boolean;
	supportsVision(): boolean;
	supportsToolCalling(): boolean;
	supportsStructuredOutput(): boolean;
	supportsThinking(): boolean;
	maxInputTokens(): number;
	maxOutputTokens(): number;
}

// Conservative defaults for unknown model ids (arch-ecosystem appendix A.4):
// do not pre-judge unknown ids. Stream + tool-calling on (most instruct models
// support them), vision + structured off (require explicit opt-in signal).
const DEFAULT_MAX_INPUT = 200_000;
const DEFAULT_MAX_OUTPUT = 8_192;

// FirstParty (Anthropic API) capability by canonical model id.
// Mirrors getModelMaxOutputTokens() static table + modelSupports*() logic in
// betas.ts/thinking.ts. Tool calling + streaming assumed on for all 1P models.
const FIRSTPARTY_MAX_OUTPUT: Record<string, number> = {
	"opus-4-6": 128_000,
	"sonnet-4-6": 128_000,
	"opus-4-5": 64_000,
	"sonnet-4": 64_000,
	"haiku-4": 64_000,
	"opus-4-1": 32_000,
	"opus-4": 32_000,
	"claude-3-opus": 4_096,
	"claude-3-sonnet": 8_192,
	"claude-3-haiku": 4_096,
	"3-5-sonnet": 8_192,
	"3-5-haiku": 8_192,
	"3-7-sonnet": 64_000,
};

function firstPartySupportsStructuredOutput(canonical: string): boolean {
	return (
		canonical.includes("claude-sonnet-4-6") ||
		canonical.includes("claude-sonnet-4-5") ||
		canonical.includes("claude-opus-4-1") ||
		canonical.includes("claude-opus-4-5") ||
		canonical.includes("claude-opus-4-6") ||
		canonical.includes("claude-haiku-4-5")
	);
}

export class MlxCapabilityProvider implements LlmCapability {
	readonly provider: APIProvider = "fusionMlx";
	readonly modelId: string;
	private readonly caps: MlxModelCapabilities;

	constructor(modelId: string, caps: MlxModelCapabilities) {
		this.modelId = modelId;
		this.caps = caps;
	}

	static async create(modelId: string): Promise<MlxCapabilityProvider> {
		const caps = await getMlxModelCapabilities(modelId);
		logForDebugging(
			`[ctx.llm] MlxCapabilityProvider for ${modelId}: toolCalling=${caps.supportsToolCalling} vision=${caps.supportsVision} structured=${caps.supportsStructuredOutput}`,
		);
		return new MlxCapabilityProvider(modelId, caps);
	}

	supportsStreaming(): boolean {
		return this.caps.supportsStreaming;
	}
	supportsVision(): boolean {
		return this.caps.supportsVision;
	}
	supportsToolCalling(): boolean {
		return this.caps.supportsToolCalling;
	}
	supportsStructuredOutput(): boolean {
		return this.caps.supportsStructuredOutput;
	}
	supportsThinking(): boolean {
		// MLX model names don't match sonnet-4/opus-4 → old path returns false.
		// Local models lack the thinking protocol; keep parity.
		return false;
	}
	maxInputTokens(): number {
		return this.caps.maxContextTokens;
	}
	maxOutputTokens(): number {
		return this.caps.maxOutputTokens;
	}
}

export class FirstPartyCapabilityProvider implements LlmCapability {
	readonly provider: APIProvider = "firstParty";
	readonly modelId: string;
	private readonly canonical: string;

	constructor(modelId: string) {
		this.modelId = modelId;
		this.canonical = getCanonicalName(modelId);
	}

	supportsStreaming(): boolean {
		return true;
	}
	supportsVision(): boolean {
		// Claude 3+ models support image input. No consumer migrated yet; this
		// is a forward-looking fact for the ctx.fs/vision seam (PR #4+).
		return true;
	}
	supportsToolCalling(): boolean {
		return true;
	}
	supportsStructuredOutput(): boolean {
		return firstPartySupportsStructuredOutput(this.canonical);
	}
	supportsThinking(): boolean {
		// Mirrors modelSupportsThinking() 1P branch: all non-claude-3- models.
		return !this.canonical.includes("claude-3-");
	}
	maxInputTokens(): number {
		return DEFAULT_MAX_INPUT;
	}
	maxOutputTokens(): number {
		for (const key of Object.keys(FIRSTPARTY_MAX_OUTPUT)) {
			if (this.canonical.includes(key)) {
				return FIRSTPARTY_MAX_OUTPUT[key]!;
			}
		}
		return DEFAULT_MAX_OUTPUT;
	}
}

export class GatewayCapabilityProvider implements LlmCapability {
	readonly provider: APIProvider;
	readonly modelId: string;
	private readonly canonical: string;

	constructor(modelId: string, provider: APIProvider) {
		this.modelId = modelId;
		this.provider = provider;
		this.canonical = getCanonicalName(modelId);
	}

	supportsStreaming(): boolean {
		return true;
	}
	supportsVision(): boolean {
		return false;
	}
	supportsToolCalling(): boolean {
		return true;
	}
	supportsStructuredOutput(): boolean {
		// Structured outputs only firstParty/foundry per modelSupportsStructuredOutputs.
		return this.provider === "foundry";
	}
	supportsThinking(): boolean {
		// Foundry mirrors 1P (all non-claude-3-). Bedrock/Vertex/OpenAI: only
		// sonnet-4/opus-4 per modelSupportsThinking() 3P branch.
		if (this.provider === "foundry") {
			return !this.canonical.includes("claude-3-");
		}
		return (
			this.canonical.includes("sonnet-4") ||
			this.canonical.includes("opus-4")
		);
	}
	maxInputTokens(): number {
		return DEFAULT_MAX_INPUT;
	}
	maxOutputTokens(): number {
		return DEFAULT_MAX_OUTPUT;
	}
}

// Factory: resolve provider from env + model, build the right LlmCapability.
export async function createLlmCapability(
	modelId: string,
): Promise<LlmCapability> {
	const provider = getAPIProvider(modelId);
	switch (provider) {
		case "fusionMlx":
			return MlxCapabilityProvider.create(modelId);
		case "firstParty":
			return new FirstPartyCapabilityProvider(modelId);
		case "foundry":
		case "bedrock":
		case "vertex":
		case "openai":
			return new GatewayCapabilityProvider(modelId, provider);
	}
}
