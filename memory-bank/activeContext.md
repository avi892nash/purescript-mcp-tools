# Active Context: PureScript MCP Server - Refactored to Standard MCP Stdio Protocol

## 1. Current Work Focus
The PureScript MCP Server (`index.js`) has been refactored to conform to the standard Model Context Protocol (MCP) using JSON-RPC 2.0 over stdio. This ensures compatibility with MCP clients expecting standard methods like `initialize`, `tools/list`, and `tools/call`.

## 2. Recent Changes
- **Stdio Protocol Alignment (JSON-RPC 2.0):**
    - **`index.js`:**
        - Implemented JSON-RPC 2.0 message structures for requests and responses.
        - Added handlers for standard MCP methods:
            - `initialize`: Responds with server info and capabilities.
            - `tools/list`: Responds with a list of tool definitions (name, description, inputSchema).
            - `tools/call`: Invokes internal tool handlers based on `params.name` and `params.arguments`.
        - Adapted previous custom tool handlers (e.g., `handleEcho`) to be internal functions called by `tools/call`.
        - Restructured the internal tool manifest (`TOOL_DEFINITIONS`) to match the format expected by `tools/list`.
        - Removed the custom `get_manifest` tool, as `tools/list` serves this purpose.
        - The `get_server_status` tool remains for diagnostics, callable via `tools/call`.
    - **Memory Bank Update:**
        - `systemPatterns.md`: Updated to describe JSON-RPC 2.0 usage and standard MCP methods.
        - `techContext.md`: Updated "Stdio Handling & Protocol" to specify JSON-RPC 2.0.

- **Previous Architectural Refactor to Stdio (Custom Protocol):**
    - **`index.js`:**
        - Removed Express.js HTTP server.
        - Added `readline` for custom newline-delimited JSON over stdio.
        - Implemented custom `get_manifest` and `get_server_status` tools.
    - **`mcp-config.json`:**
        - Changed server `type` to `"executable"`, added `command: "node index.js"`.
    - **Memory Bank Update (Initial Stdio):**
        - `systemPatterns.md`, `techContext.md`, `productContext.md`, `projectbrief.md` updated for the initial (custom) stdio model.

Previously (before any stdio refactor):
- `INSTALL.md` created/updated for HTTP server.
- Git operations, `.clinerules` updates, etc. for HTTP server.

## 3. Next Steps
- **Test the Standard MCP Stdio Interface:** Thoroughly test the `initialize`, `tools/list`, and `tools/call` methods with valid JSON-RPC 2.0 requests.
- **Update `INSTALL.md`:** Ensure it accurately describes interaction via standard MCP methods (e.g., how a client would typically discover and call tools).
- **Update `run_tests.js`:** Rewrite the test script to:
    - Spawn `node index.js`.
    - Send an `initialize` request.
    - Send a `tools/list` request and verify the tool definitions.
    - Send `tools/call` requests for each tool with appropriate arguments and validate responses.
    - Use JSON-RPC 2.0 formatting for all communications.
- **Update `.clinerules`:** Reflect the adoption of standard MCP over stdio.
- **Review `package.json`:** Remove unused dependencies (e.g., `express`, `node-fetch` if confirmed no longer needed).
- **Commit and Push Changes:** Once testing and documentation are updated.

## 4. Active Decisions and Considerations
- **Protocol Compliance:** The script now aims for better compliance with standard MCP practices for stdio servers.
- **Client Expectations:** An MCP client should now be able to interact with this script more predictably.
- **Error Reporting:** Uses JSON-RPC 2.0 error object structure.
- **Tool Invocation:** Tools are now invoked via `{"method": "tools/call", "params": {"name": "tool_name", "arguments": {...}}}`.
