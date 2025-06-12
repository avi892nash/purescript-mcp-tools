# PureScript Tools MCP 🟣

A Model Context Protocol (MCP) server designed to enhance PureScript development workflows. This tool provides comprehensive support for PureScript projects, including code analysis, dependency management, and development assistance.

## Features ✨

- **PureScript Code Analysis**: Parse and analyze PureScript code structures
- **Dependency Management**: Handle Spago and Bower dependencies
- **Project Scaffolding**: Generate PureScript project templates
- **Build Integration**: Interface with PureScript compiler and build tools
- **Development Assistance**: Provide contextual help and suggestions

## Prerequisites

- **System Requirements**:
  - Node.js (install from [nodejs.org](https://nodejs.org))
  - Git configured with SSH keys for Bitbucket access
  - SSH access to the Bitbucket repository

## Installation

1. **Create Project Directory**:
   ```bash
   mkdir -p ~/Documents/Claude/MCP
   cd ~/Documents/Claude/MCP
   ```

2. **Clone the Repository**:
   ```bash
   git clone ssh://git@ssh.bitbucket.juspay.net/~avinash.verma_juspay.in/purescript-tools-mcp.git
   cd purescript-tools-mcp
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

## Configuration

4. **Add to your MCP settings configuration** (typically located at `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "purescript-tools": {
      "command": "node",
      "args": [
        "/Users/your-username/Documents/Claude/MCP/purescript-tools-mcp/index.js"
      ],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

**Note**: Replace `/Users/your-username/Documents/Claude/MCP/purescript-tools-mcp/index.js` with the absolute path to the `index.js` file in your cloned repository.

## Starting the Server

1. **Manual Start**:
   ```bash
   cd ~/Documents/Claude/MCP/purescript-tools-mcp
   node index.js
   ```

2. **Verify Server**:
   The server should start without any errors. Keep this terminal window open while using the server.

## Troubleshooting

1. **Server Connection Issues**:
   - Ensure the server is running in a separate terminal
   - Verify the correct path is set in the `cwd` field of your configuration
   - Check that `index.js` exists in the project root directory

2. **SSH Access Issues**:
   - Verify your SSH keys are properly configured for Bitbucket
   - Test SSH connection: `ssh -T git@ssh.bitbucket.juspay.net`

3. **Configuration File Location**:
   - Make sure you're editing the global `/cline_mcp_settings.json` file
   - Do NOT create `cline_mcp_settings.json` in the project directory

## Development

```bash
# Install dependencies
npm install

# Start server
node index.js

# Start server with debug output
DEBUG=* node index.js
```

## Example Usage

Once configured and running, the PureScript Tools MCP will be available in your Cline environment, providing assistance with:

- Analyzing PureScript code structure
- Managing project dependencies
- Building and compiling PureScript projects
- Providing development guidance and best practices

## Verification

After updating the `/cline_mcp_settings.json` file and restarting your Cline environment, the PureScript Tools MCP should be available and ready to use.

## License

MIT

---

**Note**: This MCP server is specifically designed for PureScript development workflows and integrates with the Juspay development environment.
