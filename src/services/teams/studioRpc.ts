// Issue #268 (T4a): minimal UDS JSON-RPC client for the agent-studio daemon
// (fusion-studio.sock control plane). teams.* is a pure RPC consumer surface
// — no team kernel code lives in fusion-code (see agent-studio #707 T3).
//
// Auth chain (matches daemon rpc_auth.py): apikey -> auth.login -> jwt,
// injected as `_auth: {jwt}` on every non-pre-auth call. Key resolution:
// FUSION_AGENT_STUDIO_API_KEY env > ~/.fusion-code/studio.key (0600 file
// written by the loopback bootstrap) > one-time apikey.loopback_create
// bootstrap (UDS peer-uid trusted, upstream loopback.py).
//
// Socket resolution mirrors agent_runtime/daemon_server.py:
// FUSION_STUDIO_SOCKET > FUSION_SOCKET_DIR/<fusion-studio.sock> > /tmp/fusion-studio.sock
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_SOCKET = "/tmp/fusion-studio.sock";
const KEY_FILE = join(homedir(), ".fusion-code", "studio.key");
const REQUEST_TIMEOUT_MS = 30_000;

export class StudioRpcError extends Error {
	code: number;

	constructor(code: number, message: string) {
		super(message);
		this.name = "StudioRpcError";
		this.code = code;
	}
}

export function resolveStudioSocketPath(): string {
	if (process.env.FUSION_STUDIO_SOCKET) {
		return process.env.FUSION_STUDIO_SOCKET;
	}
	const dir = process.env.FUSION_SOCKET_DIR?.trim();
	if (dir) {
		return `${dir.replace(/\/$/, "")}/fusion-studio.sock`;
	}
	return DEFAULT_SOCKET;
}

let nextRpcId = 1;

function rpcCallOverSocket(
	socketPath: string,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		const sock = connect(socketPath);
		let buf = "";
		const timer = setTimeout(() => {
			sock.destroy();
			reject(
				new StudioRpcError(-1, `timeout calling ${method} on ${socketPath}`),
			);
		}, REQUEST_TIMEOUT_MS);
		sock.on("error", (err) => {
			clearTimeout(timer);
			reject(
				new StudioRpcError(
					-1,
					`agent-studio daemon unreachable at ${socketPath}: ${err.message} (start it with fusion-agent-studio start.sh)`,
				),
			);
		});
		sock.on("connect", () => {
			sock.write(
				`${JSON.stringify({ jsonrpc: "2.0", id: nextRpcId++, method, params })}\n`,
			);
		});
		sock.on("data", (chunk: Buffer) => {
			buf += chunk.toString("utf8");
			const newline = buf.indexOf("\n");
			if (newline === -1) {
				return;
			}
			clearTimeout(timer);
			const line = buf.slice(0, newline);
			sock.destroy();
			try {
				const parsed = JSON.parse(line) as {
					result?: Record<string, unknown>;
					error?: { code: number; message: string };
				};
				if (parsed.error) {
					reject(new StudioRpcError(parsed.error.code, parsed.error.message));
					return;
				}
				resolve(parsed.result ?? {});
			} catch (e) {
				reject(
					new StudioRpcError(-1, `malformed daemon response: ${String(e)}`),
				);
			}
		});
	});
}

export interface StudioRpcClient {
	call(
		method: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>>;
}

interface RpcState {
	jwt: string;
}

const state: RpcState = { jwt: "" };

function readConfiguredKey(): string {
	const envKey = process.env.FUSION_AGENT_STUDIO_API_KEY?.trim();
	if (envKey) {
		return envKey;
	}
	if (existsSync(KEY_FILE)) {
		try {
			return readFileSync(KEY_FILE, "utf8").trim();
		} catch {
			return "";
		}
	}
	return "";
}

async function bootstrapKey(socketPath: string): Promise<string> {
	// One-time local bootstrap: apikey.loopback_create is pre-auth and only
	// reachable over the peer-uid-verified UDS control plane (upstream #579).
	const result = await rpcCallOverSocket(socketPath, "apikey.loopback_create", {
		name: "fusion-code-team-cli",
	});
	const secret = String(result.key_secret ?? "");
	if (!secret) {
		throw new StudioRpcError(
			-1,
			`loopback bootstrap returned no key: ${JSON.stringify(result)}`,
		);
	}
	mkdirSync(join(KEY_FILE, ".."), { recursive: true });
	writeFileSync(KEY_FILE, `${secret}\n`, { mode: 0o600 });
	chmodSync(KEY_FILE, 0o600);
	return secret;
}

async function ensureJwt(socketPath: string): Promise<string> {
	if (state.jwt) {
		return state.jwt;
	}
	let key = readConfiguredKey();
	if (!key) {
		key = await bootstrapKey(socketPath);
	}
	const login = await rpcCallOverSocket(socketPath, "auth.login", {
		apikey: key,
	});
	const jwt = String((login as { jwt?: string }).jwt ?? "");
	if (!jwt) {
		throw new StudioRpcError(
			-1,
			`auth.login returned no jwt: ${JSON.stringify(login)}`,
		);
	}
	state.jwt = jwt;
	return jwt;
}

export async function createStudioClient(
	socketPathOverride?: string,
): Promise<StudioRpcClient> {
	const socketPath = socketPathOverride ?? resolveStudioSocketPath();
	const call = async (
		method: string,
		params: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		const jwt = await ensureJwt(socketPath);
		const payload = { ...params, _auth: { jwt } };
		try {
			return await rpcCallOverSocket(socketPath, method, payload);
		} catch (e) {
			if (e instanceof StudioRpcError && e.code === 401) {
				// Expired/rotated jwt: drop it, re-login once, retry.
				state.jwt = "";
				const fresh = await ensureJwt(socketPath);
				return rpcCallOverSocket(socketPath, method, {
					...params,
					_auth: { jwt: fresh },
				});
			}
			throw e;
		}
	};
	return { call };
}

// Test hook: clear the cached jwt between cases.
export function resetStudioAuthCache(): void {
	state.jwt = "";
}
