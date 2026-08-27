// log: created for TS2307 fix

export type LspServerConfig = {
	command: string;
	args?: string[];
	extensionToLanguage: Record<string, string>;
	transport: "stdio" | "socket";
	env?: Record<string, string>;
	initializationOptions?: unknown;
	settings?: unknown;
	workspaceFolder?: string;
	startupTimeout?: number;
	// P1-17: 每请求超时 (ms)。未设 → LSPServerInstance 默认 10s 安全网。
	requestTimeout?: number;
	shutdownTimeout?: number;
	restartOnCrash?: boolean;
	maxRestarts?: number;
};

export type LspServerState = "starting" | "running" | "stopped" | "error";

export type ScopedLspServerConfig = LspServerConfig & {
	pluginName: string;
	scope: string;
};
