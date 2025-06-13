## Progress - 2025-06-13

**What Works:**
- **`filePath` Resolution:** The `getCodeFromInput` helper in `index.js` now correctly resolves relative `filePath` arguments against the active `pursIdeProjectPath` (if set), falling back to `process.cwd()` with a warning if not. This enhances path resolution for tools like `getModuleName`, `getImports`, `getTopLevelDeclarationNames`, and `getTopLevelDeclarations`.
- The `run_tests.js` test suite has test cases covering the currently exposed tools by the `index.js` MCP server.
- Communication with the `index.js` server via JSON-RPC for tool invocation is established and tested.
- AST query tools (remaining ones) and `purs-ide-server` management tools have corresponding automated tests.
- The `pursIdeQuit` tool handler in `index.js` has been modified to prevent test hangs.
- Assertions for `stop_purs_ide_server` and `pursIdeList` (import) tests in `run_tests.js` have been corrected.
- The `pursIdeType` test with an "exact" filter in `run_tests.js` has been corrected.
- The `internalHandleGetServerStatus` function in `index.js` has been updated to return the expected response structure.
- The assertion for the `echo` test in `run_tests.js` has been made more robust by checking type and trimming whitespace.
- **File-based logging:** The server logs all `stderr` output to `purescript-mcp-server.log`.
- **Tool Reduction:** The following AST query tools have been removed from `index.js`, `run_tests.js`, and `mcp-config.json`:
    - `getDoBindings`
    - `getCasePatterns`
    - `getRecordFields`
    - `getVariableReferences`
    - `getIntegerLiterals`
    - `getLetBindings`
    - `getStringLiterals`
    - `getTypeAliases`
    - `getInstances`
    - `getTypeClasses`
    - `getDataTypes`
    - `getTypeSignatures`
- **`getWhereBindings` Refinement:** Updated Tree-sitter query in `index.js` to `(function (where) @where_keyword (declarations) @declarations_block)` for more accurate extraction of `where` clauses. Test in `run_tests.js` updated accordingly.
- **`getTopLevelDeclarations` Refinements & Simplification:**
    - **Simplified name extraction logic:** Refactored to use a `Map` for captures and a prioritized key list, making the code cleaner.
    - Removed post-processing logic (consolidation of signatures/values, filtering of class method signatures) from `index.js`. The tool now returns raw query results.
    - Corrected Tree-sitter queries for `newtype`, `type_role_declaration`, and `operator_declaration` (fixity) and their name captures.
    - Corresponding test cases and assertions in `run_tests.js` were updated (e.g., `expectedDeclCount` is now 13 for the test case).
- **Initial `getTopLevelDeclarations` Implementation (Previous):**
    - Added the tool, its basic handler, and initial tests.

**What's Left to Build / Refine:**
- The test for `pursIdeRebuild` is currently basic. It could be enhanced for more robust validation.
- Thorough testing of all tools, especially `getTopLevelDeclarations` after recent simplification and refinements.

**Current Status:**
- AST query tools have been significantly refined:
    - `getTopLevelDeclarations` now returns raw query results without post-processing, and its internal logic for name extraction has been simplified. Queries for `newtype`, roles, and operators are corrected.
    - `getWhereBindings` query has been improved.
- Several older, specific AST query tools remain removed.
- All relevant files (`index.js`, `run_tests.js`, `mcp-config.json`, Memory Bank) have been updated to reflect these latest changes.
- The project is ready for comprehensive testing.

**Known Issues:**
- The `pursIdeRebuild` test's simplicity is a point for future improvement.
