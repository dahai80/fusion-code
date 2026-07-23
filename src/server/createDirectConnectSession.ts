/* eslint-disable eslint-plugin-n/no-unsupported-features/node-builtins */

import { errorMessage } from '../utils/errors.js'
import { logForDebugging } from '../utils/debug.js'
import { jsonStringify } from '../utils/slowOperations.js'
import type { DirectConnectConfig } from './directConnectManager.js'
import { connectResponseSchema } from './types.js'

const BLOCKED_PRIVATE_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal',
    'metadata.azure.com',
])

const BLOCKED_IP_PATTERNS: RegExp[] = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^0\./,
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
    /^198\.1[89]\./,
    /^::1$/,
    /^fe80:/i,
    /^fc00:/i,
    /^fd:/i,
    /^::$/,
]

function isPrivateOrReservedIP(hostname: string): boolean {
    if (BLOCKED_PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
        return true
    }
    for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(hostname)) {
            return true
        }
    }
    return false
}

/**
 * Errors thrown by createDirectConnectSession when the connection fails.
 */
export class DirectConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DirectConnectError'
  }
}

/**
 * Create a session on a direct-connect server.
 *
 * Posts to `${serverUrl}/sessions`, validates the response, and returns
 * a DirectConnectConfig ready for use by the REPL or headless runner.
 *
 * Throws DirectConnectError on network, HTTP, or response-parsing failures.
 */
export async function createDirectConnectSession({
  serverUrl,
  authToken,
  cwd,
  dangerouslySkipPermissions,
}: {
  serverUrl: string
  authToken?: string
  cwd: string
  dangerouslySkipPermissions?: boolean
}): Promise<{
  config: DirectConnectConfig
  workDir?: string
}> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(serverUrl)
  } catch {
    throw new DirectConnectError(`Invalid server URL: ${serverUrl}`)
  }

  const hostname = parsedUrl.hostname
  if (isPrivateOrReservedIP(hostname)) {
    logForDebugging(
      `createDirectConnectSession: blocked private/reserved hostname "${hostname}" (SSRF protection)`,
      { level: 'warn' },
    )
    throw new DirectConnectError(
      `Server URL hostname "${hostname}" is a private/reserved address (SSRF protection)`,
    )
  }

  let resp: Response
  try {
    resp = await fetch(`${serverUrl}/sessions`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30_000),
      body: jsonStringify({
        cwd,
        ...(dangerouslySkipPermissions && {
          dangerously_skip_permissions: true,
        }),
      }),
    })
  } catch (err) {
    throw new DirectConnectError(
      `Failed to connect to server at ${serverUrl}: ${errorMessage(err)}`,
    )
  }

  if (!resp.ok) {
    throw new DirectConnectError(
      `Failed to create session: ${resp.status} ${resp.statusText}`,
    )
  }

  const result = connectResponseSchema().safeParse(await resp.json())
  if (!result.success) {
    throw new DirectConnectError(
      `Invalid session response: ${result.error.message}`,
    )
  }

  const data = result.data
  return {
    config: {
      serverUrl,
      sessionId: data.session_id,
      wsUrl: data.ws_url,
      authToken,
    },
    workDir: data.work_dir,
  }
}
