const { spawn } = require('child_process');
const readline = require('readline');
const chalk = require('chalk'); // Assuming chalk@4.1.2 is installed
const path = require('path');

const TEST_PROJECT_PATH = path.resolve(__dirname, './purescript-test-examples');
const PURS_IDE_TEST_PORT = 4002; // Port for purs ide server during tests

let mcpServerProcess;
let mcpRl;
let pendingRequests = new Map();
let nextRequestId = 1;
let serverInitialized = false;

let testsPassed = 0;
let testsFailed = 0;

function logTest(message, level = 'info') {
    const timestamp = new Date().toISOString();
    let coloredMessage = message;
    switch (level) {
        case 'error': coloredMessage = chalk.redBright(`[${timestamp}] [TEST-ERROR] ${message}`); break;
        case 'warn': coloredMessage = chalk.yellowBright(`[${timestamp}] [TEST-WARN] ${message}`); break;
        case 'info': coloredMessage = chalk.blueBright(`[${timestamp}] [TEST-INFO] ${message}`); break;
        case 'debug': coloredMessage = chalk.gray(`[${timestamp}] [TEST-DEBUG] ${message}`); break;
        default: coloredMessage = `[${timestamp}] [TEST] ${message}`;
    }
    console.log(coloredMessage);
}

function startMcpServer() {
    return new Promise((resolve, reject) => {
        logTest('Starting MCP server process (node index.js)...', 'info');
        mcpServerProcess = spawn('node', ['index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });

        mcpServerProcess.stderr.on('data', (data) => {
            logTest(`MCP Server STDERR: ${data.toString().trim()}`, 'warn');
        });

        mcpRl = readline.createInterface({ input: mcpServerProcess.stdout });

        mcpRl.on('line', (line) => {
            logTest(`MCP Server STDOUT: ${line.substring(0, 300)}${line.length > 300 ? '...' : ''}`, 'debug');
            try {
                const response = JSON.parse(line);
                if (response.id && pendingRequests.has(response.id)) {
                    const { resolve: reqResolve, reject: reqReject } = pendingRequests.get(response.id);
                    pendingRequests.delete(response.id);
                    if (response.error) {
                        logTest(`MCP Error for ID ${response.id}: ${JSON.stringify(response.error)}`, 'error');
                        reqReject(new Error(`MCP Error ${response.error.code}: ${response.error.message}${response.error.data ? ` - ${JSON.stringify(response.error.data)}` : ''}`));
                    } else {
                        reqResolve(response.result);
                    }
                } else {
                    logTest(`Received response for unknown or already handled ID: ${response.id}`, 'warn');
                }
            } catch (e) {
                logTest(`Failed to parse JSON response from server: ${line} - ${e.message}`, 'error');
            }
        });

        mcpServerProcess.on('exit', (code) => {
            logTest(`MCP server process exited with code ${code}`, code === 0 ? 'info' : 'error');
            mcpServerProcess = null;
            pendingRequests.forEach(({ reject: reqReject }) => reqReject(new Error('MCP server exited prematurely.')));
            pendingRequests.clear();
        });
        
        mcpServerProcess.on('error', (err) => {
             logTest(`Failed to start MCP server process: ${err.message}`, 'error');
             reject(err);
        });

        // Give the server a moment to start, then resolve
        setTimeout(() => {
            logTest('MCP server process spawned.', 'info');
            resolve();
        }, 1000); // Wait for server to be ready to accept initialize
    });
}

async function initializeMcpServer() {
    if (!mcpServerProcess) throw new Error("MCP Server not started.");
    if (serverInitialized) return;

    logTest('Sending "initialize" request to MCP server...', 'info');
    const initResponse = await callMcpToolRaw({
        jsonrpc: '2.0',
        id: nextRequestId++,
        method: 'initialize',
        params: {
            processId: process.pid,
            clientInfo: { name: 'run_tests.js', version: '1.0.0' },
            capabilities: {}
        }
    });
    assert(initResponse && initResponse.protocolVersion, 'Server responded to initialize.', 'MCP Initialize');
    if (initResponse && initResponse.protocolVersion) {
        serverInitialized = true;
        logTest('MCP Server initialized successfully.', 'info');
        // Send 'initialized' notification (no response expected)
        sendMcpNotification({
            jsonrpc: '2.0',
            method: 'initialized',
            params: {}
        });
    } else {
        throw new Error('MCP Server initialization failed.');
    }
}

function sendMcpNotification(requestPayload) {
    if (!mcpServerProcess || !mcpServerProcess.stdin.writable) {
        logTest('MCP server stdin not writable for notification.', 'error');
        return;
    }
    const message = JSON.stringify(requestPayload);
    logTest(`Sending MCP Notification: ${message.substring(0,200)}...`, 'debug');
    mcpServerProcess.stdin.write(message + '\n');
}


function callMcpToolRaw(requestPayload) { // For initialize, etc.
    return new Promise((resolve, reject) => {
        if (!mcpServerProcess || !mcpServerProcess.stdin.writable) {
            return reject(new Error('MCP server not running or stdin not writable.'));
        }
        pendingRequests.set(requestPayload.id, { resolve, reject });
        const message = JSON.stringify(requestPayload);
        logTest(`Sending MCP Request (ID ${requestPayload.id}): ${message.substring(0,300)}${message.length > 300 ? '...' : ''}`, 'debug');
        mcpServerProcess.stdin.write(message + '\n');
    });
}

async function callMcpTool(toolName, toolArgs = {}) {
    if (!serverInitialized) {
        throw new Error("MCP Server not initialized. Call initializeMcpServer first.");
    }
    console.log(chalk.blue(`\n--- Testing MCP Tool: ${toolName} ---`));
    console.log(chalk.dim(`Arguments: ${JSON.stringify(toolArgs)}`));
    
    const requestId = nextRequestId++;
    const payload = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
            name: toolName,
            arguments: toolArgs
        }
    };
    try {
        const result = await callMcpToolRaw(payload);
        // The 'result' from tools/call is an object like { content: [{ type: "text", text: "..." }] }
        // We need to parse the 'text' field if it's JSON.
        if (result && result.content && Array.isArray(result.content) && result.content.length > 0 && result.content[0].type === 'text') {
            const textContent = result.content[0].text;
            try {
                const parsedText = JSON.parse(textContent);
                console.log(chalk.dim(`Parsed Tool Response: ${JSON.stringify(parsedText).substring(0, 200)}...`));
                return parsedText; // Return the parsed content of the "text" field
            } catch (e) {
                console.log(chalk.dim(`Tool Response (not JSON): ${textContent.substring(0, 200)}...`));
                return textContent; // Return as string if not JSON
            }
        }
        console.log(chalk.dim(`Raw Tool Response: ${JSON.stringify(result).substring(0, 200)}...`));
        return result; // Fallback to returning the whole result object
    } catch (error) {
        console.error(chalk.red(`Error during ${toolName} test: ${error.message}`));
        return { error: error.message }; // Ensure errors are returned as objects
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

function assertDeepEqual(actual, expected, message, testName) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson === expectedJson) {
        assert(true, message, testName);
    } else {
        assert(false, `${message} - Expected: ${expectedJson}, Got: ${actualJson}`, testName);
    }
}


async function runAstToolTests() {
    logTest("--- Running AST Tool Tests ---", "info");

    const moduleCode = `
module Test.MyModule where
import Prelude
main = pure unit
`;
    const functionsCode = `
module Test.MyModule where
import Prelude
myFunction :: Int -> Int
myFunction x = x + 1
anotherFunction :: String -> String
anotherFunction s = s <> "!"
main = pure unit
`;
    const typeSigsCode = `
module Test.MyModule where
import Prelude
myFunction :: Int -> Int
myFunction x = x + 1
anotherFunction :: String -> String
anotherFunction s = s <> "!"
main :: Effect Unit
main = pure unit
`;
    const letBindingsCode = `
module Test.MyModule where
import Prelude
myFunction :: Int -> Int
myFunction x = 
  let y = x + 1
      z = y * 2
  in z
main = pure unit
`;
    const dataTypesCode = `
module Test.MyModule where
import Prelude
data MyType = MyConstructor Int | AnotherConstructor String
data AnotherType a = GenericConstructor a
main = pure unit
`;
    const typeClassesCode = `
module Test.MyModule where
import Prelude
class MyShow a where
  myShow :: a -> String
class (MyOrd a) <= MyEq a where
  myEq :: a -> a -> Boolean
main = pure unit
`;
    const instancesCode = `
module Test.MyModule where
import Prelude
class MyShow a where
  myShow :: a -> String
instance myShowInt :: MyShow Int where
  myShow _ = "Int"
instance MyShow String where -- Anonymous instance
  myShow s = s
main = pure unit
`;
    const typeAliasesCode = `
module Test.MyModule where
import Prelude
import Data.Map (Map)

type MyString = String
type MyRecord = { foo :: Int, bar :: String }
type MyMap k v = Map k v
type MyParameterizedRecord a = { value :: a, label :: String }

main = pure unit
`;
    const stringLiteralsCode = `
module Test.MyModule where
import Prelude
myString = "hello"
anotherString = "world"
main = pure unit
`;
    const integerLiteralsCode = `
module Test.MyModule where
import Prelude
myInt = 123
anotherInt = 456
main = pure unit
`;
    const varRefsCode = `
module Test.MyModule where
import Prelude
foo = 1
bar = foo + 2
baz = bar * foo
main = pure unit
`;
    const recordFieldsCode = `
module Test.MyModule where
import Prelude
myRecord = { label: "test", value: 1 }
accessor r = r.label
main = pure unit
`;
    const casePatternsCode = `
module Test.MyModule where
import Prelude
data MyType = Con1 Int | Con2 String
myFunction :: MyType -> String
myFunction x = case x of
                 Con1 i -> "Number: " <> show i
                 Con2 s -> "String: " <> s
                 _      -> "Other"
main = pure unit
`;
    const doBindingsCode = `
module Test.MyModule where
import Prelude
import Effect (Effect)
import Effect.Console (log)
main :: Effect Unit
main = do
  let x = 1
  y <- pure 2
  log "hello"
  let z = x + y
  pure unit
`;
    const whereBindingsCode = `
module Test.MyModule where
import Prelude
myFunction :: Int -> Int
myFunction x = result
  where 
    intermediate = x + 1
    result = intermediate * 2
main = pure unit
`;

    const topLevelDeclarationsCode = `
module Test.TopLevel where
import Prelude
import Effect (Effect)

foreign import data MyForeignData :: Type

foreign import myForeignFunction :: Int -> Effect String

data MyData = Constructor1 | Constructor2 Int

type MyTypeAlias = String

class MyClass a where
  classMethod :: a -> Boolean

instance myClassInt :: MyClass Int where
  classMethod _ = true

myFunction :: Int -> String
myFunction _ = "hello"

anotherFunction :: Effect Unit
anotherFunction = pure unit
`;

    // 1. getModuleName
    let testResult = await callMcpTool('getModuleName', { code: moduleCode });
    assertDeepEqual(testResult, "Test.MyModule", 'getModuleName returns full module name.', 'AST - getModuleName');

    // 2. getImports
    testResult = await callMcpTool('getImports', { code: moduleCode });
    assertDeepEqual(testResult, [{ module: "Prelude", fullPath: "Prelude" }], 'getImports finds Prelude.', 'AST - getImports');

    // Test getTopLevelDeclarationNames
    testResult = await callMcpTool('getTopLevelDeclarationNames', { code: topLevelDeclarationsCode });
    const expectedTopLevelNames = [
        "MyForeignData",       // from: foreign import data MyForeignData :: Type (kind_value_declaration)
        "myForeignFunction",   // from: foreign import myForeignFunction :: Int -> Effect String
        "MyData",              // from: data MyData = ...
        "MyTypeAlias",         // from: type MyTypeAlias = String
        "MyClass",             // from: class MyClass a where ...
        "classMethod",         // from: classMethod :: a -> Boolean (signature within class)
        "myClassInt",          // from: instance myClassInt :: MyClass Int where ...
        "myFunction",          // from: myFunction :: Int -> String
        "anotherFunction"      // from: anotherFunction :: Effect Unit
    ].sort();
    // Ensure the result contains all expected names and no extras, order-independent
    if (testResult && Array.isArray(testResult)) {
        assert(testResult.sort().join(',') === expectedTopLevelNames.join(','), 
               `getTopLevelDeclarationNames returns correct names. Expected: ${expectedTopLevelNames.join(', ')}, Got: ${testResult.sort().join(', ')}`, 
               'AST - getTopLevelDeclarationNames');
    } else {
        assert(false, 
               `getTopLevelDeclarationNames failed or returned unexpected type. Expected array, Got: ${JSON.stringify(testResult)}`, 
               'AST - getTopLevelDeclarationNames');
    }
    
    // 3. getFunctionNames
    testResult = await callMcpTool('getFunctionNames', { code: functionsCode });
    assertDeepEqual(testResult, ["myFunction", "anotherFunction", "main"], 'getFunctionNames finds all functions.', 'AST - getFunctionNames');

    // 4. getTypeSignatures
    testResult = await callMcpTool('getTypeSignatures', { code: typeSigsCode });
    const expectedSignatures = [
        "myFunction :: Int -> Int",
        "anotherFunction :: String -> String",
        "main :: Effect Unit"
    ];
    assertDeepEqual(testResult && testResult.sort(), expectedSignatures.sort(), 'getTypeSignatures finds signatures.', 'AST - getTypeSignatures');

    // 5. getLetBindings
    testResult = await callMcpTool('getLetBindings', { code: letBindingsCode });
    // Expected: [ { name: 'y', context: 'let' }, { name: 'z', context: 'let' } ] (order might vary)
    assert(testResult && testResult.length === 2 && testResult.some(b => b.name === 'y' && b.context === 'let') && testResult.some(b => b.name === 'z' && b.context === 'let'), 'getLetBindings finds let-bound variables.', 'AST - getLetBindings');

    // 6. getDataTypes
    testResult = await callMcpTool('getDataTypes', { code: dataTypesCode });
    // Expected: [ { name: 'MyType', constructors: [ 'MyConstructor', 'AnotherConstructor' ] }, { name: 'AnotherType', constructors: [ 'GenericConstructor' ] } ] (order might vary)
    assert(testResult && testResult.length === 2 && testResult.some(dt => dt.name === 'MyType' && dt.constructors.includes('MyConstructor')) && testResult.some(dt => dt.name === 'AnotherType' && dt.constructors.includes('GenericConstructor')), 'getDataTypes finds data types and constructors.', 'AST - getDataTypes');
    
    // 7. getTypeClasses
    testResult = await callMcpTool('getTypeClasses', { code: typeClassesCode });
    // Expected: [ { name: 'MyShow', typeParameter: 'a' }, { name: 'MyEq', typeParameter: 'a' } ] (MyOrd constraint not captured by this tool)
    assert(testResult && testResult.length === 2 && testResult.some(tc => tc.name === 'MyShow' && tc.typeParameter === 'a') && testResult.some(tc => tc.name === 'MyEq' && tc.typeParameter === 'a'), 'getTypeClasses finds type classes.', 'AST - getTypeClasses');

    // 8. getInstances
    testResult = await callMcpTool('getInstances', { code: instancesCode });
    // Expected: [ { name: 'myShowInt', className: 'MyShow', type: 'Int' }, { name: undefined, className: 'MyShow', type: 'String' } ]
    assert(testResult && testResult.length === 2 && testResult.some(i => i.name === 'myShowInt' && i.className === 'MyShow' && i.type === 'Int') && testResult.some(i => i.name === undefined && i.className === 'MyShow' && i.type === 'String'), 'getInstances finds instances.', 'AST - getInstances');

    // 9. getTypeAliases
    testResult = await callMcpTool('getTypeAliases', { code: typeAliasesCode });
    const expectedTypeAliasesOutput = [
        "type MyString = String",
        "type MyRecord = { foo :: Int, bar :: String }",
        "type MyMap k v = Map k v",
        "type MyParameterizedRecord a = { value :: a, label :: String }"
    ];
    // The order of results from the tool should match the order in the source code.
    assertDeepEqual(testResult, expectedTypeAliasesOutput, 'getTypeAliases returns raw text of alias declarations.', 'AST - getTypeAliases');

    // 10. getStringLiterals
    testResult = await callMcpTool('getStringLiterals', { code: stringLiteralsCode });
    assertDeepEqual(testResult.sort(), ["hello", "world"].sort(), 'getStringLiterals finds string literals.', 'AST - getStringLiterals');

    // 11. getIntegerLiterals
    testResult = await callMcpTool('getIntegerLiterals', { code: integerLiteralsCode });
    assertDeepEqual(testResult.sort(), [123, 456].sort(), 'getIntegerLiterals finds integer literals.', 'AST - getIntegerLiterals');

    // 12. getVariableReferences
    testResult = await callMcpTool('getVariableReferences', { code: varRefsCode });
    // Expected: ["foo", "bar", "pure", "unit"] (order may vary, duplicates removed by server)
    assertDeepEqual(testResult.sort(), ["foo", "bar", "pure", "unit"].sort(), 'getVariableReferences finds variable references.', 'AST - getVariableReferences');

    // 13. getRecordFields
    testResult = await callMcpTool('getRecordFields', { code: recordFieldsCode });
    // Expected: [ { name: 'label', context: 'literal' }, { name: 'value', context: 'literal' } ]
    assert(testResult && testResult.length === 2 && testResult.some(f => f.name === 'label' && f.context === 'literal') && testResult.some(f => f.name === 'value' && f.context === 'literal'), 'getRecordFields finds literal fields.', 'AST - getRecordFields');

    // 14. getCasePatterns
    testResult = await callMcpTool('getCasePatterns', { code: casePatternsCode });
    const expectedCasePatterns = ["Con1 i", "Con2 s", "_"];
    assertDeepEqual(testResult && testResult.sort(), expectedCasePatterns.sort(), 'getCasePatterns returns raw text of case patterns.', 'AST - getCasePatterns');

    // 15. getDoBindings
    testResult = await callMcpTool('getDoBindings', { code: doBindingsCode });
    // Expected: [ { variable: 'y', bindingType: 'bind' }, { variable: 'x', bindingType: 'let' }, { variable: 'z', bindingType: 'let' } ] (order may vary)
    assert(testResult && testResult.length === 3 && testResult.some(b => b.variable === 'y' && b.bindingType === 'bind') && testResult.some(b => b.variable === 'x' && b.bindingType === 'let') && testResult.some(b => b.variable === 'z' && b.bindingType === 'let'), 'getDoBindings finds do bindings.', 'AST - getDoBindings');

    // 16. getWhereBindings
    testResult = await callMcpTool('getWhereBindings', { code: whereBindingsCode });
    const expectedWhereBindings = ["intermediate", "result"];
    assertDeepEqual(testResult && testResult.sort(), expectedWhereBindings.sort(), 'getWhereBindings returns raw text of where-bound function names.', 'AST - getWhereBindings');

    // Test deprecated query_purescript_ast
    const mainPursContentForOldTest = `module Main where main = pure unit`;
    const astTestModuleNameOld = await callMcpTool('query_purescript_ast', {
        purescript_code: mainPursContentForOldTest,
        tree_sitter_query: "(purescript name: (qualified_module (module) @module.name))"
    });
    assert(astTestModuleNameOld.results && astTestModuleNameOld.results[0]?.text === 'Main', 'Deprecated AST query for module name.', 'AST Query (Deprecated) - Module Name');

}


async function runTests() {
    console.log(chalk.cyan.bold("Starting MCP Server Automated Tests (JSON-RPC over Stdio)...\n"));

    await startMcpServer();
    await initializeMcpServer();

    // Test 1: echo
    const echoResult = await callMcpTool('echo', { message: 'Hello Test' });
    assert(echoResult && echoResult === 'Echo: Hello Test', 'Echo tool responds correctly.', 'Echo');

    // Run AST tool tests
    await runAstToolTests();

    // Test: start_purs_ide_server
    console.log(chalk.yellow(`\nINFO: For 'start_purs_ide_server' test, ensure '${TEST_PROJECT_PATH}' is compiled (run 'spago build' in it).`));
    const startIdeResult = await callMcpTool('start_purs_ide_server', {
        project_path: TEST_PROJECT_PATH,
        port: PURS_IDE_TEST_PORT,
        log_level: "debug"
    });
    assert(startIdeResult && startIdeResult.status_message && startIdeResult.port === PURS_IDE_TEST_PORT, 'start_purs_ide_server reports success and correct port.', 'Start purs ide');
    if (startIdeResult && startIdeResult.initial_load_result) {
        logTest(`Initial load result from purs ide: ${JSON.stringify(startIdeResult.initial_load_result)}`, 'info');
        assert(startIdeResult.initial_load_result.resultType === 'success', 'purs ide initial load successful.', 'Start purs ide - Initial Load');
    } else if (startIdeResult && startIdeResult.status_message && startIdeResult.status_message.includes("initial load command failed")) {
         logTest("Warning: purs ide server started but initial load failed. This might be okay if project wasn't compiled. Check logs.", 'warn');
    }

    let pursIdeReadyForQuery = startIdeResult && startIdeResult.status_message && (startIdeResult.initial_load_result?.resultType === 'success' || startIdeResult.status_message.includes("initial load command failed"));

    if (pursIdeReadyForQuery && startIdeResult.initial_load_result?.resultType !== 'success') {
        logTest("Skipping some purs ide query tests as initial load was not fully successful. Compile the test project.", 'warn');
    }
    
    if (pursIdeReadyForQuery && startIdeResult.initial_load_result?.resultType === 'success') {
        const completeTest = await callMcpTool('query_purs_ide', {
            purs_ide_command: "complete",
            purs_ide_params: { filters: [{"filter": "exact", "params": {"search": "log"}}], currentModule: "Main", options: {maxResults: 5} }
        });
        assert(completeTest && completeTest.resultType === 'success' && completeTest.result.some(r => r.identifier === 'log' && r.module === 'Effect.Console'), 'query_purs_ide for "complete log".', 'Query purs ide - Complete');

        const typeTest = await callMcpTool('query_purs_ide', {
            purs_ide_command: "type",
            purs_ide_params: { search: "main", currentModule: "Main" }
        });
        assert(typeTest && typeTest.resultType === 'success' && typeTest.result.some(r => r.identifier === 'main' && r.type.includes('Effect Unit')), 'query_purs_ide for "type main".', 'Query purs ide - Type');
        
        const usagesTest = await callMcpTool('query_purs_ide', {
            purs_ide_command: "usages",
            purs_ide_params: { module: "Effect.Console", namespace: "value", identifier: "log" }
        });
        assert(usagesTest && usagesTest.resultType === 'success' && usagesTest.result.length >= 2, 'query_purs_ide for "usages log".', 'Query purs ide - Usages');

        const depGraphTest = await callMcpTool('generate_dependency_graph', {
            target_modules: ["Main", "Utils", "Effect.Console"]
        });
        assert(depGraphTest && depGraphTest.graph_nodes && depGraphTest.graph_nodes.some(n => n.id === "Main.main"), 'generate_dependency_graph for Main module.', 'Dependency Graph - Main Module Presence');
    } else {
        logTest("Skipping purs ide query and dependency graph tests as purs ide server did not start/load project successfully.", 'warn');
        testsFailed += 4; // Mark these dependent tests as failed
    }

    const stopIdeResult = await callMcpTool('stop_purs_ide_server', {});
    assert(stopIdeResult && stopIdeResult.status_message === "purs ide server stopped.", 'stop_purs_ide_server reports success.', 'Stop purs ide');


    console.log(chalk.cyan.bold("\n--- Test Summary ---"));
    console.log(chalk.green(`Passed: ${testsPassed}`));
    console.log(chalk.red(`Failed: ${testsFailed}`));

    if (mcpServerProcess) {
        logTest('Stopping MCP server process...', 'info');
        mcpServerProcess.kill();
    }

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
    if (mcpServerProcess) {
        mcpServerProcess.kill();
    }
    process.exit(1);
});
