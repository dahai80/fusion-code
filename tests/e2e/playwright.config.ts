// projectApiServer Playwright e2e 验收 (用户要求: 真实浏览器 + 真实服务 + 真实 MLX 模型)。
// 服务由 start.sh 拉起 (11441), 认证 token 固定; MLX 直连 11434 (FUSION_MLX_ENABLED),
// key 读自 ~/.fusion-mlx/settings.json (fusion-mlx 鉴权)。WS chat 子进程继承本环境。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { defineConfig } from "@playwright/test";

export const E2E_TOKEN = "e2e-acceptance-token";
export const E2E_MODEL = "mlx-community/Qwen3.5-4B-MLX-4bit";

function readMlxKey(): string {
	try {
		const settings = JSON.parse(
			readFileSync(`${homedir()}/.fusion-mlx/settings.json`, "utf8"),
		) as { auth?: { api_key?: string } };
		return settings.auth?.api_key ?? "";
	} catch {
		return "";
	}
}

export default defineConfig({
	testDir: ".",
	// .e2e.ts 后缀: bun test 的文件模式 (*.{test,spec}.* 也会匹配 .spec.ts) 会把
	// Playwright spec 当 bun 测试跑而在 beforeAll 处炸掉, 用后缀隔离两个 runner
	testMatch: /.*\.e2e\.ts$/,
	timeout: 60_000,
	retries: 0,
	workers: 1,
	reporter: [["list"]],
	use: {
		baseURL: "http://127.0.0.1:11441",
		extraHTTPHeaders: { Authorization: `Bearer ${E2E_TOKEN}` },
	},
	// webServer 数组: [真实服务 11441, 跨源测试夹具 origin 11496]。
	// 夹具只提供第二个 origin — 浏览器跨源 fetch (真实 CORS preflight + ACAO 回显)
	// 必须从非同源页面发起, about:blank 不透明 origin 会被浏览器网络栈拒绝。
	webServer: [
		{
			// start.sh 幂等; 已在跑则复用。env 在命令内联 — start.sh 不透传调用方 env 之外的变量
			// cwd: webServer 默认在 config 目录 (tests/e2e/) 执行, start.sh 在仓库根
			cwd: "../..",
			command: [
				"bash -c '",
				`FUSION_CODE_AUTH_TOKEN=${E2E_TOKEN}`,
				"FUSION_MLX_ENABLED=1",
				`FUSION_MLX_API_KEY=${readMlxKey()}`,
				`FUSION_MLX_MODEL=${E2E_MODEL}`,
				"./start.sh start'",
			].join(" "),
			// 无免鉴权 2xx 探活端点, 用 stdout 就绪信号 (fresh start 打 "started",
			// 复用打 "already running")
			stdout: /fusion-code started|already running/,
			reuseExistingServer: true,
			timeout: 120_000,
		},
		{
			command: "bun tests/e2e/fixture-origin-server.mjs",
			cwd: "../..",
			url: "http://127.0.0.1:11496",
			reuseExistingServer: true,
			timeout: 15_000,
		},
	],
});
