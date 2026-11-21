// P5.4 (enhance-0819.md §D.7 P5.4, DSH #5 self-modification evaluation): session-scoped one-shot skills.
// Double gate: feature("SESSION_SKILLS") (compile time) AND FUSION_CODE_SESSION_SKILLS_ENABLED=1 (runtime).
// When disabled, CreateSessionSkillTool.isEnabled()=false → tool absent from the preset list, byte-identical old behavior.
//
// Security posture (spec "the vm sandbox is not a security boundary, session-scoped + non-persistent + metadata-only logging"):
// - Only writes the in-memory dynamicSkills Map (loadSkillsDir.ts:851), never to disk.
// - Session-scoped: destroyed by clearDynamicSkills() (/clear command) or process exit, non-persistent.
// - Metadata-only audit: auditLog records the skill_write op (name/whenToUse/length), not the markdown body.
// - vm sandbox is not a security boundary: the skill body is still model-generated; at execution it is constrained by existing tool permissions/hooks (same as /skill-create).

import { logForDebugging } from "../../utils/debug.js";

// Runtime gate. The compile-time gate feature("SESSION_SKILLS") lives inside CreateSessionSkillTool.isEnabled().
// The tool is exposed only when both layers are satisfied; otherwise byte-identical (tool invisible, old behavior).
export function isSessionSkillsEnabled(): boolean {
	return process.env.FUSION_CODE_SESSION_SKILLS_ENABLED === "1";
}

// Skill name/body literal caps (abuse prevention + aligned with the createSkillCommand contentLength field).
export const MAX_SESSION_SKILL_NAME = 64;
export const MAX_SESSION_SKILL_BODY = 200_000;

// Skill name validation (reuses the skill naming convention: lowercase kebab-case, alphanumeric + hyphens).
export function isValidSessionSkillName(name: string): boolean {
	return (
		/^[a-z0-9][a-z0-9-]*$/.test(name) && name.length <= MAX_SESSION_SKILL_NAME
	);
}

// Name-collision logging (for debugging, not enforced).
export function logSessionSkillRegister(
	name: string,
	bodyLen: number,
	replaced: boolean,
): void {
	logForDebugging(
		`[SessionSkill] register "${name}" bodyLen=${bodyLen}${replaced ? " (replaced existing)" : ""}`,
	);
}
