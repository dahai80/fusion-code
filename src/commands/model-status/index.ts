import type { Command } from "../../commands.js";

const modelStatus = {
	type: "local",
	name: "model-status",
	description: "Show model load, VRAM usage, and inference speed for local MLX",
	aliases: ["ms"],
	isEnabled: () => true,
	load: () => import("./model-status.js"),
} satisfies Command;
export default modelStatus;
