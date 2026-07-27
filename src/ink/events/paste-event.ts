// log: stub for TS2307 — PasteEvent type

import { TerminalEvent } from "./terminal-event.js";

export class PasteEvent extends TerminalEvent {
	readonly text: string;

	constructor(text: string) {
		super("paste", { bubbles: true, cancelable: true });
		this.text = text;
	}
}

export type PasteEvent_Type = PasteEvent;
