export type ParsedKeystroke = {
	key: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	super: boolean;
};

export type Chord = ParsedKeystroke[];

export type KeybindingContextName =
	| "Global"
	| "Chat"
	| "Autocomplete"
	| "Settings"
	| "Confirmation"
	| "Tabs"
	| "Transcript"
	| "HistorySearch"
	| "Task"
	| "ThemePicker"
	| "Scroll"
	| "Help"
	| "Attachments"
	| "Footer"
	| "MessageSelector"
	| "MessageActions"
	| "DiffDialog"
	| "ModelPicker"
	| "Select"
	| "Plugin";

export type KeybindingAction = string;

export type ParsedBinding = {
	context: KeybindingContextName;
	chord: Chord;
	action: string;
};

export type KeybindingBlock = {
	context: KeybindingContextName;
	bindings: Record<string, KeybindingAction>;
};
