import { c as _c } from "react/compiler-runtime";
/**
 * Miscellaneous subcommand handlers — extracted from main.tsx for lazy loading.
 * doctor (setup-token and install were removed with the OAuth stack and the
 * upstream auto-update machinery)
 */
/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import React from "react";
import { MCPConnectionManager } from "../../components/mcp/MCPConnectionManager.js";
import { useManagePlugins } from "../../hooks/useManagePlugins.js";
import type { Root } from "../../ink.js";
import { KeybindingSetup } from "../../keybindings/KeybindingProviderSetup.js";
import { logEvent } from "../../services/analytics/index.js";
import { AppStateProvider } from "../../state/AppState.js";

// DoctorWithPlugins wrapper + doctor handler
const DoctorLazy = React.lazy(() =>
	import("../../screens/Doctor.js").then((m) => ({
		default: m.Doctor,
	})),
);
function DoctorWithPlugins(t0) {
	const $ = _c(2);
	const { onDone } = t0;
	useManagePlugins();
	let t1;
	if ($[0] !== onDone) {
		t1 = (
			<React.Suspense fallback={null}>
				<DoctorLazy onDone={onDone} />
			</React.Suspense>
		);
		$[0] = onDone;
		$[1] = t1;
	} else {
		t1 = $[1];
	}
	return t1;
}
export async function doctorHandler(root: Root): Promise<void> {
	logEvent("tengu_doctor_command", {});
	await new Promise<void>((resolve) => {
		root.render(
			<AppStateProvider>
				<KeybindingSetup>
					<MCPConnectionManager
						dynamicMcpConfig={undefined}
						isStrictMcpConfig={false}
					>
						<DoctorWithPlugins
							onDone={() => {
								void resolve();
							}}
						/>
					</MCPConnectionManager>
				</KeybindingSetup>
			</AppStateProvider>,
		);
	});
	root.unmount();
	process.exit(0);
}
