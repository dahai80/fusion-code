// teams service barrel: agent-studio teams.* RPC consumer surface (issue #268).

export type { TeamManifest, TeamMemberSpec, TeamTaskSpec } from "./manifest";
export { loadTeamManifest, ManifestError, parseTeamManifest } from "./manifest";
export type { StudioRpcClient } from "./studioRpc";
export {
	createStudioClient,
	resetStudioAuthCache,
	resolveStudioSocketPath,
	StudioRpcError,
} from "./studioRpc";
