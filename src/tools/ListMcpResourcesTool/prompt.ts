export const LIST_MCP_RESOURCES_TOOL_NAME = 'ListMcpResourcesTool'

export const DESCRIPTION = `List all resources available from connected MCP servers.`

export const PROMPT = `List all resources available from connected MCP (Model Context Protocol) servers.

MCP servers expose resources (data, configuration, documentation) that can be
read using ReadMcpResourceTool. This tool discovers what's available.

When to use:
- Discovering what resources an MCP server provides
- Finding resource URIs for ReadMcpResourceTool
- Understanding the capabilities of connected MCP servers
- Before reading a specific resource (to get the correct URI)

Key behaviors:
- Returns a list of resources with their URIs and descriptions
- Only lists resources from currently connected servers
- Resource availability may change if servers disconnect

Tips:
- Call this before ReadMcpResource to find the correct URI
- Resources may have different content types — check descriptions
- Some resources are static (config), others dynamic (live data)
- Use this to understand what an MCP integration provides`
