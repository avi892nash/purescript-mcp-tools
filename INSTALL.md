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

## 5. Interacting with the Tool (via Stdio)
You interact with the script by sending newline-delimited JSON objects to its standard input. The script processes each JSON object as a command and sends a newline-delimited JSON object as a response to its standard output.

Each input JSON command should have at least a `toolName` property. It can also include `args` (an object) and an optional `requestId` (for client-side tracking).

**Example Input (sent to stdin):**
```json
{"toolName": "echo", "args": {"message": "Hello Stdio World"}, "requestId": "echo-test-123"}
```

**Example Output (received from stdout):**
```json
{"status":"success","result":{"echoed_message":"Echo: Hello Stdio World"},"requestId":"echo-test-123"}
```
Or, in case of an error:
```json
{"status":"error","error":{"message":"Tool 'unknown_tool' not found."},"requestId":"unknown-test-456"}
```

**Available Tools:**
To get a list of all available tools and their input/output schemas, send the `get_manifest` command:
Input to stdin:
```json
{"toolName": "get_manifest"}
```
The script will respond on stdout with the full manifest object.

## 6. MCP Client Configuration (`mcp-config.json`)
This project includes an `mcp-config.json` file configured for an MCP client system that can execute command-line tools. It's set up as:
```json
{
  "servers": [
    {
      "name": "purescript-mcp-stdio-server",
      "description": "A local MCP server for PureScript related tasks, communicating via stdio.",
      "type": "executable",
      "command": "node index.js",
      "tools": [ /* ... list of tools ... */ ]
    }
  ]
}
```
An MCP client (like Cline's environment) would use this configuration to:
1. Know that `purescript-mcp-stdio-server` is an executable tool.
2. Launch it using the command `node index.js` (relative to this project's root).
3. Communicate with the spawned process by writing JSON commands to its stdin and reading JSON responses from its stdout.

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
