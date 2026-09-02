import { describe, expect, it } from "bun:test";

// insight-0902 G3: coordinator↔team wiring + persistent flag.
// Asserts: (1) filterTransientTeams keeps transient teams (persistent
// undefined/false) and drops persistent teams; (2) missing team file falls
// through to cleanup (transient default — fail-safe, not fail-open).
//
// The coordinator-injection branch (buildCoordinatorTeamContext in
// coordinatorMode.ts, gated by FUSION_CODE_COORDINATOR_TEAM) and the
// getCoordinatorUserContext baseline are NOT unit-tested here: importing
// coordinatorMode.ts pulls constants/tools → REPLTool/constants which hits a
// load-time TDZ, and isCoordinatorMode() is gated by a compile-time
// feature('COORDINATOR_MODE') macro that bun:test cannot enable without a
// build (same class of limitation as the G4 cycle test). The durable,
// runtime-testable contract is the persistent filter below; the injection
// wiring is exercised by the build:dev smoke + manual coordinator runs.

import {
	filterTransientTeams,
	type TeamFile,
} from "../../../utils/swarm/teamHelpers.js";

function makeTeamFile(opts: { persistent?: boolean }): TeamFile {
	return {
		name: "test-team",
		createdAt: 0,
		leadAgentId: "lead",
		members: [],
		persistent: opts.persistent,
	} as TeamFile;
}

describe("coordinator↔team wiring (insight-0902 G3)", () => {
	it("filterTransientTeams drops persistent teams, keeps transient ones", () => {
		const read = (name: string): TeamFile | null => {
			if (name === "persist") return makeTeamFile({ persistent: true });
			if (name === "transient") return makeTeamFile({ persistent: false });
			if (name === "unset") return makeTeamFile({});
			return null;
		};
		const kept = filterTransientTeams(["persist", "transient", "unset"], read);
		expect(kept).toEqual(["transient", "unset"]);
	});

	it("filterTransientTeams treats a missing team file as transient (fail-safe)", () => {
		const read = (_name: string): TeamFile | null => null;
		const kept = filterTransientTeams(["gone"], read);
		expect(kept).toEqual(["gone"]);
	});
});
