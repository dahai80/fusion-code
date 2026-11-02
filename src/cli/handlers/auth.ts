/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handler intentionally exits */

import { performLogout } from "../../commands/logout/logout.js";
import {
	getAnthropicApiKeyWithSource,
	getAuthTokenSource,
	getOauthAccountInfo,
	getSubscriptionType,
	isUsing3PServices,
} from "../../utils/auth.js";
import { isRunningOnHomespace } from "../../utils/envUtils.js";
import { getAPIProvider } from "../../utils/model/providers.js";
import { jsonStringify } from "../../utils/slowOperations.js";
import {
	buildAccountProperties,
	buildAPIProviderProperties,
} from "../../utils/status.js";

export async function authStatus(opts: {
	json?: boolean;
	text?: boolean;
}): Promise<void> {
	const { source: authTokenSource, hasToken } = getAuthTokenSource();
	const { source: apiKeySource } = getAnthropicApiKeyWithSource();
	const hasApiKeyEnvVar =
		!!process.env.FUSION_CLIENT_KEY && !isRunningOnHomespace();
	const oauthAccount = getOauthAccountInfo();
	const subscriptionType = getSubscriptionType();
	const using3P = isUsing3PServices();
	const loggedIn =
		hasToken || apiKeySource !== "none" || hasApiKeyEnvVar || using3P;

	// Determine auth method
	let authMethod: string = "none";
	if (using3P) {
		authMethod = "third_party";
	} else if (authTokenSource === "claude.ai") {
		authMethod = "claude.ai";
	} else if (authTokenSource === "apiKeyHelper") {
		authMethod = "api_key_helper";
	} else if (authTokenSource !== "none") {
		authMethod = "oauth_token";
	} else if (apiKeySource === "FUSION_CLIENT_KEY" || hasApiKeyEnvVar) {
		authMethod = "api_key";
	} else if (apiKeySource === "/login managed key") {
		authMethod = "claude.ai";
	}

	if (opts.text) {
		const properties = [
			...buildAccountProperties(),
			...buildAPIProviderProperties(),
		];
		let hasAuthProperty = false;
		for (const prop of properties) {
			const value =
				typeof prop.value === "string"
					? prop.value
					: Array.isArray(prop.value)
						? prop.value.join(", ")
						: null;
			if (value === null || value === "none") {
				continue;
			}
			hasAuthProperty = true;
			if (prop.label) {
				process.stdout.write(`${prop.label}: ${value}\n`);
			} else {
				process.stdout.write(`${value}\n`);
			}
		}
		if (!hasAuthProperty && hasApiKeyEnvVar) {
			process.stdout.write("API key: FUSION_CLIENT_KEY\n");
		}
		if (!loggedIn) {
			process.stdout.write(
				"Not logged in. Run claude auth login to authenticate.\n",
			);
		}
	} else {
		const apiProvider = getAPIProvider();
		const resolvedApiKeySource =
			apiKeySource !== "none"
				? apiKeySource
				: hasApiKeyEnvVar
					? "FUSION_CLIENT_KEY"
					: null;
		const output: Record<string, string | boolean | null> = {
			loggedIn,
			authMethod,
			apiProvider,
		};
		if (resolvedApiKeySource) {
			output.apiKeySource = resolvedApiKeySource;
		}
		if (authMethod === "claude.ai") {
			output.email = oauthAccount?.emailAddress ?? null;
			output.orgId = oauthAccount?.organizationUuid ?? null;
			output.orgName = oauthAccount?.organizationName ?? null;
			output.subscriptionType = subscriptionType ?? null;
		}

		process.stdout.write(`${jsonStringify(output, null, 2)}\n`);
	}
	process.exit(loggedIn ? 0 : 1);
}

export async function authLogout(): Promise<void> {
	try {
		await performLogout({ clearOnboarding: false });
	} catch {
		process.stderr.write("Failed to log out.\n");
		process.exit(1);
	}
	process.stdout.write(
		"Successfully logged out from your Anthropic account.\n",
	);
	process.exit(0);
}
