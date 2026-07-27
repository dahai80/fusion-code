export type QuerySource =
	| "repl_main_thread"
	| "sdk"
	| "agent:default"
	| "agent:custom"
	| `agent:builtin:${string}`
	| `agent:${string}`
	| string;
