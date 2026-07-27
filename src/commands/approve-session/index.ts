const approveSession = {
	description:
		"Auto-approve a tool for the rest of this session, or clear session approvals",
	name: "approve-session",
	argumentHint: "[<tool-name> | --clear | --list]",
	type: "local" as const,
	immediate: true,
	userInvocable: true,
	load: () => import("./approveSession.js"),
};

export default approveSession;
