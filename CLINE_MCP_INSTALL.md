# Cline: PureScript MCP Server Installation & Usage Guide

This guide is specifically for me, Cline, to understand how to ensure the PureScript MCP Server is operational and how to utilize it. My memory resets, so this document is crucial.

## 1. Purpose of This MCP Server

This MCP server, located in the `purescript-tools-mcp` project (current working directory: `/Users/avinash.verma/Juspay/what-is-purs`), provides tools to interact with PureScript projects. Its primary functions include:
- Starting/stopping a `purs ide server`.
- Querying the `purs ide server`.
- Performing AST (Abstract Syntax Tree) queries on PureScript code using Tree-sitter.
- Generating dependency graphs for PureScript modules.

## 2. Ensuring the Server is Running

1.  **Navigate to the Project Directory:**
    The server code resides in the root of this project: `/Users/avinash.verma/Juspay/what-is-purs`.

2.  **Start the Server:**
    Open a terminal in the project root and run:
    ```bash
    npm start
    ```
    This command executes `node index.js` (as defined in `package.json`), which starts the Express.js server. By default, it listens on `http://localhost:3000`.

3.  **Verification:**
    If the server starts successfully, you should see a log message like "PureScript MCP Server listening on port 3000".

## 3. MCP Registration

This server is registered for my use via the `mcp-config.json` file located in the project root (`/Users/avinash.verma/Juspay/what-is-purs/mcp-config.json`).

The key details in `mcp-config.json` are:
-   **Server Name:** `purescript-mcp-server`
-   **Base URL:** `http://localhost:3000`
-   **Manifest Path:** `/mcp/manifest`

I will automatically discover and use the tools listed in this configuration when the server is running.

## 4. Key Tools Provided

Refer to the `description` field for each tool in `mcp-config.json` for detailed information. The main tools are:

*   `echo`: Simple echo tool for testing.
*   `query_purescript_ast`: Parses PureScript code and runs Tree-sitter queries. Requires `tree-sitter-purescript.wasm` in the project root.
*   `start_purs_ide_server`: Starts a `purs ide server` instance for a specified PureScript project path.
*   `stop_purs_ide_server`: Stops the managed `purs ide server`.
*   `query_purs_ide`: Sends commands to the running `purs ide server`.
*   `generate_dependency_graph`: Creates a dependency graph for PureScript modules. (Note: Can be slow for >100 modules).

## 5. Server Code Location

The main server logic is in `index.js` in the project root.
The PureScript test examples used by some tools are in the `purescript-test-examples/` directory.

## 6. Important Reminders for Myself (Cline)

*   Always ensure the server is running (`npm start`) before attempting to use its tools.
*   The `mcp-config.json` is my primary way of knowing about this server and its tools.
*   The `INSTALL.md` file in the repository contains more general setup instructions for human users.
*   My Memory Bank for this project (in `memory-bank/`) contains detailed context about the project's evolution and decisions.
