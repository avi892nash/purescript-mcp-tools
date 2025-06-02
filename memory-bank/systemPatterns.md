# System Patterns: PureScript MCP Server

## 1. System Architecture
The system will consist of:
- **Cline (AI Assistant):** The primary user of the MCP server.
- **MCP Client (within Cline's environment):** Responsible for discovering and invoking tools on the MCP server.
- **PureScript MCP Server (Node.js):** A standalone Node.js application that:
    - Implements the MCP specification for tool providers.
    - Listens for incoming requests (e.g., over HTTP or a similar mechanism defined by MCP).
    - Exposes a set of tools related to PureScript.
    - Executes tool logic.
    - Returns results or errors.
- **`mcp-config.json`:** A configuration file that allows Cline's environment to discover and connect to this MCP server.
- **`purescript-test-examples` directory:** Contains sample PureScript files or projects that the server's tools can operate on for testing or demonstration.

```mermaid
graph LR
    Cline -->|Uses| MCPClient[MCP Client in Cline Env]
    MCPClient -->|Discovers via mcp-config.json| PSS_MCPServer[PureScript MCP Server (Node.js)]
    
    subgraph PSS_MCPServer Controlled Processes
        PursIDEServer[purs ide server process]
    end

    PSS_MCPServer -- Manages/Proxies --> PursIDEServer
    PSS_MCPServer -- Uses for AST Querying --> TreeSitter[web-tree-sitter + WASM]
    PursIDEServer -->|Interacts with| PureScriptProject[PureScript Project Files (src, output, spago) e.g., purescript-test-examples]
    
    PSS_MCPServer -->|Uses for Testing (AST/Examples)| TestExamples[purescript-test-examples (Spago Project)]

```

## 2. Key Technical Decisions
- **Language:** Node.js for the MCP server (JavaScript).
- **MCP Communication:** Utilizes HTTP for tool invocation, implemented with a standard Node.js web framework (details in Tech Context).
- **AST Querying:** Employs direct AST parsing for PureScript code analysis (specific library detailed in Tech Context).
- **PureScript IDE Interaction:**
    - The MCP server manages a `purs ide server` as a child process.
    - Communication with `purs ide server` is via TCP sockets, sending/receiving JSON.
- **Tool Definition:** Tools defined with JSON schemas for inputs/outputs.
- **Error Handling:** Basic error handling for server operations and tool execution. `purs ide` errors are proxied.

## 3. Design Patterns
- **Tool Provider Pattern:** The MCP server exposes functionalities as distinct tools.
- **Process Management:** The MCP server manages the lifecycle of the `purs ide server` process.
- **Proxy Pattern (Simplified):** The `query_purs_ide` tool acts as a proxy for sending commands to the `purs ide` server.
- **Request/Response Pattern:** For all MCP tool interactions and for `purs ide` communication.
- **Configuration-based Discovery:** Using `mcp-config.json`.

## 4. Component Relationships
- **PureScript MCP Server (Node.js):** The main application.
    - Hosts MCP tools (`echo`, `query_purescript_ast`, `start_purs_ide_server`, `stop_purs_ide_server`, `query_purs_ide`).
    - Manages the `purs ide server` child process.
    - Uses `web-tree-sitter` for AST queries.
- **`purs ide server` (Child Process):**
    - A standard PureScript tooling server.
    - Communicates with the MCP server over TCP.
    - Reads PureScript project files and externs.
- **`tree-sitter-purescript.wasm`:** Grammar file used by `web-tree-sitter`.
- **`purescript-test-examples`:** A proper Spago-initialized PureScript project used as a testbed for `purs ide` and other tools.
