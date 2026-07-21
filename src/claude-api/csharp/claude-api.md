# Building Claude Apps with C#

This document provides guidance on building Claude-integrated applications using C# and the .NET ecosystem.

## Overview

Claude Code can be integrated with C# applications through several mechanisms:
- **MCP (Model Context Protocol)** — Expose .NET tools and data to Claude
- **CLI Integration** — Invoke Claude Code from .NET build pipelines
- **SDK Integration** — Use the Claude Agent SDK with .NET clients

## MCP Server in C#

Create a Model Context Protocol server to expose .NET capabilities to Claude:

```csharp
using ModelContextProtocol;

var server = new McpServer("my-dotnet-service");
server.AddTool("search-code", "Search codebase", async (query) => {
    return await SearchCodebase(query);
});
await server.RunAsync();
```

## CLI Integration

Invoke Claude Code from .NET build scripts:

```csharp
var process = new Process {
    StartInfo = new ProcessStartInfo {
        FileName = "claude",
        Arguments = "-p \"Review the code changes in this PR\"",
        RedirectStandardOutput = true
    }
};
process.Start();
var result = process.StandardOutput.ReadToEnd();
```

## Best Practices

1. Use MCP for bidirectional communication between .NET and Claude
2. Expose domain-specific tools via MCP servers
3. Use structured output formats for reliable parsing
4. Implement proper error handling and timeouts