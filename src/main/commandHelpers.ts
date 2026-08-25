// Shared helpers for Commander CLI registration, extracted from main.tsx
// (issue #133 god-module split). Pure helpers; no module-scope mutable state.

import {
	Command as CommanderCommand,
	Option,
} from "@commander-js/extra-typings";

export type { CommanderCommand, Option };

// Commander supports compareOptions at runtime but @commander-js/extra-typings
// doesn't include it in the type definitions, so we use Object.assign to add it.
export function createSortedHelpConfig(): {
	sortSubcommands: true;
	sortOptions: true;
} {
	const getOptionSortKey = (opt: Option): string =>
		opt.long?.replace(/^--/, "") ?? opt.short?.replace(/^-/, "") ?? "";
	return Object.assign(
		{
			sortSubcommands: true,
			sortOptions: true,
		} as const,
		{
			compareOptions: (a: Option, b: Option) =>
				getOptionSortKey(a).localeCompare(getOptionSortKey(b)),
		},
	);
}
