// item 24: 插件 marketplace `command` 源 (CC 2.1.229, §140/§216)
//
// marketplace 声明一个本地 shell 命令, 跑出 (stdout) 插件目录路径。每会话
// 重新解析 — 目录可移动, 无需重启。等效 directory 源, 但路径动态来自命令。
//
// 安全: 同 git/npm/zip install 信任模型 (命令跑任意码)。缓解 = strictKnownMarketplaces
// marketplace-name allowlist (policy gate, 非 host/path pattern — command 源无 host/path)。
// 命令来自受信声明 (marketplace.json/settings), 非用户随意输入。fail-visible:
// 超时/非零退出/空输出/非目录 → throw, 不静默降级。
//
// 物化执行不接 addMarketplaceSource stub (cloud-only 移除桩, 同其他所有源)。
// 本模块导出独立可测的 resolveCommandSource 真逻辑, 供未来 stub 补齐时接物化路径。

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { logForDebugging } from "../debug.js";
import { execFileNoThrowWithCwd } from "../execFileNoThrow.js";
import type { MarketplaceSource } from "./schemas.js";

// command 源子集 (MarketplaceSource 的 source:'command' 变体)
export interface CommandMarketplaceSource {
	source: "command";
	command: string;
	cwd?: string;
}

// 命令超时。插件目录解析应秒级 — 长 command 多半有问题 (挂起/网络)。
const COMMAND_TIMEOUT_MS = 30_000;

// P1-12: shell 元字符 — 命中即拒绝 (无法表示为单 argv, shell 语义 = 注入面)。
// command 源命令来自受信声明但非用户随意输入; 强制单进程无管道/重定向/命令串接,
// 配合 shell:false argv 执行消除注入。真需 shell 语义应走 executor 沙箱 (远期)。
const SHELL_OPERATOR_RE =
	/[;|&]|\|\||&&|>\s|<\s|\$\(|`|\$\{|2>\s|>>|^[\s]*\(|\\[;&|<>]/;

export interface ResolvedCommandSource {
	directoryPath: string;
}

/**
 * 判定 MarketplaceSource 是否为 command 源 (type guard, 供 policy/reconcile 用)。
 */
export function isCommandSource(
	source: MarketplaceSource,
): source is CommandMarketplaceSource {
	return source.source === "command";
}

/**
 * 跑 command 源命令 → 取 stdout 为目录路径 → 验存在且为目录。
 * 返回 resolved 绝对目录路径 (等效 directory 源 path)。
 *
 * fail-visible (Rule 12): 超时/非零退出/空输出/非目录全 throw, 不静默降级。
 * 调用方 (未来物化接入) 须把异常转成 PluginError, 不吞。
 */
export async function resolveCommandSource(
	source: CommandMarketplaceSource,
): Promise<ResolvedCommandSource> {
	const cwd = source.cwd ? resolve(source.cwd) : undefined;
	logForDebugging(
		`command source: running "${source.command}"${cwd ? ` in ${cwd}` : ""}`,
	);

	// P1-12: 拒绝 shell 元字符 (注入面 — 链式命令/管道/重定向/命令替换)。
	// command 源契约 = 跑单条受信命令取目录路径 (如 `which myplugin`); 复杂 shell
	// 语义 (管道/串接/`$()`) 非此源用途且是注入向量, 拒绝。单进程命令保持 shell:true
	// 接口 (echo/pwd/printf 引号语义), 元字符门 = 安全边界。
	if (SHELL_OPERATOR_RE.test(source.command)) {
		throw new Error(
			`command source rejected: shell operators not allowed (injection risk) — "${source.command}". ` +
				`Use a single command without pipes/redirects/chaining; complex commands belong in the executor sandbox.`,
		);
	}

	// execa shell:true 跑单条命令串 (已过元字符门, 无链式/注入)。
	const result = await execFileNoThrowWithCwd(source.command, [], {
		cwd,
		timeout: COMMAND_TIMEOUT_MS,
		shell: true,
	});

	if (result.code !== 0) {
		throw new Error(
			`command source exited ${result.code}: "${source.command}"` +
				(result.stderr ? ` — stderr: ${result.stderr.trim()}` : ""),
		);
	}

	const rawPath = result.stdout.trim();
	if (rawPath.length === 0) {
		throw new Error(
			`command source produced empty output: "${source.command}"`,
		);
	}

	const directoryPath = resolve(rawPath);

	// 验存在且为目录 — 命令应打印目录, 非 file/不存在路径。
	let stats: { isDirectory(): boolean } | undefined;
	try {
		stats = await stat(directoryPath);
	} catch (error) {
		throw new Error(
			`command source printed inaccessible path "${directoryPath}": ${error}`,
		);
	}
	if (!stats.isDirectory()) {
		throw new Error(
			`command source printed non-directory path: "${directoryPath}"`,
		);
	}

	logForDebugging(`command source resolved to: ${directoryPath}`);
	return { directoryPath };
}

/**
 * command 源 → 等效 directory 源 (物化后形态)。
 * 供未来 addMarketplaceSource stub 补齐时, 把 command 源转 directory 走现有
 * directory 物化路径 (读 .claude-plugin/marketplace.json)。
 */
export async function commandSourceToDirectorySource(
	source: CommandMarketplaceSource,
): Promise<{ source: "directory"; path: string }> {
	const { directoryPath } = await resolveCommandSource(source);
	return { source: "directory", path: directoryPath };
}
