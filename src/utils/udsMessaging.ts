/**
 * UDS Messaging — Unix Domain Socket 消息
 *
 * 通过 Unix Domain Socket 实现进程间消息传递。
 * 支持本地 peer 发现、消息发送和接收。
 * 用于 `--messaging-socket-path` 命令行选项。
 *
 * gated by feature('UDS_INBOX')
 */

import { createServer, type Socket } from 'net'
import { existsSync, unlinkSync } from 'fs'
import { randomUUID } from 'crypto'
import { logForDebugging } from '../utils/debug.js'

export interface UDSMessage {
  id: string
  type: 'text' | 'command' | 'notification' | 'ping'
  sender: string
  recipient?: string
  payload: string
  timestamp: number
}

export interface UDSPeer {
  id: string
  socketPath: string
  connectedAt: number
}

let server: ReturnType<typeof createServer> | null = null
let messageHandlers: Array<(msg: UDSMessage) => void> = []

/**
 * Start a UDS messaging server on the given socket path.
 */
export function startMessagingServer(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up any existing socket file
    if (existsSync(socketPath)) {
      try { unlinkSync(socketPath) } catch { /* ignore */ }
    }

    server = createServer((clientSocket: Socket) => {
      let buffer = ''

      clientSocket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        processBuffer(clientSocket, buffer)
      })

      clientSocket.on('error', (err: Error) => {
        logForDebugging(`[UDS] Socket error: ${err.message}`)
      })
    })

    server.listen(socketPath, () => {
      logForDebugging(`[UDS] Messaging server listening on ${socketPath}`)
      resolve()
    })

    server.on('error', (err: Error) => {
      reject(err)
    })
  })
}

/**
 * Stop the messaging server.
 */
export function stopMessagingServer(): void {
  if (server) {
    server.close()
    server = null
  }
  messageHandlers = []
}

/**
 * Register a message handler.
 * Returns a cleanup function that removes the handler.
 */
export function onMessage(handler: (msg: UDSMessage) => void): () => void {
  messageHandlers.push(handler)
  return () => {
    const idx = messageHandlers.indexOf(handler)
    if (idx !== -1) {
      messageHandlers.splice(idx, 1)
    }
  }
}

/**
 * Send a message to a local peer via UDS.
 */
export function sendMessage(socketPath: string, message: UDSMessage): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new (require('net').Socket)()
    const data = JSON.stringify(message) + '\n'

    client.connect(socketPath, () => {
      client.write(data)
    })

    client.on('end', () => {
      resolve()
    })

    client.on('error', (err: Error) => {
      reject(err)
    })

    // Timeout after 5 seconds
    setTimeout(() => {
      client.destroy()
      reject(new Error('UDS send timeout'))
    }, 5000)
  })
}

/**
 * Create a new UDS message.
 */
export function createMessage(
  type: UDSMessage['type'],
  sender: string,
  payload: string,
  recipient?: string,
): UDSMessage {
  return {
    id: randomUUID(),
    type,
    sender,
    recipient,
    payload,
    timestamp: Date.now(),
  }
}

/**
 * Discover local peers via UDS.
 * Returns a list of known peers.
 */
export function discoverPeers(): UDSPeer[] {
  // In the full implementation, this would scan for active UDS sockets
  return []
}

/**
 * Parse a UDS address string.
 * Format: "uds:<socket-path>" or "bridge:<session-id>"
 */
export function parseAddress(address: string): { scheme: string; value: string } {
  const colonIndex = address.indexOf(':')
  if (colonIndex === -1) {
    return { scheme: 'other', value: address }
  }
  return {
    scheme: address.slice(0, colonIndex),
    value: address.slice(colonIndex + 1),
  }
}

function processBuffer(clientSocket: Socket, buffer: string): void {
  const lines = buffer.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const message = JSON.parse(line) as UDSMessage
      messageHandlers.forEach(handler => handler(message))
    } catch {
      // Skip malformed messages
    }
  }
}