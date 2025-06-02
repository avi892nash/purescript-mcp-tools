# MCP Server Test Cases (using `purescript-test-examples`)

This document outlines test cases for the PureScript MCP server tools, primarily using the `purescript-test-examples` Spago project as a target.

**Prerequisites for all tests:**
1.  The MCP server is running: `npm start`
2.  `tree-sitter-purescript.wasm` is in the root of the MCP server project.
3.  The `purescript-test-examples` project has been compiled (`cd purescript-test-examples && spago build && cd ..`).

## 1. `echo` Tool

*   **Description:** Verifies basic MCP server responsiveness.
*   **Command:**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{"message": "Hello MCP"}' http://localhost:3000/mcp/tools/echo
    ```
*   **Expected Output:**
    ```json
    {"echoed_message":"Echo: Hello MCP"}
    ```

## 2. `query_purescript_ast` Tool

*   **Description:** Tests direct AST querying using Tree-sitter.
*   **Setup:** Get content of `purescript-test-examples/src/Main.purs`.
    ```purescript
    module Main where

    import Prelude
    import Effect (Effect)
    import Effect.Console (log)

    main :: Effect Unit
    main = do
      log "Hello from PureScript!"
      log "This is a sample file for the purescript-mcp-server."
    ```
*   **Test 2.1: Find module name**
    *   **Command:**
        ```bash
        curl -X POST -H "Content-Type: application/json" -d '{
          "purescript_code": "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Effect.Console (log)\n\nmain :: Effect Unit\nmain = do\n  log \"Hello from PureScript!\"\n  log \"This is a sample file for the purescript-mcp-server.\"",
          "tree_sitter_query": "(purescript name: (qualified_module (module) @module.name))"
        }' http://localhost:3000/mcp/tools/query_purescript_ast
        ```
    *   **Expected Output:**
        ```json
        {"results":[{"name":"module.name","text":"Main"}]}
        ```
*   **Test 2.2: Find function names**
    *   **Command:**
        ```bash
        curl -X POST -H "Content-Type: application/json" -d '{
          "purescript_code": "module Main where\n\nimport Prelude\nimport Effect (Effect)\nimport Effect.Console (log)\n\nmain :: Effect Unit\nmain = do\n  log \"Hello from PureScript!\"\n  log \"This is a sample file for the purescript-mcp-server.\"",
          "tree_sitter_query": "(function name: (variable) @func.name)"
        }' http://localhost:3000/mcp/tools/query_purescript_ast
        ```
    *   **Expected Output:**
        ```json
        {"results":[{"name":"func.name","text":"main"}]}
        ```

## 3. `start_purs_ide_server` Tool

*   **Description:** Tests starting the `purs ide server` against the `purescript-test-examples` project.
*   **Command:**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{
      "project_path": "./purescript-test-examples", 
      "port": 4002, 
      "log_level": "debug"
    }' http://localhost:3000/mcp/tools/start_purs_ide_server
    ```
*   **Expected Output Characteristics:**
    *   `status`: `"success"`
    *   `message`: Contains "purs ide server started and initial load attempted."
    *   `port`: `4002`
    *   `project_path`: Absolute path to `purescript-test-examples`.
    *   `initial_load_result.resultType`: `"success"`
    *   `initial_load_result.result`: Contains something like "Loaded X modules..." (X should be small, e.g., 3 for Main, Prelude, Effect.Console if those are the only direct ones).
    *   MCP server logs should show `purs ide server` stdout/stderr, including successful load messages.

## 4. `query_purs_ide` Tool (depends on successful `start_purs_ide_server`)

*   **Description:** Tests sending various commands to the `purs ide server` started in step 3.
*   **Test 4.1: `complete` for `log`**
    *   **Command:**
        ```bash
        curl -X POST -H "Content-Type: application/json" -d '{
          "purs_ide_command": "complete",
          "purs_ide_params": { 
            "filters": [{"filter": "exact", "params": {"search": "log"}}], 
            "currentModule": "Main",
            "options": {"maxResults": 5}
          }
        }' http://localhost:3000/mcp/tools/query_purs_ide
        ```
    *   **Expected Output Characteristics:**
        *   `status`: `"success"`
        *   `result.resultType`: `"success"`
        *   `result.result`: An array containing a completion item for `log` from `Effect.Console`.
*   **Test 4.2: `type` for `main`**
    *   **Command:**
        ```bash
        curl -X POST -H "Content-Type: application/json" -d '{
          "purs_ide_command": "type",
          "purs_ide_params": { "search": "main", "currentModule": "Main" }
        }' http://localhost:3000/mcp/tools/query_purs_ide
        ```
    *   **Expected Output Characteristics:**
        *   `status`: `"success"`
        *   `result.resultType`: `"success"`
        *   `result.result`: An array containing type information for `Main.main` (e.g., `Effect Unit`).
*   **Test 4.3: `usages` for `log` in `Main.purs`**
    *   **Command:**
        ```bash
        curl -X POST -H "Content-Type: application/json" -d '{
          "purs_ide_command": "usages",
          "purs_ide_params": { 
            "module": "Effect.Console", 
            "namespace": "value", 
            "identifier": "log" 
          }
        }' http://localhost:3000/mcp/tools/query_purs_ide
        ```
    *   **Expected Output Characteristics:**
        *   `status`: `"success"`
        *   `result.resultType`: `"success"`
        *   `result.result`: An array containing at least two usage locations within `purescript-test-examples/src/Main.purs`.

## 5. `generate_dependency_graph` Tool (depends on successful `start_purs_ide_server`)

*   **Description:** Tests generating a dependency graph for the `Main` module in `purescript-test-examples`.
*   **Command:**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{
      "target_modules": ["Main"]
    }' http://localhost:3000/mcp/tools/generate_dependency_graph
    ```
*   **Expected Output Characteristics:**
    *   `graph_nodes`: An array.
    *   One node should be for `Main.main`.
    *   The `Main.main` node's `usedBy` array should be empty (as nothing in `Main` calls `main`).
    *   Other nodes might exist for `Prelude`, `Effect`, `Effect.Console` if they are picked up by the `complete` command for module `Main`.
    *   If `Effect.Console.log` is a node, its `usedBy` should list `Main.main` with two usage locations.

## 6. `stop_purs_ide_server` Tool

*   **Description:** Tests stopping the `purs ide server`.
*   **Command:**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3000/mcp/tools/stop_purs_ide_server
    ```
*   **Expected Output:**
    ```json
    {"status":"success","message":"purs ide server stopped."}
    ```
*   **Verification:** MCP server logs should indicate the process was stopped. Subsequent `query_purs_ide` calls should fail.
