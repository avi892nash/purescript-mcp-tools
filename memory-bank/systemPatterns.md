# System Patterns: PureScript MCP Server

## 1. System Architecture
The system will consist of:
- **Cline (AI Assistant):** The primary user of the MCP server.
- **MCP Client (within Cline's environment):** Responsible for discovering and invoking tools on the MCP server.
- **PureScript MCP Server (Node.js):** A standalone Node.js command-line application that:
    - Implements the Model Context Protocol (MCP) for tool providers using JSON-RPC 2.0 over stdio.
    - Handles standard MCP methods: `initialize`, `tools/list`, `tools/call`.
    - Reads JSON-RPC requests from stdin.
    - Writes JSON-RPC responses to stdout.
    - Exposes a set of tools related to PureScript.
    - Executes tool logic.
- **`mcp-config.json`:** A configuration file that allows an MCP client (like Cline's environment) to discover this server as an executable command.
- **`purescript-test-examples` directory:** Contains sample PureScript files or projects that the server's tools can operate on for testing or demonstration.

```mermaid
graph LR
    Cline -->|Uses| MCPClient[MCP Client in Cline Env]
    MCPClient -- Executes & Communicates via Stdio (JSON-RPC 2.0) --> PSS_MCPServer[PureScript MCP Server (Node.js Script)]
    
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
- **MCP Communication:** Utilizes stdio, adhering to JSON-RPC 2.0 for message structure and standard MCP methods (`initialize`, `tools/list`, `tools/call`).
- **AST Querying:**
    - Core AST analysis is now primarily handled by the `getTopLevelDeclarations` tool. This tool uses `web-tree-sitter` to parse PureScript code and extracts detailed information (name, mapped type like `DeclValue`, `DeclData`, etc., and full text value) for various top-level declarations.
        - **Name extraction logic simplified:** Uses a `Map` for captures and a prioritized key list.
        - The post-processing logic for consolidating signatures has been removed, so it returns raw query results.
        - Queries for `newtype`, `type_role_declaration`, and `operator_declaration` (fixity) have been corrected.
        - Filtering by name, type, and value (using regular expressions) is supported.
    - Remaining granular tools like `getModuleName`, `getImports`, `getFunctionNames`, and `getWhereBindings` offer specific, focused queries. The `getWhereBindings` tool has been refined to correctly capture `where` clauses associated with functions.
- **PureScript IDE Interaction:**
    - The MCP server manages a `purs ide server` as a child process.
    - Communication with `purs ide server` is via TCP sockets, sending/receiving JSON.
- **Tool Definition:** Tools are defined with names, descriptions, and JSON schemas for their inputs, exposed via the `tools/list` method.
- **Error Handling:** Adheres to JSON-RPC 2.0 error object structure. `purs ide` errors are proxied.

## 3. Design Patterns
- **Tool Provider Pattern (MCP Standard):** The server exposes functionalities as distinct tools, discoverable via `tools/list` and callable via `tools/call`.
- **JSON-RPC 2.0 Protocol:** For request/response handling over stdio.
- **Process Management:** The MCP server manages the lifecycle of the `purs ide server` process.
- **Proxy Pattern (Simplified):** The `query_purs_ide` tool acts as a proxy for sending commands to the `purs ide` server.
- **Configuration-based Discovery:** Using `mcp-config.json` to locate and launch the executable script.

## 4. Component Relationships
- **PureScript MCP Server (Node.js Script):** The main application, run as a command-line tool.
    - Implements MCP stdio protocol (JSON-RPC 2.0).
    - Handles standard MCP methods (`initialize`, `tools/list`, `tools/call`).
    - Internally maps `tools/call` requests to specific tool handlers including:
        - Server management: `get_server_status`, `start_purs_ide_server`, `stop_purs_ide_server`
        - Basic: `echo`
        - PureScript IDE interaction: `query_purs_ide`
        - Advanced analysis: `generate_dependency_graph`
        - Granular AST querying:
            - `getModuleName`, `getImports`, `getFunctionNames`, `getWhereBindings` (refined query).
            - **Comprehensive tool:** `getTopLevelDeclarations` (returns raw query results; name extraction simplified; queries for newtype, role, fixity corrected).
        - (Deprecated: `query_purescript_ast`)
        - (Removed: `getDoBindings`, `getCasePatterns`, `getRecordFields`, `getVariableReferences`, `getIntegerLiterals`, `getLetBindings`, `getStringLiterals`, `getTypeSignatures`, `getDataTypes`, `getTypeClasses`, `getInstances`, `getTypeAliases`)
        - Direct `purs ide` command wrappers (focused on context gathering): `pursIdeLoad`, `pursIdeType`, `pursIdeRebuild`, `pursIdeUsages`, `pursIdeList`, `pursIdeCwd`, `pursIdeReset`, `pursIdeQuit`.
    - Manages the `purs ide server` child process.
    - Uses `web-tree-sitter` for the AST query tools.
    - **File Path Resolution:** For tools accepting a `filePath` (like `getModuleName`, `getImports`, `getTopLevelDeclarations`), relative paths are resolved against the `pursIdeProjectPath` (if the `purs ide server` is active and its project path is known), otherwise against the server's current working directory with a warning. Absolute paths are used directly.
- **`purs ide server` (Child Process):**
    - A standard PureScript tooling server.
    - Communicates with the MCP server over TCP.
    - Reads PureScript project files and externs.
- **`tree-sitter-purescript.wasm`:** Grammar file used by `web-tree-sitter`.
- **`purescript-test-examples`:** A proper Spago-initialized PureScript project used as a testbed for `purs ide` and other tools.
