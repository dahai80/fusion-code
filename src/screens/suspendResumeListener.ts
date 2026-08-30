// audit 1.1.1 slice #40: suspend/resume event-sub useEffect body 外移 (full-useEffect-body-with-cleanup variant — 像 slice #21 inline-callback 但带 cleanup return)。
// REPL() 监听 stdin internal_eventEmitter 的 suspend/resume: suspend→打印挂起提示到 stdout, resume→setRemountKey(prev+1) 强制全组件树 remount (替代 terminal clear)。
// 原 useEffect body。internal_eventEmitter + setRemountKey 经 ctx 传入 (闭包捕获), 行为字节等价。
// useStdin()/useState() hook 留 REPL 薄壳 (hook 规则, 不能移 plain helper), 仅 effect body 移出。
// process.stdout 是全局, 无 import。无 JSX → .ts。返 () => void (REPL 薄壳 useEffect 透传 cleanup)。
// internal_eventEmitter 类型 = Ink useStdin() 返回的 Node EventEmitter (StdinContext.d.ts)。

import type { EventEmitter } from "node:events";

type SuspendResumeListenerCtx = {
	internal_eventEmitter: EventEmitter | null;
	setRemountKey: (updater: (prev: number) => number) => void;
};

// REPL 保留 useEffect 薄壳:
//   const { internal_eventEmitter } = useStdin();
//   const [remountKey, setRemountKey] = useState(0);
//   useEffect(() => applySuspendResumeListener({ internal_eventEmitter, setRemountKey }), [internal_eventEmitter]);
// deps [internal_eventEmitter] 不变 (setRemountKey 是 useState setter, 稳定引用, 省略合法, 与原一致)。
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
