# Active Context: PureScript MCP Server - Refactored to Stdio Communication

## 1. Current Work Focus
The PureScript MCP Server has been significantly refactored to use stdio (standard input/output) for communication instead of HTTP. This changes its nature from a network server to a command-line tool that processes JSON requests from stdin and returns JSON responses to stdout.

## 2. Recent Changes
- **Architectural Refactor to Stdio:**
    - **`index.js`:**
        - Removed Express.js HTTP server implementation.
        - Added `readline` module to process newline-delimited JSON commands from `process.stdin`.
        - Tool execution results are now written as JSON strings to `process.stdout`.
        - Logging is directed to `process.stderr` using `chalk`.
        - Added `get_manifest` and `get_server_status` tools.
        - All existing tool logic (echo, AST query, purs ide management, dependency graph) adapted to the stdio model.
    - **`mcp-config.json`:**
        - Changed server `type` from `"http"` to `"executable"`.
        - Added `command: "node index.js"` to specify how to run the tool.
        - Removed `baseUrl` and `manifestPath` (HTTP-specific).
        - Updated tool list to match the new manifest provided by `get_manifest` tool.
    - **Memory Bank Update:**
        - `systemPatterns.md`: Updated architecture diagrams and descriptions for stdio communication.
        - `techContext.md`: Removed "Express.js", added "readline", updated technical constraints.
        - `productContext.md`: Updated "How it Should Work" to describe stdio interaction.
        - `projectbrief.md`: Updated "Project Goal", "Scope", "Key Deliverables", and "Success Criteria" for stdio model.

Previously (before stdio refactor):
- **Revised `INSTALL.md`:**
    - Focused on cloning, dependency installation, and detailed steps for MCP client configuration (making the client aware of this server's `mcp-config.json`).
    - Removed operational details like `npm start` and `npm test` from `INSTALL.md`.
- **Git Operations:**
    - Committed and pushed the refined `INSTALL.md` to `origin/main`.
- **Deleted `CLINE_MCP_INSTALL.md`**.
- **Updated `.clinerules`**.
- **Finalized General Installation Prompt**.
- **Git Remote Setup**.
- **Created `INSTALL.md` (initial version)**.
- **Updated `mcp-config.json` (HTTP version)**.
- **Automated test script (`run_tests.js`) for HTTP server executed successfully.**
- **Fixed `generate_dependency_graph` tool (HTTP version).**
- **Enhanced `purescript-test-examples`.**

## 3. Next Steps
- **Test the Stdio Interface:** Thoroughly test the new stdio communication model by sending JSON commands to `node index.js` via stdin and verifying stdout responses for all tools.
- **Update `INSTALL.md`:** Revise installation and usage instructions to reflect the stdio-based operation (i.e., running `node index.js` and interacting via stdin/stdout, not `npm start` for an HTTP server).
- **Update `run_tests.js`:** The existing test script is designed for an HTTP server. It needs to be completely rewritten to:
    - Spawn `node index.js` as a child process.
    - Send JSON commands to its stdin.
    - Read and parse JSON responses from its stdout.
    - Assert correctness for all tools based on the new stdio interaction.
- **Update `.clinerules`:** Reflect the change to stdio and the new testing approach.
- **Commit and Push Changes:** Once testing and documentation are updated, commit all changes related to the stdio refactor.

## 4. Active Decisions and Considerations
- **Client Interaction Model:** The client (e.g., Cline's environment) must now be capable of spawning the `node index.js` process and managing stdio communication with it. This is different from the previous HTTP client model.
- **Error Handling:** Errors from tool execution are now reported as part of the JSON response on stdout. Script-level errors or internal logs are on stderr.
- **`purs ide server` Lifecycle:** The `index.js` script still manages the `purs ide server` child process. If `index.js` exits (e.g., stdin closes), it attempts to stop the `purs ide server`.
- **Manifest Discovery:** The tool manifest is now retrieved by sending a `{"toolName": "get_manifest"}` command to the script's stdin.
