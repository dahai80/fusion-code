import type { PermissionDecision } from "../types/permissions.js";
import type { RemoteMessageContent } from "../utils/teleport/api.js";

export interface SSHSessionManager {
	connect: () => void;
	disconnect: () => void;
	sendMessage: (content: RemoteMessageContent) => Promise<boolean>;
	sendInterrupt: () => void;
	respondToPermissionRequest: (
		requestId: string,
		decision: PermissionDecision,
	) => void;
}
