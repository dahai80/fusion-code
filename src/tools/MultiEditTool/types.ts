import { z } from "zod/v4";
import { lazySchema } from "../../utils/lazySchema.js";
import { semanticBoolean } from "../../utils/semanticBoolean.js";
import { MULTI_EDIT_MAX_EDITS } from "./constants.js";

const editSchema = z.strictObject({
	file_path: z.string().describe("The absolute path to the file to modify"),
	old_string: z.string().describe("The text to replace"),
	new_string: z
		.string()
		.describe(
			"The text to replace it with (must be different from old_string)",
		),
	replace_all: semanticBoolean(z.boolean().default(false).optional()).describe(
		"Replace all occurrences of old_string (default false)",
	),
});

const inputSchema = lazySchema(() =>
	z.strictObject({
		edits: z
			.array(editSchema)
			.min(1)
			.max(MULTI_EDIT_MAX_EDITS)
			.describe(
				`Array of edit operations to apply. Each edit specifies a file_path, old_string, new_string, and optional replace_all. Maximum ${MULTI_EDIT_MAX_EDITS} edits per call.`,
			),
	}),
);
type InputSchema = ReturnType<typeof inputSchema>;

export type MultiEditInput = z.output<InputSchema>;

export type MultiEditResult = {
	filePath: string;
	success: boolean;
	error?: string;
};

export type MultiEditOutput = {
	results: MultiEditResult[];
};

const outputSchema = lazySchema(() =>
	z.object({
		results: z
			.array(
				z.object({
					filePath: z.string(),
					success: z.boolean(),
					error: z.string().optional(),
				}),
			)
			.describe("Results for each edit operation"),
	}),
);
type OutputSchema = ReturnType<typeof outputSchema>;

export type MultiEditOutputType = z.infer<OutputSchema>;

export { inputSchema, outputSchema };
