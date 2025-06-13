## Active Context - 2025-06-13 (Final AST Tooling Refinements)

**Current Work Focus:**
- Code simplification and refinement.

**Recent Changes:**
- **`filePath` Resolution in `getCodeFromInput` (in `index.js`):**
    - Modified `getCodeFromInput` to resolve relative `filePath` arguments against `pursIdeProjectPath` (if set), or `process.cwd()` as a fallback. This improves path handling for tools reading files.
- **`getTopLevelDeclarations` Simplification (in `index.js`):**
    - Refactored the logic for determining declaration names to use a `Map` for capture lookups and a prioritized list of keys, reducing a long `if/else if` chain.
- **Previous (`getTopLevelDeclarations` Update):**
    - Removed post-processing logic (consolidation of signatures/values, filtering of class method signatures) from `index.js`. The tool now returns raw query results.
    - Corrected Tree-sitter query for `newtype` (was `newtype_declaration`).
    - Corrected Tree-sitter query for `type_role_declaration` and its name capture.
    - Corrected Tree-sitter query for `operator_declaration` (fixity) and its name capture.
- **Previous (`getWhereBindings` Refinement):**
    - Updated the Tree-sitter query in `index.js` to `(function (where) @where_keyword (declarations) @declarations_block)` to correctly identify and extract `where` clauses associated with functions.
- **Previous (Test Script Updates - `run_tests.js`):**
    - Adjusted `getTopLevelDeclarationsTestCode` to include `type role` and `infix` declarations.
    - Updated `expectedDeclCount` for `getTopLevelDeclarations` to 13 (reflecting no post-processing) and adjusted filtering assertions.
    - Updated assertion for `getWhereBindings` to expect an array containing the full `where ...` text.
- **Previous (Tool Consolidation - AST Querying):**
    - Removed `getTypeAliases`, `getInstances`, `getTypeClasses`, `getDataTypes`, `getTypeSignatures` (and earlier, `getDoBindings`, etc.) from all relevant files.
- **Previous (File Logging - 2025-06-12):**
    - Added file-based logging.

**Next Steps:**
- Update `memory-bank/systemPatterns.md` to reflect the `filePath` resolution change.
- Review and update `.clinerules` if necessary.
- Inform the user about the completed `filePath` resolution fix.
- Strongly suggest running tests to confirm this fix and other recent changes.
