export const DESCRIPTION = `Read a resource from an MCP server.`

export const PROMPT = `Read a resource from an MCP (Model Context Protocol) server.

MCP servers can expose resources (data, configuration, documentation) that can
be read at runtime. This tool fetches a specific resource by its URI.

When to use:
- Reading configuration from an MCP server
- Fetching reference data exposed by an MCP integration
- Accessing documentation or schemas from connected services

Key behaviors:
- The resource URI must be provided by the MCP server
- Resources are read-only — use MCP tools for mutations
- The returned content type depends on the resource
- Server must be connected and the resource must exist

Tips:
- Use ListMcpResources to discover available resources first
- Resource URIs follow the server's naming convention
- Handle errors gracefully — resources may be temporarily unavailable
- Cache results when reading the same resource repeatedly`
