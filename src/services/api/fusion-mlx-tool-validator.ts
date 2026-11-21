/**
 * fusion-mlx tool-call validator
 *
 * Eliminates tool-call JSON parse failures on the client side:
 * 1. cleanSchema: sanitizes tool schemas, removing complex nesting that trips up local models
 * 2. validateToolCall: strictly validates tool-call results returned by the model
 * 3. repairToolCall: attempts to repair common format errors
 */

/** Sanitize a single tool's inputSchema, removing malformed fields */
export function cleanSchema(schema: unknown): Record<string, unknown> {
	if (typeof schema !== "object" || schema === null) {
		return { type: "object", properties: {} };
	}
	const s = schema as Record<string, unknown>;
	const cleaned: Record<string, unknown> = {};

	if (typeof s.type === "string") {
		cleaned.type = s.type;
	} else {
		cleaned.type = "object";
	}

	if (s.properties && typeof s.properties === "object") {
		cleaned.properties = cleanProperties(
			s.properties as Record<string, unknown>,
		);
	} else {
		cleaned.properties = {};
	}

	if (Array.isArray(s.required)) {
		cleaned.required = s.required.filter((r: unknown) => typeof r === "string");
	}

	return cleaned;
}

/** Recursively sanitize a properties object */
function cleanProperties(
	props: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(props)) {
		if (typeof val !== "object" || val === null) continue;
		const v = val as Record<string, unknown>;
		const cleaned: Record<string, unknown> = {};
		if (typeof v.type === "string") cleaned.type = v.type;
		if (typeof v.description === "string") {
			cleaned.description =
				v.description.length > MLX_MAX_PROPERTY_DESCRIPTION_LENGTH
					? `${v.description.slice(0, MLX_MAX_PROPERTY_DESCRIPTION_LENGTH).replace(/\s+\S*$/, "")}...`
					: v.description;
		}
		if (v.enum && Array.isArray(v.enum)) cleaned.enum = v.enum;
		if (v.items) cleaned.items = cleanSchema(v.items);
		if (v.properties && typeof v.properties === "object") {
			cleaned.properties = cleanProperties(
				v.properties as Record<string, unknown>,
			);
		}
		if (Array.isArray(v.required)) {
			cleaned.required = v.required.filter(
				(r: unknown) => typeof r === "string",
			);
		}
		// Remove additionalProperties, $schema, default and other fields that confuse local models
		result[key] = cleaned;
	}
	return result;
}

// Local models have limited context — truncate tool descriptions to save tokens.
const MLX_MAX_DESCRIPTION_LENGTH = 200;
const MLX_MAX_PROPERTY_DESCRIPTION_LENGTH = 80;

/** Batch-sanitize an Anthropic tool list into MLX-safe format */
export function cleanToolList(tools: unknown[]): unknown[] {
	if (!Array.isArray(tools)) return [];
	return tools
		.map((tool) => {
			if (typeof tool !== "object" || tool === null) return null;
			const t = tool as Record<string, unknown>;
			const desc = typeof t.description === "string" ? t.description : "";
			return {
				name: t.name,
				description:
					desc.length > MLX_MAX_DESCRIPTION_LENGTH
						? `${desc.slice(0, MLX_MAX_DESCRIPTION_LENGTH).replace(/\s+\S*$/, "")}...`
						: desc,
				input_schema: cleanSchema(t.input_schema ?? t.inputSchema ?? t.schema),
			};
		})
		.filter(Boolean);
}

/** Tool-call result validator */
export interface ValidationResult {
	valid: boolean;
	error?: string;
	repaired?: unknown;
}

/** Validate and attempt to repair the tool-call JSON returned by the model */
export function validateToolCall(
	rawArgs: string,
	expectedSchema?: unknown,
): ValidationResult {
	if (!rawArgs || typeof rawArgs !== "string") {
		return { valid: false, error: "tool arguments are empty" };
	}

	// Try direct JSON.parse
	let parsed: unknown;
	let wasRepaired = false;
	try {
		parsed = JSON.parse(rawArgs);
	} catch (e) {
		// JSON parse failed; try repairing common errors
		const repaired = repairJson(rawArgs);
		if (repaired !== null) {
			try {
				parsed = JSON.parse(repaired);
				wasRepaired = true;
			} catch {
				return {
					valid: false,
					error: `JSON parse failed: ${(e as Error).message}`,
				};
			}
		} else {
			return {
				valid: false,
				error: `JSON parse failed: ${(e as Error).message}`,
			};
		}
	}

	// Schema conformance check: verify required fields exist and types match
	if (
		expectedSchema &&
		typeof expectedSchema === "object" &&
		parsed &&
		typeof parsed === "object"
	) {
		const schema = expectedSchema as Record<string, unknown>;
		const obj = parsed as Record<string, unknown>;
		const errors: string[] = [];

		// Check required fields
		if (Array.isArray(schema.required)) {
			for (const req of schema.required) {
				if (typeof req !== "string") continue;
				if (!(req in obj)) {
					errors.push(`missing required field "${req}"`);
				}
			}
		}

		// Check property types
		if (schema.properties && typeof schema.properties === "object") {
			const props = schema.properties as Record<string, unknown>;
			for (const [key, propDef] of Object.entries(props)) {
				if (typeof propDef !== "object" || propDef === null) continue;
				const pDef = propDef as Record<string, unknown>;
				const value = obj[key];
				if (value === undefined) continue; // missing optional fields are OK
				if (pDef.type === "string" && typeof value !== "string") {
					errors.push(`field "${key}" should be string, got ${typeof value}`);
				} else if (pDef.type === "number" && typeof value !== "number") {
					errors.push(`field "${key}" should be number, got ${typeof value}`);
				} else if (pDef.type === "boolean" && typeof value !== "boolean") {
					errors.push(`field "${key}" should be boolean, got ${typeof value}`);
				} else if (pDef.type === "array" && !Array.isArray(value)) {
					errors.push(`field "${key}" should be array, got ${typeof value}`);
				} else if (
					pDef.type === "object" &&
					(typeof value !== "object" || value === null || Array.isArray(value))
				) {
					errors.push(`field "${key}" should be object`);
				}
			}
		}

		if (errors.length > 0) {
			// Schema mismatch — still pass the parsed result but flag the error
			// Tool-level Zod validation will catch these, but early detection
			// helps with debugging and avoids confusing downstream errors
			return {
				valid: true,
				repaired: parsed,
				error: `schema issues: ${errors.join("; ")}`,
			};
		}
	}

	if (wasRepaired) {
		return { valid: true, repaired: parsed, error: "auto-repaired" };
	}
	return { valid: true, repaired: parsed };
}

/** Repair common JSON format errors from the model */
function repairJson(raw: string): string | null {
	let s = raw.trim();

	// 1. Strip leading/trailing markdown code fence markers
	const fenceOpen = /^```(?:json)?\s*/i;
	const fenceClose = /\s*```$/i;
	s = s.replace(fenceOpen, "").replace(fenceClose, "");

	// 2. Complete missing closing brackets
	const openBraces = (s.match(/\{/g) || []).length;
	const closeBraces = (s.match(/\}/g) || []).length;
	if (openBraces > closeBraces) {
		s += "}";
	}
	const openParens = (s.match(/\[/g) || []).length;
	const closeParens = (s.match(/\]/g) || []).length;
	if (openParens > closeParens) {
		s += "]";
	}

	// 3. Repair unquoted string values (keyword followed by comma or closing bracket)
	const unquotedValue = /:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s([,}\]])/g;
	s = s.replace(unquotedValue, ': "$1"$2');
	const unquotedValueEnd = /:\s*([a-zA-Z_][a-zA-Z0-9_]*)$/g;
	s = s.replace(unquotedValueEnd, ': "$1"');

	// 4. Remove trailing commas
	const trailingComma = /,\s*([}\]])/g;
	s = s.replace(trailingComma, "$1");

	// 5. Convert single quotes to double quotes
	s = s.replace(/'/g, '"');

	// 6. Handle truncated JSON (truncate at the last complete key-value pair and close it)
	if (s.includes("{") && !s.endsWith("}") && !s.endsWith("]")) {
		const lastComma = s.lastIndexOf(",");
		const lastColonStr = s.lastIndexOf(': "');
		const lastColonObj = s.lastIndexOf(": {");
		const lastCompletePos = Math.max(lastComma, lastColonStr, lastColonObj);
		if (lastCompletePos > 0) {
			const truncated = s.slice(0, lastCompletePos).replace(/,\s*$/, "");
			const openB = (truncated.match(/\{/g) || []).length;
			const closeB = (truncated.match(/\}/g) || []).length;
			let result = truncated;
			for (let i = 0; i < openB - closeB; i++) result += "}";
			return result;
		}
	}

	return s;
}
