import type { Command } from "../../commands.js";

const offline = {
	type: "local",
	name: "offline",
	description: "Toggle offline mode — force local MLX, block all network tools",
	aliases: ["airplane"],
	isEnabled: () => true,
	load: () => import("./offline.js"),
} satisfies Command;
export default offline;
