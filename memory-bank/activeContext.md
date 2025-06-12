# Active Context: PureScript MCP Server - Refactored to Standard MCP Stdio Protocol

## 1. Current Work Focus
Refining the set of `purs ide` command wrappers in `index.js` to focus on tools that primarily aid an AI in gathering context and understanding a PureScript codebase, rather than direct code generation assistance.

## 2. Recent Changes
- **Documentation Update:**
    - `INSTALL.md`: File removed.
    - `README.md`: Created with comprehensive project information, installation, configuration, and usage instructions.
    - `mcp-config.json`: Updated to reflect the current toolset in `index.js`.
- **Refined `purs ide` Command Wrappers in `index.js`:**
    - Removed tools primarily for code generation: `pursIdeImport`, `pursIdeCaseSplit`, `pursIdeAddClause`.
    - Removed `pursIdeComplete` as per user feedback.
    - Kept tools focused on context gathering and server interaction:
        - `pursIdeLoad`
        - `pursIdeType`
        - `pursIdeRebuild`
        - `pursIdeUsages`
        - `pursIdeList`
        - `pursIdeCwd`
        - `pursIdeReset`
        - `pursIdeQuit`
- **Memory Bank Update:**
    - `systemPatterns.md`: Updated to reflect the refined list of `purs ide` command wrapper tools.

- **Previously - Granular AST Query Tools (Phase 1 Implementation):**
    - **`index.js`:**
        - Added new tool definitions and handlers for various AST query tools (e.g., `getModuleName`, `getImports`, `getFunctionNames`, etc.).
        - Marked the old `query_purescript_ast` tool as deprecated.
    - **Memory Bank & `run_tests.js` updates for AST tools.**

- **Further Back - Stdio Protocol Alignment (JSON-RPC 2.0) & Initial Architectural Refactor.**

## 3. Next Steps
- **Verify New `purs ide` Wrappers:** Thoroughly test the newly added `pursIde*` tools. This might involve updating `run_tests.js` or performing manual tool calls.
- **Review `package.json`:** Remove unused dependencies (e.g., `express`, `node-fetch`).
- **Update `progress.md`:** Reflect the addition of the new `purs ide` wrapper tools.
- **Commit and Push Changes:** Once testing and documentation for the new `pursIde*` tools are satisfactory.
- **Consider Deprecating `query_purs_ide`:** Now that specific wrappers exist, evaluate if the generic `query_purs_ide` tool is still needed or if it should be deprecated for better type safety and usability.

## 4. Active Decisions and Considerations
- **Comprehensive `purs ide` Coverage:** The goal is to provide easy-to-use MCP tools for most, if not all, common `purs ide` server commands.
- **Input Schemas:** The new `pursIde*` tools have specific input schemas mirroring the `purs ide` command parameters for clarity and ease of use.
- **Error Handling:** Basic error handling (e.g., server not running) is in place. More specific error propagation from `purs ide` responses should be ensured.
- **Testing:** Crucial to test each new wrapper, especially `pursIdeImport` due to its subcommand structure.
- **Documentation:** `README.md` is now the primary source for installation and usage. `.clinerules` should be reviewed and updated if necessary. `INSTALL.md` has been removed.
