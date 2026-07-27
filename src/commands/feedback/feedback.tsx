import type { LocalJSXCommandContext } from "../../commands.js";
import type { LocalJSXCommandOnDone } from "../../types/command.js";

export async function call(
	onDone: LocalJSXCommandOnDone,
	context: LocalJSXCommandContext,
	args: string,
): Promise<React.ReactNode> {
	const { Feedback } = await import("../../components/Feedback.js");
	const initialDescription = args || "";
	return (
		<Feedback
			abortSignal={context.abortController.signal}
			messages={context.messages}
			initialDescription={initialDescription}
			onDone={onDone}
			backgroundTasks={{}}
		/>
	);
}
