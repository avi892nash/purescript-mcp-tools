# Tech Context: PureScript MCP Server

## 1. Technologies Used
- **Primary Language:** Node.js (JavaScript).
- **Package Manager:** npm.
- **HTTP Server:** Express.js (for MCP server).
- **AST Parsing:** `web-tree-sitter` with `tree-sitter-purescript.wasm`.
- **PureScript IDE Interaction:**
    - Node.js `child_process` module (specifically `spawn`) to manage the `purs ide server` process.
    - Node.js `net` module for TCP communication with the `purs ide server`.
- **Logging Aid:** `chalk` for colored console output.
- **PureScript Toolchain:** `purs ide` (assumed to be available via `npx purs` or globally).
- **Testing (for the server itself):** Manual testing via MCP tool invocation. Formal testing frameworks (Jest, Mocha) could be added later.

## 2. Development Setup
- **Node.js:** Required to be installed on the development/execution machine.
- **PureScript:** Required to be installed if tools directly interact with PureScript compilation or execution. The version should be compatible with the `purescript-test-examples`.
- **IDE/Editor:** Any standard code editor (like VS Code) can be used.
- **`package.json`:** Will define project dependencies, scripts for running the server, and other metadata.

## 3. Technical Constraints
- The MCP server runs as a standalone Node.js process.
- `purs ide server` is managed as a child process.
- Communication with `purs ide` is over TCP, expecting newline-terminated JSON.
- `tree-sitter-purescript.wasm` must be present in the project root for AST querying.
- `npx` and `purs` (with `purs ide`) must be available in the environment where the MCP server runs, or in the specified `project_path` for `purs ide`.

## 4. Dependencies
- **Core:**
    - `express`: HTTP server framework for MCP.
    - `web-tree-sitter`: PureScript AST parsing.
    - `chalk`: Console log styling.
- **Implicit (via `npx purs`):**
    - The PureScript compiler toolchain, including `purs ide`.
- **Future:**
    - Libraries for specific API integrations if added.
