// P0-3 (audit R2): git-family 源 commit sha pin gate — 独立纯模块。
//
// 从 pluginLoader.ts 抽出, 单测可直接 import 本模块而不触发 settings 加载链
// (pluginLoader import settings/settings.js → settings.ts 模块级引用
// isLoadingSettings 触发 TDZ)。本模块只依赖 envUtils + debug, 无 settings 链。
//
// 缺 sha → 克隆默认分支 = 移动靶, 供应链不可复现 (today v1.0, tomorrow v1.0+恶意提交)。
// 企业级基线强制锁 commit。LENIENT 模式 (FUSION_CODE_PLUGIN_SHA256_LENIENT=1,
// 与 archive 共用同一 env) 保留无 sha 克隆兼容期 (受信 registry 渐进迁移)。

import { logForDebugging } from "../debug.js";
import { isEnvTruthy } from "../envUtils.js";

export function requireGitShaPin(
	sourceKind: string,
	identifier: string,
	sha: string | undefined,
): void {
	if (sha) return;
	if (isEnvTruthy(process.env.FUSION_CODE_PLUGIN_SHA256_LENIENT)) {
		logForDebugging(
			`[plugins] git source (${sourceKind}) ${identifier} has no sha pin, LENIENT mode allows unpinned clone`,
		);
		return;
	}
	throw new Error(
		`git source (${sourceKind}) ${identifier} missing commit sha pin: ` +
			"commit pinning required by default (enterprise supply-chain baseline). " +
			"Add a sha field to the source, or set " +
			"FUSION_CODE_PLUGIN_SHA256_LENIENT=1 to allow unpinned (fail-open).",
	);
}
