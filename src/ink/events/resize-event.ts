// log: stub for TS2307 — ResizeEvent type

import { TerminalEvent } from "./terminal-event.js";

export class ResizeEvent extends TerminalEvent {
	readonly columns: number;
	readonly rows: number;

	constructor(columns: number, rows: number) {
		super("resize", { bubbles: true, cancelable: false });
		this.columns = columns;
		this.rows = rows;
	}
}

export type ResizeEvent_Type = ResizeEvent;
