// P5.4 (enhance-0819.md §D.7 P5.4, DSH #5 自修改评估): 会话级一次性技能。
// 双门禁: feature("SESSION_SKILLS") (编译期) AND FUSION_CODE_SESSION_SKILLS_ENABLED=1 (运行期)。
// 禁用时 CreateSessionSkillTool.isEnabled()=false → 工具不出现在 preset 列表, byte-identical 旧行为。
//
// 安全姿态 (spec "vm 沙箱非安全边界, 会话级 + 不持久 + 仅元数据日志"):
// - 仅写 in-memory dynamicSkills Map (loadSkillsDir.ts:851), 不落盘。
// - 会话级: clearDynamicSkills() (/clear 命令) 或进程退出即销毁, 非持久。
// - 仅元数据审计: auditLog 记 skill_write op (name/whenToUse/长度), 不记 markdown 正文。
// - vm 沙箱非安全边界: 技能正文仍由模型生成, 执行时受现有工具权限/hook 约束 (与 /skill-create 同)。

import { logForDebugging } from "../../utils/debug.js";

// 运行期门禁。编译期门禁 feature("SESSION_SKILLS") 在 CreateSessionSkillTool.isEnabled() 内。
// 两层都满足才暴露工具; 否则 byte-identical (工具不可见, 旧行为)。
export function isSessionSkillsEnabled(): boolean {
	return process.env.FUSION_CODE_SESSION_SKILLS_ENABLED === "1";
}

// 技能名/正文字面上限 (防滥用 + 对齐 createSkillCommand contentLength 字段)。
export const MAX_SESSION_SKILL_NAME = 64;
export const MAX_SESSION_SKILL_BODY = 200_000;

// 技能名合法校验 (复用 skill 命名约定: 小写 kebab-case, 字母数字连字符)。
export function isValidSessionSkillName(name: string): boolean {
	return (
		/^[a-z0-9][a-z0-9-]*$/.test(name) && name.length <= MAX_SESSION_SKILL_NAME
	);
}

// 名称冲突记录 (调试用, 非强制)。
export function logSessionSkillRegister(
	name: string,
	bodyLen: number,
	replaced: boolean,
): void {
	logForDebugging(
		`[SessionSkill] register "${name}" bodyLen=${bodyLen}${replaced ? " (replaced existing)" : ""}`,
	);
}
