// audit 1.1.1 slice #40: suspend/resume event-sub useEffect body extracted (full-useEffect-body-with-cleanup variant — like slice #21 inline-callback but with a cleanup return).
// REPL() listens on stdin internal_eventEmitter for suspend/resume: suspend → print the suspension hint to stdout, resume → setRemountKey(prev+1) forces a full component-tree remount (replaces terminal clear).
// Original useEffect body. internal_eventEmitter + setRemountKey passed via ctx (closure capture), byte-equivalent behavior.
// The useStdin()/useState() hooks stay as a REPL thin shell (hook rules, cannot move to a plain helper); only the effect body moves out.
// process.stdout is global, no import. No JSX → .ts. Returns () => void (REPL thin-shell useEffect pass-through cleanup).
// internal_eventEmitter type = the Node EventEmitter returned by Ink useStdin() (StdinContext.d.ts).

import type { EventEmitter } from "node:events";

type SuspendResumeListenerCtx = {
	internal_eventEmitter: EventEmitter | null;
	setRemountKey: (updater: (prev: number) => number) => void;
};

// REPL keeps the useEffect thin shell:
//   const { internal_eventEmitter } = useStdin();
//   const [remountKey, setRemountKey] = useState(0);
//   useEffect(() => applySuspendResumeListener({ internal_eventEmitter, setRemountKey }), [internal_eventEmitter]);
// deps [internal_eventEmitter] unchanged (setRemountKey is a useState setter, stable ref, safe to omit, matching the original).
export function applySuspendResumeListener(
	ctx: SuspendResumeListenerCtx,
): () => void {
	const handleSuspend = () => {
		// Print suspension instructions
		process.stdout.write(
			`\nFusion-Code has been suspended. Run \`fg\` to bring Fusion-Code back.\nNote: ctrl + z now suspends Fusion-Code, ctrl + _ undoes input.\n`,
		);
	};
	const handleResume = () => {
		// Force complete component tree replacement instead of terminal clear
		// Ink now handles line count reset internally on SIGCONT
		ctx.setRemountKey((prev) => prev + 1);
	};
	ctx.internal_eventEmitter?.on("suspend", handleSuspend);
	ctx.internal_eventEmitter?.on("resume", handleResume);
	return () => {
		ctx.internal_eventEmitter?.off("suspend", handleSuspend);
		ctx.internal_eventEmitter?.off("resume", handleResume);
	};
}
