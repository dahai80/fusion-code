import type { PermissionUpdate } from "../utils/permissions/PermissionUpdateSchema.js";

export interface BridgePermissionCallbacks {
	sendRequest(
		requestId: string,
		toolName: string,
		input: unknown,
		toolUseId: string,
		description: string,
		permissionSuggestions?: unknown,
		blockedPath?: unknown,
	): void; // log: fix TS2339
	sendResponse(requestId: string, response: BridgePermissionResponse): void; // log: fix TS2339
	cancelRequest(requestId: string): void; // log: fix TS2339
	onResponse(
		requestId: string,
		handler: (response: BridgePermissionResponse) => void,
	): () => void; // log: fix TS2339
}

export interface BridgePermissionResponse {
	behavior: "allow" | "deny"; // log: fix TS2339
	updatedInput?: Record<string, unknown>; // log: fix TS2339
	updatedPermissions?: PermissionUpdate[]; // log: fix TS2339
	message?: string; // log: fix TS2339
}

export function isBridgePermissionResponse(
	value: unknown,
): value is BridgePermissionResponse {
	return typeof value === "object" && value !== null && "behavior" in value;
}
