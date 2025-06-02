const fetch = require('node-fetch');
const chalk = require('chalk'); // Assuming chalk@4.1.2 is installed
const path = require('path'); // For resolving project_path

const MCP_SERVER_URL = 'http://localhost:3000/mcp/tools';
const PURS_IDE_TEST_PORT = 4002; // Port for purs ide server during tests
const TEST_PROJECT_PATH = path.resolve(__dirname, './purescript-test-examples');

let testsPassed = 0;
let testsFailed = 0;

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postRequest(toolName, payload) {
    console.log(chalk.blue(`\n--- Testing MCP Tool: ${toolName} ---`));
    console.log(chalk.dim(`Request Payload: ${JSON.stringify(payload)}`));
    try {
        const response = await fetch(`${MCP_SERVER_URL}/${toolName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const responseBody = await response.json();
        console.log(chalk.dim(`Response Status: ${response.status}`));
        console.log(chalk.dim(`Response Body: ${JSON.stringify(responseBody).substring(0, 200)}...`));
        
        if (!response.ok && !responseBody.error && !responseBody.status ) { // Some tools might return non-200 but still have structured error/status
             // For purs ide start, it might return 500 if initial load fails, but that's a testable scenario
            if (toolName === 'start_purs_ide_server' && responseBody.message && responseBody.message.includes("initial load command failed")) {
                 // Allow this specific case for start_purs_ide_server if project not compiled
            } else {
                throw new Error(`HTTP error ${response.status} for ${toolName}`);
            }
        }
        return { status: response.status, body: responseBody };
    } catch (error) {
        console.error(chalk.red(`Error during ${toolName} test: ${error.message}`));
        return { error: error.message, body: null };
    }
}

function assert(condition, message, testName) {
    if (condition) {
        console.log(chalk.green(`[PASS] ${testName}: ${message}`));
        testsPassed++;
    } else {
        console.error(chalk.red(`[FAIL] ${testName}: ${message}`));
        testsFailed++;
    }
}

async function runTests() {
    console.log(chalk.cyan.bold("Starting MCP Server Automated Tests...\n"));

    // Test 1: echo
    const echoTest = await postRequest('echo', { message: 'Hello Test' });
    assert(echoTest.body && echoTest.body.echoed_message === 'Echo: Hello Test', 'Echo tool responds correctly.', 'Echo');

    // Test 2: query_purescript_ast
    const mainPursContent = `
module Main where
import Prelude
import Effect (Effect)
import Effect.Console (log)

main :: Effect Unit
main = do
  log "Hello from PureScript!"
  log "This is a sample file for the purescript-mcp-server."`;

    const astTestModuleName = await postRequest('query_purescript_ast', {
        purescript_code: mainPursContent,
        tree_sitter_query: "(purescript name: (qualified_module (module) @module.name))"
    });
    assert(astTestModuleName.body && astTestModuleName.body.results && astTestModuleName.body.results[0]?.text === 'Main', 'AST query for module name.', 'AST Query - Module Name');

    const astTestFuncName = await postRequest('query_purescript_ast', {
        purescript_code: mainPursContent,
        tree_sitter_query: "(function name: (variable) @func.name)"
    });
    assert(astTestFuncName.body && astTestFuncName.body.results && astTestFuncName.body.results[0]?.text === 'main', 'AST query for function name.', 'AST Query - Function Name');

    // Test 3: start_purs_ide_server
    // Note: This test assumes purescript-test-examples is compiled. 
    // If not, initial_load_result.resultType might be "error", which is acceptable for this test's scope.
    console.log(chalk.yellow(`\nINFO: For 'start_purs_ide_server' test, ensure '${TEST_PROJECT_PATH}' is compiled (run 'spago build' in it).`));
    const startIde = await postRequest('start_purs_ide_server', {
        project_path: TEST_PROJECT_PATH,
        port: PURS_IDE_TEST_PORT,
        log_level: "debug" // Use debug to get more output if needed
    });
    assert(startIde.body && startIde.body.status === 'success' && startIde.body.port === PURS_IDE_TEST_PORT, 'start_purs_ide_server reports success and correct port.', 'Start purs ide');
    if (startIde.body && startIde.body.initial_load_result) {
        console.log(chalk.blue(`Initial load result from purs ide: ${JSON.stringify(startIde.body.initial_load_result)}`));
        assert(startIde.body.initial_load_result.resultType === 'success', 'purs ide initial load successful.', 'Start purs ide - Initial Load');
    } else if (startIde.body && startIde.body.status === 'error' && startIde.body.message.includes("initial load command failed")) {
         console.warn(chalk.yellow("Warning: purs ide server started but initial load failed. This might be okay if project wasn't compiled. Check logs."));
    }


    // Only proceed with purs ide queries if server started and loaded (or at least attempted to load)
    let pursIdeReadyForQuery = startIde.body && (startIde.body.status === 'success' || (startIde.body.status === 'error' && startIde.body.message.includes("initial load command failed")));

    if (pursIdeReadyForQuery && startIde.body?.initial_load_result?.resultType !== 'success') {
        console.warn(chalk.yellow("Skipping some purs ide query tests as initial load was not fully successful. Compile the test project."));
    }
    
    if (pursIdeReadyForQuery && startIde.body?.initial_load_result?.resultType === 'success') {
        // Test 4.1: query_purs_ide - complete
        const completeTest = await postRequest('query_purs_ide', {
            purs_ide_command: "complete",
            purs_ide_params: { filters: [{"filter": "exact", "params": {"search": "log"}}], currentModule: "Main", options: {maxResults: 5} }
        });
        assert(completeTest.body && completeTest.body.status === 'success' && completeTest.body.result?.resultType === 'success' && completeTest.body.result.result.some(r => r.identifier === 'log' && r.module === 'Effect.Console'), 'query_purs_ide for "complete log".', 'Query purs ide - Complete');

        // Test 4.2: query_purs_ide - type
        const typeTest = await postRequest('query_purs_ide', {
            purs_ide_command: "type",
            purs_ide_params: { search: "main", currentModule: "Main" }
        });
        assert(typeTest.body && typeTest.body.status === 'success' && typeTest.body.result?.resultType === 'success' && typeTest.body.result.result.some(r => r.identifier === 'main' && r.type.includes('Effect Unit')), 'query_purs_ide for "type main".', 'Query purs ide - Type');
        
        // Test 4.3: query_purs_ide - usages
        const usagesTest = await postRequest('query_purs_ide', {
            purs_ide_command: "usages",
            purs_ide_params: { module: "Effect.Console", namespace: "value", identifier: "log" }
        });
        assert(usagesTest.body && usagesTest.body.status === 'success' && usagesTest.body.result?.resultType === 'success' && usagesTest.body.result.result.length >= 2, 'query_purs_ide for "usages log".', 'Query purs ide - Usages');

        // Test 5: generate_dependency_graph
        const depGraphTest = await postRequest('generate_dependency_graph', {
            target_modules: ["Main", "Utils", "Effect.Console"] // Broaden the scope for node discovery
        });
        assert(depGraphTest.body && depGraphTest.body.graph_nodes && depGraphTest.body.graph_nodes.some(n => n.id === "Main.main"), 'generate_dependency_graph for Main module.', 'Dependency Graph - Main Module Presence');
        
        const mainMainNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Main.main");
        assert(mainMainNode, 'Main.main node exists in graph.', 'Dependency Graph - Main.main Presence');
        if (mainMainNode) {
            // Main.main should use Utils.helperFunction and Utils.anotherUtil
            const usesHelper = mainMainNode.usedBy.some(u => u.from === "Utils.helperFunction"); // This is reversed: mainMainNode.uses -> Utils.helperFunction
                                                                                             // The current structure is target.usedBy -> source
                                                                                             // So we need to find Utils.helperFunction and check its usedBy
            const utilsHelperNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Utils.helperFunction");
            assert(utilsHelperNode && utilsHelperNode.usedBy.some(u => u.from === "Main.main" && u.usagesAt.length >= 1), 'Main.main uses Utils.helperFunction.', 'Dependency Graph - Main uses Utils.helperFunction');
            
            const utilsAnotherUtilNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Utils.anotherUtil");
            assert(utilsAnotherUtilNode && utilsAnotherUtilNode.usedBy.some(u => u.from === "Main.main" && u.usagesAt.length >= 1), 'Main.main uses Utils.anotherUtil.', 'Dependency Graph - Main uses Utils.anotherUtil');

            // Main.main should not be used by other functions in this project context (it's an entry point)
            // We need to filter out external library usages if any, or ensure its usedBy is empty for project sources
            const mainUsedByProjectInternal = mainMainNode.usedBy.filter(u => depGraphTest.body.graph_nodes.some(internalNode => internalNode.id === u.from));
            assert(mainUsedByProjectInternal.length === 0, 'Main.main is not used by other project functions.', 'Dependency Graph - Main.main Usages');
        }

        const utilsHelperNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Utils.helperFunction");
        assert(utilsHelperNode, 'Utils.helperFunction node exists in graph.', 'Dependency Graph - Utils.helperFunction Presence');
        if (utilsHelperNode) {
            // Utils.helperFunction should use Effect.Console.log
            const logNodeForHelper = depGraphTest.body?.graph_nodes?.find(n => n.id === "Effect.Console.log");
            assert(logNodeForHelper && logNodeForHelper.usedBy.some(u => u.from === "Utils.helperFunction" && u.usagesAt.length >= 1), 'Utils.helperFunction uses Effect.Console.log.', 'Dependency Graph - Utils.helper uses log');
        }

        const utilsAnotherUtilNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Utils.anotherUtil");
        assert(utilsAnotherUtilNode, 'Utils.anotherUtil node exists in graph.', 'Dependency Graph - Utils.anotherUtil Presence');
        if (utilsAnotherUtilNode) {
            // Utils.anotherUtil should use Utils.helperFunction
            const helperNodeForAnotherUtil = depGraphTest.body?.graph_nodes?.find(n => n.id === "Utils.helperFunction");
            assert(helperNodeForAnotherUtil && helperNodeForAnotherUtil.usedBy.some(u => u.from === "Utils.anotherUtil" && u.usagesAt.length >= 1), 'Utils.anotherUtil uses Utils.helperFunction.', 'Dependency Graph - Utils.anotherUtil uses helper');
        }
        
        // Effect.Console.log is used by Main.main (2 direct) and Utils.helperFunction (1 direct, which is called by Main.main and Utils.anotherUtil)
        // So, Main.main -> log (2), Main.main -> Utils.helperFunction -> log (1), Main.main -> Utils.anotherUtil -> Utils.helperFunction -> log (1)
        // The test should check that Effect.Console.log is marked as used by Main.main and Utils.helperFunction
        const logNode = depGraphTest.body?.graph_nodes?.find(n => n.id === "Effect.Console.log");
        assert(logNode, 'Effect.Console.log node exists in graph.', 'Dependency Graph - Log Presence');
        if (logNode) {
            const logUsedByMain = logNode.usedBy.find(u => u.from === "Main.main");
            assert(logUsedByMain && logUsedByMain.usagesAt.length >= 2, 'Effect.Console.log used by Main.main at least twice directly.', 'Dependency Graph - Log used by Main.main');
            
            const logUsedByHelper = logNode.usedBy.find(u => u.from === "Utils.helperFunction");
            assert(logUsedByHelper && logUsedByHelper.usagesAt.length >= 1, 'Effect.Console.log used by Utils.helperFunction at least once.', 'Dependency Graph - Log used by Utils.helper');
        }

    } else {
        console.warn(chalk.yellow("Skipping purs ide query and dependency graph tests as purs ide server did not start/load project successfully."));
        testsFailed += 7; // Mark these dependent tests as failed if server not ready (1 base + 6 new assertions)
    }

    // Test 6: stop_purs_ide_server
    const stopIde = await postRequest('stop_purs_ide_server', {});
    assert(stopIde.body && stopIde.body.status === 'success', 'stop_purs_ide_server reports success.', 'Stop purs ide');

    console.log(chalk.cyan.bold("\n--- Test Summary ---"));
    console.log(chalk.green(`Passed: ${testsPassed}`));
    console.log(chalk.red(`Failed: ${testsFailed}`));

    if (testsFailed > 0) {
        console.error(chalk.red.bold("\nSome tests failed."));
        process.exit(1);
    } else {
        console.log(chalk.green.bold("\nAll tests passed!"));
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error(chalk.redBright.bold("Unhandled error during test execution:"), err);
    process.exit(1);
});
