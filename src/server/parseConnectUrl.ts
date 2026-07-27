/**
 * Parse Connect URL — 解析连接 URL
 *
 * 解析 `cc://` 和 `cc+unix://` 格式的连接 URL，
 * 用于直接连接到远程 Fusion-Code 服务器。
 *
 * gated by feature('DIRECT_CONNECT')
 */

const BLOCKED_PRIVATE_HOSTNAMES = new Set([
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

export interface ParsedConnectUrl {
  /** Connection type */
  type: 'tcp' | 'unix'
  /** Hostname for TCP connections */
  host?: string
  /** Port for TCP connections */
  port?: number
  /** Unix socket path for unix connections */
  socketPath?: string
  /** Auth token from the URL */
  authToken?: string
  /** Session ID to resume */
  sessionId?: string
  /** Constructed server URL (http://host:port for TCP) */ // log: fix TS2339
  serverUrl?: string // log: fix TS2339
}

/**
 * Parse a `cc://` or `cc+unix://` connection URL.
 *
 * Format:
 *   cc://host:port?token=xxx&session=yyy
 *   cc+unix:///path/to/socket?token=xxx&session=yyy
 */
export function parseConnectUrl(url: string): ParsedConnectUrl {
  if (url.startsWith('cc+unix://')) {
    return parseUnixUrl(url)
  }
  if (url.startsWith('cc://')) {
    return parseTcpUrl(url)
  }
  throw new Error(`Invalid connect URL: ${url}. Expected cc:// or cc+unix://`)
}

function parseTcpUrl(url: string): ParsedConnectUrl {
  const withoutScheme = url.slice('cc://'.length)
  const [hostPort, ...queryParts] = withoutScheme.split('?')
  const query = queryParts.join('?')

  const [host, portStr] = (hostPort || '').split(':')
  const port = portStr ? parseInt(portStr, 10) : undefined
  const params = new URLSearchParams(query || '')

  const resolvedHost = host || 'localhost'
  if (isPrivateOrReservedIP(resolvedHost)) {
    throw new Error(
      `Connect URL hostname "${resolvedHost}" is a private/reserved address (SSRF protection)`,
    )
  }

  const resolvedPort = port || 8080
  return {
    type: 'tcp',
    host: resolvedHost,
    port: resolvedPort,
    authToken: params.get('token') || undefined,
    sessionId: params.get('session') || undefined,
    serverUrl: `http://${resolvedHost}:${resolvedPort}`, // log: fix TS2339
  }
}

function parseUnixUrl(url: string): ParsedConnectUrl {
  const withoutScheme = url.slice('cc+unix://'.length)
  const [socketPath, ...queryParts] = withoutScheme.split('?')
  const query = queryParts.join('?')
  const params = new URLSearchParams(query || '')

  return {
    type: 'unix',
    socketPath: socketPath || undefined,
    authToken: params.get('token') || undefined,
    sessionId: params.get('session') || undefined,
    serverUrl: socketPath || '', // log: fix TS2339
  }
}