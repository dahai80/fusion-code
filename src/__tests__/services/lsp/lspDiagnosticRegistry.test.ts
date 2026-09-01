import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { DiagnosticFile } from "../../../services/diagnosticTracking.js";
import {
	checkForLSPDiagnostics,
	clearDeliveredDiagnosticsForFile,
	getPendingLSPDiagnosticCount,
	registerPendingLSPDiagnostic,
	resetAllLSPDiagnosticState,
} from "../../../services/lsp/index.js";

// P1-8 (audit R15): service-layer unit tests. LSPDiagnosticRegistry is
// module-scope singleton state — call resetAllLSPDiagnosticState() in
// beforeEach to isolate. No mocks needed (pure module state + crypto uuid).
function diag(
	message: string,
	severity: "Error" | "Warning" | "Info" | "Hint" = "Error",
): DiagnosticFile {
	return {
		uri: "file:///tmp/a.ts",
		diagnostics: [
			{
				message,
				severity,
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 5 },
				},
			},
		],
	};
}

describe("LSPDiagnosticRegistry dedup + volume-limit (P1-8)", () => {
	beforeEach(() => resetAllLSPDiagnosticState());
	afterEach(() => resetAllLSPDiagnosticState());

	it("empty registry check returns []", () => {
		expect(checkForLSPDiagnostics()).toEqual([]);
		expect(getPendingLSPDiagnosticCount()).toBe(0);
	});

	it("register + check delivers and clears pending", () => {
		registerPendingLSPDiagnostic({
			serverName: "ts",
			files: [diag("missing ;")],
		});
		expect(getPendingLSPDiagnosticCount()).toBe(1);
		const delivered = checkForLSPDiagnostics();
		expect(delivered.length).toBe(1);
		expect(delivered[0].serverName).toBe("ts");
		expect(getPendingLSPDiagnosticCount()).toBe(0);
	});

	it("within-batch dedup: identical diagnostic delivered once", () => {
		const f = diag("missing ;");
		registerPendingLSPDiagnostic({ serverName: "ts", files: [f] });
		registerPendingLSPDiagnostic({ serverName: "ts", files: [f] });
		const delivered = checkForLSPDiagnostics();
		expect(delivered.length).toBe(1);
		expect(delivered[0].files[0].diagnostics.length).toBe(1);
	});

	it("cross-turn dedup: same diagnostic not re-delivered", () => {
		registerPendingLSPDiagnostic({ serverName: "ts", files: [diag("err X")] });
		expect(checkForLSPDiagnostics().length).toBe(1);
		registerPendingLSPDiagnostic({ serverName: "ts", files: [diag("err X")] });
		expect(checkForLSPDiagnostics()).toEqual([]);
	});

	it("clearDeliveredDiagnosticsForFile re-enables delivery", () => {
		registerPendingLSPDiagnostic({ serverName: "ts", files: [diag("err X")] });
		expect(checkForLSPDiagnostics().length).toBe(1);
		clearDeliveredDiagnosticsForFile("file:///tmp/a.ts");
		registerPendingLSPDiagnostic({ serverName: "ts", files: [diag("err X")] });
		expect(checkForLSPDiagnostics().length).toBe(1);
	});

	it("different range does not dedup", () => {
		registerPendingLSPDiagnostic({
			serverName: "ts",
			files: [
				{
					uri: "file:///tmp/a.ts",
					diagnostics: [
						{
							message: "m",
							severity: "Error",
							range: {
								start: { line: 1, character: 0 },
								end: { line: 1, character: 5 },
							},
						},
						{
							message: "m",
							severity: "Error",
							range: {
								start: { line: 2, character: 0 },
								end: { line: 2, character: 5 },
							},
						},
					],
				},
			],
		});
		const delivered = checkForLSPDiagnostics();
		expect(delivered[0].files[0].diagnostics.length).toBe(2);
	});

	it("per-file cap at 10", () => {
		const diagnostics = Array.from({ length: 15 }, (_, i) => ({
			message: `err ${i}`,
			severity: "Error" as const,
			range: {
				start: { line: i, character: 0 },
				end: { line: i, character: 1 },
			},
		}));
		registerPendingLSPDiagnostic({
			serverName: "ts",
			files: [{ uri: "file:///tmp/a.ts", diagnostics }],
		});
		const delivered = checkForLSPDiagnostics();
		expect(delivered[0].files[0].diagnostics.length).toBe(10);
	});

	it("severity sort: Error before Warning before Hint", () => {
		registerPendingLSPDiagnostic({
			serverName: "ts",
			files: [
				{
					uri: "file:///tmp/a.ts",
					diagnostics: [
						{
							message: "h",
							severity: "Hint",
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 1 },
							},
						},
						{
							message: "e",
							severity: "Error",
							range: {
								start: { line: 1, character: 0 },
								end: { line: 1, character: 1 },
							},
						},
						{
							message: "w",
							severity: "Warning",
							range: {
								start: { line: 2, character: 0 },
								end: { line: 2, character: 1 },
							},
						},
					],
				},
			],
		});
		const delivered = checkForLSPDiagnostics();
		const sev = delivered[0].files[0].diagnostics.map((d) => d.severity);
		expect(sev[0]).toBe("Error");
		expect(sev[1]).toBe("Warning");
		expect(sev[2]).toBe("Hint");
	});
});
