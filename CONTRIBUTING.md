# Contributing to PureScript MCP Tools

Thank you for your interest in contributing to PureScript MCP Tools! This document provides guidelines and instructions for contributing.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Environment details** (Node.js version, OS, etc.)
- **Code samples** or error messages if applicable

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Clear title and description**
- **Use case** - Why is this enhancement useful?
- **Proposed solution** if you have one
- **Alternatives considered**

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Make your changes**:
   - Follow the existing code style
   - Add tests if applicable
   - Update documentation as needed
3. **Test your changes**:
   ```bash
   npm test
   ```
4. **Commit your changes**:
   - Use clear, descriptive commit messages
   - Reference any related issues
5. **Push to your fork** and submit a pull request

#### Pull Request Guidelines

- Keep PRs focused on a single change
- Update the README.md if you change functionality
- Add tests for new features
- Ensure all tests pass
- Follow the existing code style
- Write clear commit messages

## Development Setup

1. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/purescript-mcp-tools.git
   cd purescript-mcp-tools
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Test your changes:
   ```bash
   npm test
   ```

4. Run the server locally:
   ```bash
   npm start
   ```

## Project Structure

```
purescript-mcp-tools/
├── index.js                      # Main MCP server implementation
├── run_tests.js                  # Test suite
├── tree-sitter-purescript.wasm   # PureScript parser
├── purescript-test-examples/     # Test PureScript projects
├── package.json                  # Package configuration
├── README.md                     # Documentation
└── LICENSE                       # MIT License
```

## Code Style

- Use consistent indentation (2 spaces)
- Follow existing naming conventions
- Add comments for complex logic
- Keep functions focused and small
- Use meaningful variable names

## Testing

- Add tests for new features
- Ensure existing tests pass
- Test with both static analysis and IDE features
- Test error handling

## Adding New Tools

When adding a new MCP tool:

1. Add the tool handler in `index.js`
2. Document the tool in README.md
3. Add tests in `run_tests.js`
4. Consider both error cases and edge cases

## Documentation

- Keep README.md up to date
- Document new tools and features
- Include examples where helpful
- Update troubleshooting section if needed

## Questions?

Feel free to:
- Open an issue for discussion
- Ask in pull request comments
- Start a GitHub Discussion

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
