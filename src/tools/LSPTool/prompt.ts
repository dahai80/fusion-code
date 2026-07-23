export const LSP_TOOL_NAME = 'LSP' as const

export const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers for code intelligence.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover info (documentation, type info) for a symbol
- documentSymbol: Get all symbols in a document
- workspaceSymbol: Search for symbols across the workspace
- goToImplementation: Find implementations of an interface
- prepareCallHierarchy: Get call hierarchy at a position
- incomingCalls: Find all callers of a function
- outgoingCalls: Find all functions called by a function

All operations require filePath, line (1-based), character (1-based).
workspaceSymbol also requires query — always provide it.`

export const PROMPT = `Interact with Language Server Protocol (LSP) servers for code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols matching a query across the workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position
- incomingCalls: Find all callers of a function/method
- outgoingCalls: Find all functions/methods called by a function

All operations require:
- filePath: The file to operate on
- line: 1-based line number
- character: 1-based character offset

workspaceSymbol also requires:
- query: Symbol name or partial name. Always provide it — most servers return nothing for empty queries.

When to use:
- Finding where a function/class is defined (goToDefinition)
- Finding all usages of a symbol (findReferences)
- Understanding a symbol's type and documentation (hover)
- Navigating an unfamiliar codebase (workspaceSymbol)
- Understanding call relationships (incomingCalls, outgoingCalls)

Tips:
- Use goToDefinition first when exploring new code
- Use findReferences to understand impact of changes
- Use hover to quickly check types without reading the full file
- LSP servers must be configured for the file type — returns error if unavailable
- Line and character are 1-based (editor-style, not 0-based)`
