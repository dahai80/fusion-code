/**
 * Parse Connect URL — 解析连接 URL
 *
 * 解析 `cc://` 和 `cc+unix://` 格式的连接 URL，
 * 用于直接连接到远程 Fusion-Code 服务器。
 *
 * gated by feature('DIRECT_CONNECT')
 */

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

  return {
    type: 'tcp',
    host: host || 'localhost',
    port: port || 8080,
    authToken: params.get('token') || undefined,
    sessionId: params.get('session') || undefined,
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
  }
}