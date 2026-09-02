import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// audit-0902 P2-4: teamHelpers read-modify-write must serialize under a file
// lock so concurrent team updates (roster change + member active-toggle at
// once) do not clobber each other (lost update). writeTeamFileAsync and
// updateTeamFileAsync now acquire a proper-lockfile lock on config.json
// before writing. This exercises the real filesystem lock against a real team
// dir (config home redirected to a tmpdir via envUtils mock) and asserts:
//  - updateTeamFileAsync holds the lock across read+mutate+write (two
//    concurrent appends both survive -> no lost update).
//  - writeTeamFileAsync lands intact JSON under concurrent writes (no
//    half-written interleave).
// proper-lockfile's lazy require + graceful-fs is real here (no mock); the
// lock file lands beside config.json as config.json.lock.

let _configHome = "";
const realEnvUtils = await import("../../../utils/envUtils.js");
mock.module("../../../utils/envUtils.js", () => ({
	...realEnvUtils,
	getClaudeConfigHomeDir: () => _configHome,
}));

const { writeTeamFileAsync, updateTeamFileAsync, readTeamFileAsync } =
	await import("../../../utils/swarm/teamHelpers.js");

function teamDir(name: string): string {
	return join(_configHome, "teams", name);
}

async function freshTeam(name: string): Promise<void> {
	const dir = teamDir(name);
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "config.json"),
		JSON.stringify({
			name,
			createdAt: 0,
			leadAgentId: "lead",
			persistent: false,
			members: [{ name: "m0", mode: "default", isActive: true }],
		}),
		"utf8",
	);
}

describe("teamHelpers RMW file lock (audit-0902 P2-4)", () => {
	beforeEach(async () => {
		_configHome = await mkdtemp(join(tmpdir(), "team-rmw-"));
	});
	afterEach(async () => {
		await rm(_configHome, { recursive: true, force: true });
	});

	it("updateTeamFileAsync serializes concurrent mutators (no lost update)", async () => {
		// Two mutators each append a distinct member. Without a lock across
		// RMW, both read the same 1-member snapshot, each write a 2-member
		// file, the second clobbers the first (1 member lost). With the lock
		// both appends survive -> 3 members.
		await freshTeam("race");
		const append = (label: string) =>
			updateTeamFileAsync("race", async (current) => {
				if (!current || current.members.length === 0) return null;
				const base = current.members[0];
				return {
					...current,
					members: [
						...current.members,
						{ ...base, name: label, isActive: false },
					],
				};
			});
		await Promise.all([append("a"), append("b")]);
		const result = await readTeamFileAsync("race");
		expect(result).not.toBeNull();
		expect(result!.members.length).toBe(3);
		expect(result!.members.map((m) => m.name).sort()).toEqual(["a", "b", "m0"]);
	});

	it("writeTeamFileAsync produces intact JSON under concurrent writes", async () => {
		// Concurrent whole-file writes must each land as complete, parseable
		// JSON — never a half-written interleave. Assert the final file parses
		// and is one of the two written payloads.
		await freshTeam("ww");
		const payload = (createdAt: number, member: string) => ({
			name: "ww",
			createdAt,
			leadAgentId: "lead",
			persistent: false,
			members: [{ name: member, mode: "default", isActive: true }],
		});
		await Promise.all([
			writeTeamFileAsync("ww", payload(1, "A") as never),
			writeTeamFileAsync("ww", payload(2, "B") as never),
		]);
		const raw = await readFile(join(teamDir("ww"), "config.json"), "utf8");
		const parsed = JSON.parse(raw);
		expect([1, 2]).toContain(parsed.createdAt);
	});

	it("updateTeamFileAsync mutator returning null makes no write", async () => {
		await freshTeam("noop");
		const before = await readFile(join(teamDir("noop"), "config.json"), "utf8");
		await updateTeamFileAsync("noop", async () => null);
		const after = await readFile(join(teamDir("noop"), "config.json"), "utf8");
		expect(after).toBe(before);
	});
});
