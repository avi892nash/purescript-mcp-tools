# Installation Guide: PureScript MCP Server

This guide provides instructions on how to set up and run the PureScript MCP Server.

## 1. Prerequisites

Before you begin, ensure you have the following installed on your system:

*   **Node.js and npm:** This project is built with Node.js. You can download them from [nodejs.org](https://nodejs.org/).
*   **PureScript and Spago (Optional but Recommended):**
    *   If you intend to run or modify the PureScript examples in `purescript-test-examples` or use tools that interact with the `purs ide server` (like `start_purs_ide_server`, `query_purs_ide`, `generate_dependency_graph`), you will need the PureScript compiler (`purs`) and the Spago package manager.
    *   Follow the installation instructions on the [PureScript website](https://www.purescript.org/documentation/getting-started/) and [Spago GitHub repository](https://github.com/purescript/spago).
*   **Git:** For cloning the repository.

## 2. Installation Steps

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url>
    cd <repository-directory>
    ```
    (Replace `<repository-url>` and `<repository-directory>` with the actual URL and project directory name)

2.  **Install Node.js Dependencies:**
    Navigate to the project's root directory (if you haven't already) and run:
    ```bash
    npm install
    ```
    This will install all the necessary packages defined in `package.json`, including Express.js, web-tree-sitter, etc.

3.  **Verify `tree-sitter-purescript.wasm`:**
    Ensure the `tree-sitter-purescript.wasm` file is present in the root of the project directory. This file is required for the `query_purescript_ast` tool.

4.  **Set up PureScript Test Examples (Optional):**
    If you plan to use the `purescript-test-examples`:
    ```bash
    cd purescript-test-examples
    spago install
    spago build
    cd ..
    ```

## 3. Running the MCP Server

To start the PureScript MCP Server, run the following command from the project's root directory:

```bash
npm start
```

By default, the server will start on `http://localhost:3000`. You can configure this in `index.js` if needed.

The server's tools can then be discovered and used by an MCP client via the `mcp-config.json` file.

## 4. Running Tests

This project includes an automated test script to verify the functionality of the MCP server and its tools. To run the tests:

```bash
npm test
```

This command executes `run_tests.js`, which will interact with the server (ensure it's running or can be started by the script if designed that way) and report test outcomes.
