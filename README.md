# PureScript MCP Server

A Model Context Protocol (MCP) server that provides PureScript development tools for AI assistants like Claude.

<a href="https://glama.ai/mcp/servers/@avi892nash/purescript-mcp-tools">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@avi892nash/purescript-mcp-tools/badge" alt="PureScript Server MCP server" />
</a>

## Quick Install

### 1. Download and Setup
```bash
# Clone this repository
git clone <repository-url>
cd purescript-mcp-server

# Install dependencies
npm install

# Test that it works
node index.js
# Press Ctrl+C to stop
```

### 2. Configure Your MCP Client

#### For Claude Desktop
1. Find your Claude config file:
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

2. Add this server configuration:
```json
{
  "mcpServers": {
    "purescript-tools": {
      "command": "node",
      "args": ["/FULL/PATH/TO/purescript-mcp-server/index.js"]
    }
  }
}
```

3. **Important**: Replace `/FULL/PATH/TO/` with the actual absolute path to where you cloned this repository.

4. Restart Claude Desktop.

#### For Other MCP Clients
Configure as a stdio MCP server:
- **Command**: `node`
- **Arguments**: `["/full/path/to/index.js"]`
- **Protocol**: stdio

### 3. Verify Installation

In your MCP client, try running:
```
get_server_status
```

You should see a response showing the server is running.

## What This Server Provides

This MCP server gives AI assistants the ability to:

- **Analyze PureScript code** without heavy IDE setup
- **Start/manage PureScript IDE servers** for advanced features
- **Look up types and find code usages**
- **Generate dependency graphs**
- **Parse code structure** (modules, imports, functions)

## Basic Usage Flow

1. **Check status**: `get_server_status`
2. **For simple analysis**: Use `getModuleName`, `getImports`, etc. directly
3. **For advanced features**: 
   - `start_purs_ide_server` with your project path
   - `pursIdeLoad` to load modules
   - Use `pursIdeType`, `pursIdeUsages`, etc.

## Requirements

- **Node.js** (any recent version)
- **PureScript compiler** (`purs`) if using IDE features
- **Your PureScript project** with compiled output

## Troubleshooting

**Server won't start**: Check that Node.js is installed and you ran `npm install`

**Tools not working**: Run `get_server_status` first to see what's available

**Path errors**: Make sure you used the full absolute path in your MCP configuration

**Multiple servers**: Only run one PureScript IDE server at a time to avoid conflicts

## Support

This server provides comprehensive PureScript development assistance to AI tools through the standardized MCP protocol.