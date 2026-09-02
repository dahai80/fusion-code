// SessionEnd 自动轨迹收集 — 训练飞轮自动闭环 (insight-0902 E1)
//
// 会话退出时自动把 ~/.fusion-code/projects 下的 session jsonl 收集进
// ~/.fusion/trajectories，无需用户手动跑 `fusion-code trajectory collect`。
//
// 门控: FUSION_CODE_TRAJECTORY_AUTOCOLLECT=1 (默认关 = byte-identical-off)。
// fail-open: 收集失败只记日志, 不阻塞会话退出。
// 测试环境跳过 (isTestEnv), 避免单测污染汇聚库。

import { isTestEnv } from "../../utils/buildConstants.js";
import { logForDebugging } from "../../utils/debug.js";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { collectTrajectories, DEFAULT_DEST_DIR, DEFAULT_SOURCE_DIR } from "./collector.js";

const AUTOCOLLECT_ENV = "FUSION_CODE_TRAJECTORY_AUTOCOLLECT";
const DEFAULT_PRODUCT = "fusion-code";

// 是否启用自动收集 (编译期不门控: 此模块始终在 bundle, 但默认不执行)。
export function isTrajectoryAutoCollectEnabled(): boolean {
    return isEnvTruthy(process.env[AUTOCOLLECT_ENV]);
}

// SessionEnd 钩子: 自动收集当前会话轨迹。fail-open。
// sourceDir 用 DEFAULT_SOURCE_DIR (含所有 cwd-slug 子目录, collector 递归扫),
// destDir 用 DEFAULT_DEST_DIR (~/.fusion/trajectories)。
export async function autoCollectTrajectoryOnSessionEnd(): Promise<void> {
    if (!isTrajectoryAutoCollectEnabled()) {
        return;
    }
    if (isTestEnv()) {
        logForDebugging("[trajectory] autoCollect skipped in test env");
        return;
    }
    try {
        logForDebugging(
            `[trajectory] autoCollect start source=${DEFAULT_SOURCE_DIR} dest=${DEFAULT_DEST_DIR}`,
        );
        const manifest = await collectTrajectories({
            sourceDir: DEFAULT_SOURCE_DIR,
            destDir: DEFAULT_DEST_DIR,
            product: DEFAULT_PRODUCT,
        });
        logForDebugging(
            `[trajectory] autoCollect done sessions=${manifest.totals.sessions} steps=${manifest.totals.steps} positive=${manifest.totals.positive} selfCorrection=${manifest.totals.selfCorrection}`,
        );
    } catch (e) {
        // fail-open: 收集失败不影响退出
        logForDebugging(
            `[trajectory] autoCollect failed (fail-open): ${(e as Error).message}`,
        );
    }
}
