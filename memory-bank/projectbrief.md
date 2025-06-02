# Project Brief: PureScript MCP Server

## 1. Project Title
PureScript MCP Server Infrastructure

## 2. Project Goal
To create a foundational MCP (Model Context Protocol) server in Node.js that can be extended to integrate with various APIs for a PureScript project. The server should include a boilerplate structure that is testable with sample PureScript examples.

## 3. Scope
- **In Scope:**
    - Creation of a basic Node.js MCP server.
    - Definition of a simple boilerplate MCP tool (e.g., an echo tool or a simple PureScript code execution tool).
    - Configuration file for the MCP server (`mcp-config.json`).
    - A proper PureScript project in `purescript-test-examples` (initialized with Spago, with basic dependencies and build structure) to serve as a testbed.
    - Initial Memory Bank setup.
    - Initial `.clinerules` file.
- **Out of Scope:**
    - Full implementation of complex API integrations (these will be added later).
    - Advanced PureScript compilation or execution within the MCP server beyond a basic example.
    - UI for interacting with the MCP server.

## 4. Target Users
- Developers working on the PureScript project who will utilize the MCP server for extended functionalities.
- Cline (AI assistant) who will use this server to perform tasks related to the PureScript project.

## 5. Key Deliverables
- A functional Node.js MCP server.
- `mcp-config.json` file.
- A compiled `purescript-test-examples` Spago project.
- Complete initial Memory Bank.
- Initial `.clinerules` file.

## 6. Success Criteria
- The MCP server starts without errors.
- The server can be registered via `mcp-config.json`.
- Tools provided by the server can be invoked and interact correctly with the `purescript-test-examples` project (e.g., `start_purs_ide_server` can load it).
- All Memory Bank core files are created.
