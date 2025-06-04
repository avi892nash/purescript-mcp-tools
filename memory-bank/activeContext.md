# Active Context: PureScript MCP Server - Refactored to Standard MCP Stdio Protocol

## 1. Current Work Focus
Implementation of a new suite of granular PureScript AST (Abstract Syntax Tree) query tools within the MCP server (`index.js`). This involves replacing the generic `query_purescript_ast` tool with specific, user-friendly tools based on predefined Tree-sitter queries. Phase 1 of this implementation is complete.

## 2. Recent Changes
- **Granular AST Query Tools (Phase 1 Implementation):**
    - **`index.js`:**
        - Added new tool definitions and handlers for the following AST query tools:
            - `getModuleName(input: { filePath?: string; code?: string })`
            - `getImports(input: { filePath?: string; code?: string })`
            - `getFunctionNames(input: { code: string })`
            - `getTypeSignatures(input: { code: string })`
            - `getLetBindings(input: { code: string })`
            - `getDataTypes(input: { code: string })`
            - `getTypeClasses(input: { code: string })`
            - `getInstances(input: { code: string })`
            - `getTypeAliases(input: { code: string })`
            - `getStringLiterals(input: { code: string })`
            - `getIntegerLiterals(input: { code: string })`
            - `getVariableReferences(input: { code: string })`
            - `getRecordFields(input: { code: string })`
            - `getCasePatterns(input: { code: string })`
            - `getDoBindings(input: { code: string })`
            - `getWhereBindings(input: { code: string })`
        - Refactored `getDataTypes` to use a hybrid Tree-sitter query approach:
            - An outer query `(data_declaration) @dd` identifies all data type declarations.
            - For each declaration, `childForFieldName` is used to get the data type's name node and the group of constructors.
            - A specific inner query `[(constructor) @constructor.name (constructor_declaration name: (constructor) @constructor.name)]` is then run on the constructor group node to extract individual constructor names.
        - Simplified `getTypeAliases` to use the query `(type_alias) @alias_declaration` and return an array of the full text of each matched type alias declaration. Comments in queries were also removed.
        - Simplified `getCasePatterns` to use query `(alt pat: (_) @pattern_node)` and return an array of raw pattern texts.
        - Simplified `getWhereBindings` to use query `(where (declarations (function name: (variable) @binding_name)))` and return an array of raw binding names.
        - Implemented a helper function `getCodeFromInput(args, isModuleOriented)` to manage fetching code from either a file path or a direct string input, based on the tool's nature.
        - Marked the old `query_purescript_ast` tool as deprecated in `TOOL_DEFINITIONS`.
    - **Memory Bank Update:**
        - `systemPatterns.md`: Updated to reflect the new granular AST querying tools and deprecation of the generic one. List of new tools added.
    - **`run_tests.js` Update:**
        - The test case for `getTypeAliases` was updated to expect an array of raw text strings.
        - Removed a problematic comment from the `typeAliasesCode` test string.
        - Updated tests for `getCasePatterns` and `getWhereBindings` to expect arrays of raw text strings.

- **Previously - Stdio Protocol Alignment (JSON-RPC 2.0):**
    - **`index.js`:**
        - Implemented JSON-RPC 2.0 message structures.
        - Added handlers for `initialize`, `tools/list`, `tools/call`.
        - Adapted old tool handlers to the new structure.
        - Removed `get_manifest`.
    - **Memory Bank & `mcp-config.json` updates for JSON-RPC 2.0.**

- **Further Back - Initial Architectural Refactor to Stdio (Custom Protocol).**

## 3. Next Steps
- **Verify Fixes:** Run the updated `run_tests.js` to confirm the fixes for AST tools.
- **Review `package.json`:** Remove unused dependencies (e.g., `express`, `node-fetch`).
- **Proceed to Phase 2 & 3 of AST API:** Implement utility, advanced, and batch operation AST tools as per the refined plan.
- **Commit and Push Changes:** Once testing and documentation for Phase 1 fixes are satisfactory.

## 4. Active Decisions and Considerations
- **Phased API Implementation:** The new AST Query API is being implemented in phases due to its comprehensiveness. Phase 1 (core query functions) is now complete.
- **Differentiated Input for AST Tools:**
    - "Module-Oriented" tools (e.g., `getModuleName`, `getImports`) accept `filePath` or `code`.
    - "Snippet-Oriented" tools (e.g., `getFunctionNames`, `getStringLiterals`) accept `code` directly.
- **Error Handling:** File reading errors for `filePath` inputs and invalid argument combinations are handled.
- **Tool Deprecation:** `query_purescript_ast` is deprecated in favor of the new specific tools.
- **Return Structures:** The new tools aim to return data in the user-defined TypeScript-like interface structures.
- **Testing:** `run_tests.js` now uses JSON-RPC 2.0 and includes tests for all Phase 1 AST tools.
- **Documentation:** `INSTALL.md` and `.clinerules` have been updated to reflect the current state.
