export const PROMPT = `Interact with Model Context Protocol (MCP) servers to access external tools and data.

MCP servers provide additional tools beyond the built-in set. Each server
exposes its own set of tools with specific parameters and capabilities.

When to use:
- Accessing external services (databases, APIs, cloud services)
- Using specialized tools not available in the built-in set
- Interacting with project-specific tooling configured via MCP

Key behaviors:
- MCP tools are discovered at runtime from configured servers
- Each MCP tool has its own parameter schema
- MCP tools may require authentication or setup
- Server availability depends on configuration and connectivity

Tips:
- Check which MCP servers are available before calling
- Handle MCP tool errors gracefully — servers may be offline
- MCP tools may have different latency characteristics than built-in tools
- Use MCP tools when they provide capabilities built-in tools lack`

export const DESCRIPTION = `Interact with Model Context Protocol (MCP) servers to access external tools and data. MCP tools are discovered at runtime from configured servers.`
