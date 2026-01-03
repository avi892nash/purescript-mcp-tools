# PureScript MCP Tools

[![npm version](https://badge.fury.io/js/purescript-mcp-tools.svg)](https://www.npmjs.com/package/purescript-mcp-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Model Context Protocol (MCP) server that provides PureScript development tools for AI assistants like Claude.

<a href="https://glama.ai/mcp/servers/@avi892nash/purescript-mcp-tools">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@avi892nash/purescript-mcp-tools/badge" alt="PureScript Server MCP server" />
</a>

## Features

- **Code Analysis**: Parse and analyze PureScript code structure without heavy IDE setup
- **PureScript IDE Integration**: Start and manage PureScript IDE servers
- **Type Information**: Look up types and find code usages
- **Dependency Graphs**: Generate visual representations of module dependencies
- **AI-First**: Built specifically for AI assistants using the Model Context Protocol

## Installation

### Via npm (Recommended)

```bash
npm install -g purescript-mcp-tools
```

### From Source

```bash
# Clone this repository
git clone https://github.com/avi892nash/purescript-mcp-tools.git
cd purescript-mcp-tools

# Install dependencies
npm install

# Test that it works
npm test
```

## Configuration

### For Claude Desktop

1. Find your Claude config file:
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

2. Add this server configuration:

**If installed via npm:**
```json
{
  "mcpServers": {
    "purescript-tools": {
      "command": "npx",
      "args": ["purescript-mcp-tools"]
    }
  }
}
```

**If installed from source:**
```json
{
  "mcpServers": {
    "purescript-tools": {
      "command": "node",
      "args": ["/FULL/PATH/TO/purescript-mcp-tools/index.js"]
    }
  }
}
```

3. Restart Claude Desktop.

### For Other MCP Clients

Configure as a stdio MCP server:
- **Command**: `npx` (or `node` if from source)
- **Arguments**: `["purescript-mcp-tools"]` (or `["/full/path/to/index.js"]` if from source)
- **Protocol**: stdio

## Usage

### Verify Installation

In your MCP client, try running:
```
get_server_status
```

You should see a response showing the server is running.

### Available Tools

This MCP server provides the following tools:

#### Static Analysis (No IDE Required)
- `getModuleName` - Extract module name from PureScript file
- `getImports` - List all imports from a module
- `getAllFunctionNames` - Get all function definitions
- `getExports` - List exported values
- `getFunctionSignature` - Get type signature for a function
- `getDependencyGraph` - Generate module dependency graph

#### PureScript IDE Integration
- `start_purs_ide_server` - Start a PureScript IDE server
- `stop_purs_ide_server` - Stop the IDE server
- `pursIdeLoad` - Load modules into IDE
- `pursIdeType` - Get type information
- `pursIdeComplete` - Get completion suggestions
- `pursIdeUsages` - Find where a symbol is used
- `pursIdeCaseSplit` - Generate case splits
- `pursIdeAddClause` - Add function clause
- `pursIdeImport` - Add imports

### Basic Workflow

1. **Check status**: `get_server_status`
2. **For simple analysis**: Use static analysis tools directly
3. **For advanced features**:
   - `start_purs_ide_server` with your project path
   - `pursIdeLoad` to load modules
   - Use `pursIdeType`, `pursIdeUsages`, etc.

## Requirements

- **Node.js** >= 14.0.0
- **PureScript compiler** (`purs`) - Required only if using IDE features
- **Your PureScript project** - With compiled output for IDE features

## Troubleshooting

**Server won't start**: Check that Node.js is installed and dependencies are installed (`npm install`)

**Tools not working**: Run `get_server_status` to see what's available

**Path errors**: Ensure you use absolute paths in your MCP configuration

**Multiple servers**: Only run one PureScript IDE server at a time to avoid port conflicts

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/avi892nash/purescript-mcp-tools/issues)
- **Discussions**: [GitHub Discussions](https://github.com/avi892nash/purescript-mcp-tools/discussions)

## Acknowledgments

This server implements the [Model Context Protocol](https://modelcontextprotocol.io/) and provides comprehensive PureScript development assistance to AI tools.