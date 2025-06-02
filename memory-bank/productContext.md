# Product Context: PureScript MCP Server

## 1. Problem Solved
This project aims to solve the need for extending the capabilities of an AI assistant (Cline) when working with PureScript projects. Currently, Cline might lack direct means to execute PureScript-specific tasks, interact with PureScript development environments, or integrate with PureScript-related APIs. An MCP server will provide a bridge for these functionalities.

## 2. How it Should Work
The MCP server will run as a separate Node.js process. It will expose a set of tools that Cline can invoke. These tools will perform actions related to PureScript, such as:
- Executing simple PureScript code snippets.
- (Future) Compiling PureScript projects.
- (Future) Running PureScript tests.
- (Future) Interacting with PureScript-specific APIs or services.

Cline will communicate with this server using the Model Context Protocol. The server will listen for tool execution requests, process them, and return results.

## 3. User Experience Goals
- **For Developers:**
    - Easy to set up and run the MCP server.
    - Simple to add new tools and extend its functionality.
    - Clear documentation on how to define and use tools.
- **For Cline (AI Assistant):**
    - Reliable and predictable tool execution.
    - Clear error messages when things go wrong.
    - Well-defined tool schemas for easy invocation.

## 4. Key Features
- **Extensibility:** Designed to easily add new tools for different PureScript-related tasks.
- **Testability:** Includes a mechanism or sample setup to test the server and its tools, potentially using a `purescript-test-examples` directory.
- **Standard Compliance:** Adheres to the Model Context Protocol for communication.
- **Node.js Based:** Leverages the Node.js ecosystem for development and potential integrations.
