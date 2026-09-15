import type { McpbManifestAny } from "../../vendor/mcpb/types.js"; // log: vendored from @anthropic-ai/mcpb (MIT) — div-anthropic refactor
import { errorMessage } from "../errors.js";
import { jsonParse } from "../slowOperations.js";

export async function validateManifest(
	manifestJson: unknown,
): Promise<McpbManifestAny> {
	const { McpbManifestSchema } = await import(
		"../../vendor/mcpb/schemas/any.js"
	);
	const parseResult = McpbManifestSchema.safeParse(manifestJson);

	if (!parseResult.success) {
		const errors = parseResult.error.flatten();
		const errorMessages = [
			...Object.entries(errors.fieldErrors).map(
				([field, errs]) =>
					`${field}: ${(errs as string[] | undefined)?.join(", ")}`,
			),
			...(errors.formErrors || []),
		]
			.filter(Boolean)
			.join("; ");

		throw new Error(`Invalid manifest: ${errorMessages}`);
	}

	return parseResult.data as McpbManifestAny; // log: cast zod parse result
}

export async function parseAndValidateManifestFromText(
	manifestText: string,
): Promise<McpbManifestAny> {
	let manifestJson: unknown;

	try {
		manifestJson = jsonParse(manifestText);
	} catch (error) {
		throw new Error(`Invalid JSON in manifest.json: ${errorMessage(error)}`);
	}

	return validateManifest(manifestJson);
}

export async function parseAndValidateManifestFromBytes(
	manifestData: Uint8Array,
): Promise<McpbManifestAny> {
	const manifestText = new TextDecoder().decode(manifestData);
	return parseAndValidateManifestFromText(manifestText);
}

export function generateExtensionId(
	manifest: McpbManifestAny,
	prefix?: "local.unpacked" | "local.dxt",
): string {
	const sanitize = (str: string) =>
		str
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-_.]/g, "")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");

	// biome-ignore lint/suspicious/noExplicitAny: manifest 来自 zip 内 JSON, 结构宽松, 仅读取 author/name 两字段
	const authorName = (manifest as any).author.name;
	// biome-ignore lint/suspicious/noExplicitAny: manifest 来自 zip 内 JSON, 结构宽松, 仅读取 author/name 两字段
	const extensionName = (manifest as any).name;

	const sanitizedAuthor = sanitize(authorName);
	const sanitizedName = sanitize(extensionName);

	return prefix
		? `${prefix}.${sanitizedAuthor}.${sanitizedName}`
		: `${sanitizedAuthor}.${sanitizedName}`;
}
