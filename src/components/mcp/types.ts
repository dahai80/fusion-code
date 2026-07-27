import type {
    ConfigScope,
    MCPServerConnection,
    McpClaudeAIProxyServerConfig,
    McpHTTPServerConfig,
    McpSSEServerConfig,
    McpStdioServerConfig,
} from '../../services/mcp/types.js'

// ServerInfo: discriminated union on `transport`
// Constructed in MCPSettings.tsx from MCPServerConnection clients

export type StdioServerInfo = {
    name: string
    client: MCPServerConnection
    scope: ConfigScope
    transport: 'stdio'
    config: McpStdioServerConfig
}

export type SSEServerInfo = {
    name: string
    client: MCPServerConnection
    scope: ConfigScope
    transport: 'sse'
    isAuthenticated: boolean | undefined
    config: McpSSEServerConfig
}

export type HTTPServerInfo = {
    name: string
    client: MCPServerConnection
    scope: ConfigScope
    transport: 'http'
    isAuthenticated: boolean | undefined
    config: McpHTTPServerConfig
}

export type ClaudeAIServerInfo = {
    name: string
    client: MCPServerConnection
    scope: ConfigScope
    transport: 'claudeai-proxy'
    isAuthenticated: false
    config: McpClaudeAIProxyServerConfig
}

export type ServerInfo =
    | StdioServerInfo
    | SSEServerInfo
    | HTTPServerInfo
    | ClaudeAIServerInfo

// AgentMcpServerInfo: discriminated union on `transport`
// Constructed in services/mcp/utils.ts extractAgentMcpServers()
// Only stdio/sse/http/ws variants are produced

export type AgentMcpServerInfo =
    | {
          name: string
          sourceAgents: string[]
          transport: 'stdio'
          command: string
          needsAuth: false
          isAuthenticated?: boolean
      }
    | {
          name: string
          sourceAgents: string[]
          transport: 'sse'
          url: string
          needsAuth: true
          isAuthenticated?: boolean
      }
    | {
          name: string
          sourceAgents: string[]
          transport: 'http'
          url: string
          needsAuth: true
          isAuthenticated?: boolean
      }
    | {
          name: string
          sourceAgents: string[]
          transport: 'ws'
          url: string
          needsAuth: false
          isAuthenticated?: boolean
      }

// MCPViewState: discriminated union on `type`
// Manages navigation state within MCPSettings

export type MCPViewState =
    | { type: 'list'; defaultTab?: string }
    | { type: 'server-menu'; server: ServerInfo }
    | { type: 'server-tools'; server: ServerInfo }
    | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number }
    | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo }
