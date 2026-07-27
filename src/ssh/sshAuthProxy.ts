/**
 * SSH Auth Proxy — 本地认证代理
 *
 * 通过 Unix socket 将远程主机的 API 认证请求转发到本地。
 * 远程 CLI 通过 FUSION_UNIX_SOCKET 环境变量连接到本地代理，
 * 本地代理注入 OAuth token 后将请求转发到 Anthropic API。
 *
 * 这样远程主机无需存储任何 API 密钥或 OAuth token。
 *
 * gated by feature('SSH_REMOTE')
 */

import { createServer, type Socket } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { logForDebugging } from '../utils/debug.js'

export interface AuthProxyConfig {
  socketPath: string
  apiKey: string
  /** Base URL for the API to forward to (default: https://api.anthropic.com) */
  apiBaseUrl?: string
}

export interface AuthProxyInstance {
  socketPath: string
  stop: () => Promise<void>
}

/**
 * Start a local auth proxy server.
 * Listens on a Unix socket and forwards authenticated requests to the API.
 */
export function startAuthProxy(config: AuthProxyConfig): Promise<AuthProxyInstance> {
  return new Promise((resolve, reject) => {
    const server = createServer((clientSocket: Socket) => {
      const apiUrl = config.apiBaseUrl || 'https://api.anthropic.com'

      // Parse the incoming HTTP request from the remote CLI
      let requestData = ''
      clientSocket.on('data', (chunk: Buffer) => {
        requestData += chunk.toString()
      })

      clientSocket.on('end', () => {
        // Forward the request to the API with the auth header
        const lines = requestData.split('\n')
        const requestLine = lines[0] || ''
        const [, path] = requestLine.split(' ')

        if (!path) {
          clientSocket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
          return
        }

        // Build the forwarded request
        const forwardUrl = `${apiUrl}${path}`
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        }

        // Extract body from the original request
        const bodyStart = requestData.indexOf('\r\n\r\n')
        const body = bodyStart !== -1 ? requestData.slice(bodyStart + 4) : ''

        // Forward the request
        fetch(forwardUrl, {
          method: 'POST',
          headers,
          body: body || undefined,
        })
          .then(async apiResponse => {
            const responseBody = await apiResponse.text()
            const responseHeaders = [
              `HTTP/1.1 ${apiResponse.status} ${apiResponse.statusText}`,
              'Content-Type: application/json',
              `Content-Length: ${Buffer.byteLength(responseBody)}`,
              'Connection: close',
              '',
              '',
            ].join('\r\n')
            clientSocket.write(responseHeaders)
            clientSocket.write(responseBody)
            clientSocket.end()
          })
          .catch(error => {
            const errorBody = JSON.stringify({
              type: 'error',
              error: {
                type: 'proxy_error',
                message: `Auth proxy error: ${(error as Error).message}`,
              },
            })
            const errorResponse = [
              'HTTP/1.1 502 Bad Gateway',
              'Content-Type: application/json',
              `Content-Length: ${Buffer.byteLength(errorBody)}`,
              'Connection: close',
              '',
              errorBody,
            ].join('\r\n')
            clientSocket.write(errorResponse)
            clientSocket.end()
          })
      })

      clientSocket.on('error', (err: Error) => {
        logForDebugging(`[AuthProxy] Client socket error: ${err.message}`)
      })
    })

    const socketPath = config.socketPath || join(tmpdir(), `auth-proxy-${randomUUID()}.sock`)

    server.listen(socketPath, () => {
      logForDebugging(`[AuthProxy] Listening on ${socketPath}`)
      resolve({
        socketPath,
        stop: () => new Promise<void>((res) => server.close(() => res())),
      })
    })

    server.on('error', (err: Error) => {
      reject(err)
    })
  })
}

/**
 * HTTP proxy over Unix socket for the remote CLI.
 * The remote CLI sets FUSION_UNIX_SOCKET to the socket path,
 * and all API requests go through this proxy.
 */
export function createProxyFetch(socketPath: string): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const urlObj = new URL(url)
    const path = urlObj.pathname + urlObj.search

    // Build the HTTP request to send over the Unix socket
    const body = init?.body ? (init.body as string) : ''
    const headers = init?.headers as Record<string, string> | undefined
    const requestLines = [
      `POST ${path} HTTP/1.1`,
      'Host: api.anthropic.com',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(body)}`,
      'Connection: close',
      ...(headers ? Object.entries(headers).map(([k, v]) => `${k}: ${v}`) : []),
      '',
      body,
    ].join('\r\n')

    // Use Bun's connect to Unix socket
    const { connect } = await import('net')
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath, () => {
        socket.write(requestLines)
      })

      let responseData = ''
      socket.on('data', (chunk: Buffer) => {
        responseData += chunk.toString()
      })

      socket.on('end', () => {
        // Parse HTTP response
        const headerEnd = responseData.indexOf('\r\n\r\n')
        if (headerEnd === -1) {
          reject(new Error('Invalid proxy response'))
          return
        }

        const headerLines = responseData.slice(0, headerEnd).split('\r\n')
        const statusLine = headerLines[0] || ''
        const [, statusCode] = statusLine.split(' ')
        const status = parseInt(statusCode || '500', 10)

        const bodyStart = headerEnd + 4
        const responseBody = responseData.slice(bodyStart)

        resolve(new Response(responseBody, {
          status,
          headers: { 'content-type': 'application/json' },
        }))
      })

      socket.on('error', (err: Error) => {
        reject(err)
      })
    })
  }
}