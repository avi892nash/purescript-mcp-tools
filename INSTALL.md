# Installation and Usage: PureScript MCP Stdio Tool

This document provides instructions on how to set up and use the PureScript MCP Stdio Tool. This tool is a Node.js script that communicates via stdio (standard input/output), processing JSON commands and returning JSON responses.

## 1. Prerequisites
Before you begin, ensure you have the following installed:
- **Node.js and npm:** Required to run the script and install dependencies. You can download them from [nodejs.org](https://nodejs.org/).
- **Git:** Required to clone the repository.
- **PureScript Toolchain (Optional but Recommended):**
    - If you intend to use tools that interact with `purs ide server` (like `start_purs_ide_server`, `query_purs_ide`, `generate_dependency_graph`), you need a working PureScript installation (including `purs` and `spago`).
    - The script will attempt to use `npx purs ide server`, so ensure `npx` can find `purs`.
    - The `purescript-test-examples` directory requires PureScript to be built if you want to test against it.

## 2. Cloning the Repository
Clone the repository to your local machine using Git:
```bash
git clone ssh://git@ssh.bitbucket.juspay.net/~avinash.verma_juspay.in/purescript-tools-mcp.git
cd purescript-tools-mcp
```
*(Note: Replace the URL with the correct one if it differs. The current working directory for Cline is `/Users/avinash.verma/Juspay/what-is-purs`, which is assumed to be the root of this cloned repository).*

## 3. Installing Dependencies
Navigate to the project's root directory (e.g., `purescript-tools-mcp`) and install the Node.js dependencies:
```bash
npm install
```
This will install packages like `web-tree-sitter` and `chalk` as defined in `package.json`.

## 4. Running the Tool Script
The tool is a Node.js script (`index.js`) that runs in your terminal. To start it:
```bash
node index.js
```
The script will initialize (e.g., load the Tree-sitter parser) and then wait for JSON commands on its standard input.
- Logs and status messages from the script itself (and from `purs ide server` if started) will be printed to **stderr**.
- JSON responses to your commands will be printed to **stdout**.

## 5. Interacting with the Tool (JSON-RPC 2.0 over Stdio)
The script uses JSON-RPC 2.0 for communication over stdio.
- Send newline-delimited JSON-RPC 2.0 request objects to the script's **stdin**.
- Receive newline-delimited JSON-RPC 2.0 response objects from the script's **stdout**.

**Standard MCP Methods:**
- `initialize`: Client sends this first. Server responds with its capabilities.
  - Example Request: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"TestClient"},"capabilities":{}}}`
- `initialized`: Client sends this notification after receiving the `initialize` response.
  - Example Notification: `{"jsonrpc":"2.0","method":"initialized","params":{}}`
- `tools/list`: Client requests the list of available tools. Server responds with tool definitions.
  - Example Request: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
- `tools/call`: Client invokes a specific tool.
  - Example Request (for "echo" tool): `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"Hello JSON-RPC"}}}`
  - Example Response: `{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"\"Echo: Hello JSON-RPC\""}]}}` (Note: the tool's specific result is often a JSON string within the "text" field).

**Available Tools (Partial List - use `tools/list` for full details):**
The server provides several tools, including:
- `get_server_status`: Checks the server's status.
- `echo`: Echoes a message.
- `start_purs_ide_server`, `stop_purs_ide_server`, `query_purs_ide`: For interacting with `purs ide server`.
- `generate_dependency_graph`: Creates a dependency graph for modules.
- **New Granular AST Query Tools:** A suite of tools for detailed PureScript code analysis using Tree-sitter. These replace the deprecated `query_purescript_ast` tool. Examples:
    - `getModuleName(input: { filePath?: string; code?: string })`
    - `getImports(input: { filePath?: string; code?: string })`
    - `getFunctionNames(input: { code: string })`
    - `getTypeSignatures(input: { code: string })`
    - `getDataTypes(input: { code: string })`
    - `getTypeClasses(input: { code: string })`
    - `getInstances(input: { code: string })`
    - `getStringLiterals(input: { code: string })`
    - ...and many more. Refer to the `tools/list` output for the complete list and their schemas.
    - **Input Convention for AST Tools:**
        - Tools operating on whole modules (e.g., `getModuleName`, `getImports`) accept either `filePath` (string path to a .purs file) or `code` (string containing PureScript code).
        - Tools operating on code snippets (e.g., `getFunctionNames`, `getStringLiterals`) accept `code` (string containing PureScript code).

## 6. MCP Client Configuration (`mcp-config.json`)
This project includes an `mcp-config.json` file configured for an MCP client system that can execute command-line tools. It's set up as:
```json
{
  "servers": [
    {
      "id": "purescript-tools-mcp-server-id", // A unique ID for the server
      "name": "purescript-tools-mcp", // A human-readable name
      "description": "A local MCP server for PureScript related tasks, communicating via stdio using JSON-RPC 2.0.",
      "type": "executable",
      "command": "node index.js", // Command to run the server
      // "tools" array is no longer needed here as tools are discovered via 'tools/list'
    }
  ]
}
```
An MCP client (like Cline's environment) would use this configuration to:
1. Know that `purescript-tools-mcp` is an executable tool provider.
2. Launch it using the command `node index.js` (relative to this project's root).
3. Communicate with the spawned process using JSON-RPC 2.0 over its stdin/stdout.
4. Discover tools using the `tools/list` method.

## 7. PureScript Test Examples
The `purescript-test-examples/` directory contains a sample PureScript project. This can be used as a target for tools like `start_purs_ide_server` and `generate_dependency_graph`. To build it (if you have PureScript/Spago installed):
```bash
cd purescript-test-examples
spago build
cd ..
```

## 8. Stopping the Script
- If you are running `node index.js` directly in a terminal, you can usually stop it with `Ctrl+C`.
- If a client program spawns it, closing the script's stdin will also cause it to exit. When exiting, it will attempt to stop any active `purs ide server` child process it manages.
