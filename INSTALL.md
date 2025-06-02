# Installation Guide: PureScript MCP Server

This guide provides instructions to install the PureScript MCP Server project and configure your MCP client system (e.g., VS Code with an MCP extension, a global MCP manager) to discover and use its tools.

## 1. Prerequisites

Before you begin, ensure you have the following installed on your system:

*   **Node.js and npm:** This project is built with Node.js. You can download them from [nodejs.org](https://nodejs.org/).
*   **Git:** For cloning the repository.
*   **An MCP Client System:** You should have an existing MCP client setup that you intend to use with this server (e.g., VS Code with the Model Context Protocol extension).

*(Optional but Recommended for full functionality/development)*:
*   **PureScript and Spago:** If you intend to run or modify the PureScript examples in `purescript-test-examples` or use tools that interact with the `purs ide server` (like `start_purs_ide_server`, `query_purs_ide`, `generate_dependency_graph`), you will need the PureScript compiler (`purs`) and the Spago package manager. Follow installation instructions on the [PureScript website](https://www.purescript.org/documentation/getting-started/) and [Spago GitHub repository](https://github.com/purescript/spago).

## 2. Installation Steps

1.  **Clone the Repository:**
    Open your terminal and clone the project using its Git URL:
    ```bash
    git clone ssh://git@ssh.bitbucket.juspay.net/~avinash.verma_juspay.in/purescript-tools-mcp.git
    cd purescript-tools-mcp
    ```

2.  **Install Node.js Dependencies:**
    Navigate to the project's root directory (`purescript-tools-mcp`) and run:
    ```bash
    npm install
    ```
    This command installs all necessary packages defined in `package.json`.

3.  **Configure Your MCP Client to Discover This Server:**
    For your MCP client to find and use the "purescript-mcp-server", you need to update your client's MCP configuration. This project (purescript-tools-mcp) provides its own `mcp-config.json` file in its root directory. You need to make your MCP client system aware of the server defined within this file.

    **How to do this depends on your specific MCP client setup:**

    *   **Option A: Client supports loading multiple `mcp-config.json` files:**
        Some MCP clients might allow you to specify paths to various `mcp-config.json` files or scan a directory for them. If so, configure your client to include the path to:
        `<path-to-your-cloned-repo>/purescript-tools-mcp/mcp-config.json`

    *   **Option B: Merging into a central MCP configuration file:**
        Many MCP clients use a central configuration file (e.g., `cline_mcp_settings.json`, VS Code's `settings.json` under an `mcp.servers` key, or a similar file). You will need to add or merge the server definition for "purescript-mcp-server" from this project's `mcp-config.json` into your client's central configuration.

        **The server entry to add/merge from `purescript-tools-mcp/mcp-config.json` looks like this:**
        ```json
        {
          "name": "purescript-mcp-server",
          "description": "A local MCP server for PureScript related tasks.",
          "type": "http",
          "baseUrl": "http://localhost:3000",
          "manifestPath": "/mcp/manifest",
          "tools": [
            // ... list of tools ...
          ]
        }
        ```
        **Important:**
        *   Ensure the `name` ("purescript-mcp-server") is unique within your MCP client's overall server list.
        *   The `baseUrl` (`http://localhost:3000`) must be accessible from where your MCP client is running.
        *   This step only makes the client *aware* of the server. The PureScript MCP Server itself must be running (e.g., via `npm start` in its directory) for the client to connect and use the tools.

4.  **Verify `tree-sitter-purescript.wasm` (If using AST-based tools):**
    The `query_purescript_ast` tool requires the `tree-sitter-purescript.wasm` file to be present in the root of the `purescript-tools-mcp` project directory. This file is included in the repository.

## Next Steps
Once these installation and client configuration steps are complete:
1.  Start the PureScript MCP Server (e.g., navigate to the `purescript-tools-mcp` directory and run `npm start`).
2.  Your MCP client should now be able to discover and list the tools provided by "purescript-mcp-server".

Refer to your specific MCP client's documentation for more details on managing and configuring MCP servers.
