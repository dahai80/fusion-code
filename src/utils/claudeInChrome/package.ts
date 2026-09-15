type BrowserTool = { name: string };

type ClaudeForChromePackage = {
	BROWSER_TOOLS?: BrowserTool[];
	// biome-ignore lint/suspicious/noExplicitAny: 外部 npm 包签名 (createClaudeForChromeMcpServer), 类型由运行时校验
	createClaudeForChromeMcpServer?: (...args: any[]) => any;
};

let cachedPackage: ClaudeForChromePackage | null | undefined;

function loadClaudeForChromePackage(): ClaudeForChromePackage | null {
	if (cachedPackage !== undefined) {
		return cachedPackage;
	}

	try {
		/* eslint-disable @typescript-eslint/no-require-imports */
		cachedPackage =
			require("@ant/claude-for-chrome-mcp") as ClaudeForChromePackage;
		/* eslint-enable @typescript-eslint/no-require-imports */
	} catch {
		cachedPackage = null;
	}

	return cachedPackage;
}

export function getChromeBrowserTools(): BrowserTool[] {
	return loadClaudeForChromePackage()?.BROWSER_TOOLS ?? [];
}

export async function importClaudeForChromePackage(): Promise<ClaudeForChromePackage> {
	return (await import("@ant/claude-for-chrome-mcp")) as ClaudeForChromePackage;
}
