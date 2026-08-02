/**
 * Sensitive file protection — prevent AI from reading protected paths.
 *
 * Files matching these patterns are globally denied regardless of
 * tool permissions or FUSION.rules configuration. This cannot be
 * overridden by any rule.
 */

import { normalize } from "path";

const SENSITIVE_PATTERNS: RegExp[] = [
	/\.env$/i,
	/\.env\./i,
	/\.env_local$/i,
	/\.env_production$/i,
	/\.env_staging$/i,
	/id_rsa/i,
	/id_ed25519/i,
	/id_ecdsa/i,
	/id_dsa/i,
	/\.ssh\/config$/i,
	/\.ssh\/authorized_keys$/i,
	/\.ssh\/known_hosts$/i,
	/\.pem$/i,
	/\.key$/i,
	/\.p12$/i,
	/\.pfx$/i,
	/\.jks$/i,
	/\.keystore$/i,
	/credentials\.json$/i,
	/service-account.*\.json$/i,
	/aws.*credentials/i,
	/\.aws\/credentials$/i,
	/\.aws\/config$/i,
	/\.npmrc$/i,
	/\.pypirc$/i,
	/\/\.gitconfig$/i,
];

const SENSITIVE_DIR_PATTERNS: RegExp[] = [
	/\/\.ssh$/i,
	/\/\.gnupg$/i,
	/\/\.aws$/i,
	/\/\.kube$/i,
];

export function isSensitiveFilePath(filePath: string): boolean {
	const normalized = normalize(filePath);
	for (const pattern of SENSITIVE_PATTERNS) {
		if (pattern.test(normalized)) return true;
	}
	for (const pattern of SENSITIVE_DIR_PATTERNS) {
		if (pattern.test(normalized)) return true;
	}
	return false;
}

export function getSensitiveFileDenialMessage(filePath: string): string {
	return `Access to "${filePath}" is denied by security policy. This file matches a sensitive path pattern (secrets, keys, or credentials) and cannot be read by AI.`;
}
