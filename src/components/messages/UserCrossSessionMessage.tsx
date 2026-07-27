// log: stub for TS2307 — UserCrossSessionMessage feature-gated component

import type React from "react";

type UserCrossSessionMessageProps = {
	addMargin: boolean;
	param: { text: string; [key: string]: unknown };
};

export function UserCrossSessionMessage(
	_props: UserCrossSessionMessageProps,
): React.JSX.Element | null {
	return null;
}
