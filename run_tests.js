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

    const getTopLevelDeclarationsTestCode = `
module Test.Declarations where

import Prelude
import Effect (Effect)

data MyData = ConstructorA | ConstructorB String

type MyAlias = Int

myFunction :: Int -> Int
myFunction x = x + 1

anotherFunction :: String -> Effect Unit
anotherFunction _ = pure unit

class MySimpleClass a where
  mySimpleMethod :: a -> a

instance mySimpleClassInt :: MySimpleClass Int where
  mySimpleMethod x = x

foreign import data ForeignDataType :: Type
foreign import foreignFunc :: Int -> String
type role MyData representational
infix 6 type Tuple as /\\
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

    // Test getTopLevelDeclarations (new comprehensive tool)
    let declsResult = await callMcpTool('getTopLevelDeclarations', { code: getTopLevelDeclarationsTestCode });
    assert(declsResult && Array.isArray(declsResult), 'getTopLevelDeclarations returns an array.', 'AST - getTopLevelDeclarations - Basic');
    if (declsResult && Array.isArray(declsResult)) {
        const expectedDeclCount = 14; // MyData, MyAlias, myFunction sig, myFunction val, anotherFunction sig, anotherFunction val, MySimpleClass, mySimpleMethod sig, mySimpleClassInt inst, ForeignDataType, foreignFunc, MyData role, Tuple infix
        assert(declsResult.length === expectedDeclCount, `getTopLevelDeclarations finds ${expectedDeclCount} declarations. Found: ${declsResult.length}`, 'AST - getTopLevelDeclarations - Count');

        const myFuncDecl = declsResult.find(d => d.name === 'myFunction' && d.type === 'DeclValue');
        assert(myFuncDecl && myFuncDecl.value.includes('myFunction x = x + 1'), 'getTopLevelDeclarations finds myFunction (DeclValue).', 'AST - getTopLevelDeclarations - myFunction');

        const myDataDecl = declsResult.find(d => d.name === 'MyData' && d.type === 'DeclData');
        assert(myDataDecl && myDataDecl.value.includes('data MyData = ConstructorA | ConstructorB String'), 'getTopLevelDeclarations finds MyData (DeclData).', 'AST - getTopLevelDeclarations - MyData');
        
        const myAliasDecl = declsResult.find(d => d.name === 'MyAlias' && d.type === 'DeclType'); // type_alias maps to DeclType
        assert(myAliasDecl && myAliasDecl.value.includes('type MyAlias = Int'), 'getTopLevelDeclarations finds MyAlias (DeclType).', 'AST - getTopLevelDeclarations - MyAlias');

        const myClassDecl = declsResult.find(d => d.name === 'MySimpleClass' && d.type === 'DeclClass');
        assert(myClassDecl && myClassDecl.value.includes('class MySimpleClass a where'), 'getTopLevelDeclarations finds MySimpleClass (DeclClass).', 'AST - getTopLevelDeclarations - MySimpleClass');

        const myInstanceDecl = declsResult.find(d => d.name.startsWith('MySimpleClass Int') && d.type === 'DeclInstanceChain');
        assert(myInstanceDecl && myInstanceDecl.value.includes('instance mySimpleClassInt :: MySimpleClass Int where'), 'getTopLevelDeclarations finds MySimpleClass Int instance (DeclInstanceChain).', 'AST - getTopLevelDeclarations - MySimpleClass Instance');
    
        const foreignDataDecl = declsResult.find(d => d.name === 'ForeignDataType' && d.type === 'DeclKindSignature'); // foreign import data is a kind signature
        assert(foreignDataDecl && foreignDataDecl.value.includes('foreign import data ForeignDataType :: Type'), 'getTopLevelDeclarations finds ForeignDataType (DeclKindSignature).', 'AST - getTopLevelDeclarations - ForeignDataType');

        const foreignFuncDecl = declsResult.find(d => d.name === 'foreignFunc' && d.type === 'DeclForeign');
        assert(foreignFuncDecl && foreignFuncDecl.value.includes('foreign import foreignFunc :: Int -> String'), 'getTopLevelDeclarations finds foreignFunc (DeclForeign).', 'AST - getTopLevelDeclarations - foreignFunc');

        const roleDecl = declsResult.find(d => d.name === 'MyData' && d.type === 'DeclRole');
        assert(roleDecl && roleDecl.value.includes('type role MyData representational'), 'getTopLevelDeclarations finds MyData role (DeclRole).', 'AST - getTopLevelDeclarations - MyData Role');

        const fixityDecl = declsResult.find(d => d.name === '/\\' && d.type === 'DeclFixity');
        assert(fixityDecl && fixityDecl.value.includes('infix 6 type Tuple as /\\'), 'getTopLevelDeclarations finds Tuple infix (DeclFixity).', 'AST - getTopLevelDeclarations - Tuple Infix');
        
        // Test filtering
        const filteredDeclsName = await callMcpTool('getTopLevelDeclarations', { code: getTopLevelDeclarationsTestCode, filters: { name: "myFunction" } });
        assert(filteredDeclsName && filteredDeclsName.length === 2 && filteredDeclsName.every(d => d.name === "myFunction"), 'getTopLevelDeclarations filters by name (expects 2: Sig and Val).', 'AST - getTopLevelDeclarations - Filter Name');
        const hasSig = filteredDeclsName.some(d => d.type === "DeclSignature");
        const hasVal = filteredDeclsName.some(d => d.type === "DeclValue");
        assert(hasSig && hasVal, 'Filtered myFunction results include both DeclSignature and DeclValue.', 'AST - getTopLevelDeclarations - Filter Name Types');
        
        const filteredDeclsType = await callMcpTool('getTopLevelDeclarations', { code: getTopLevelDeclarationsTestCode, filters: { type: "DeclData" } });
        assert(filteredDeclsType && filteredDeclsType.length === 1 && filteredDeclsType[0].type === "DeclData", 'getTopLevelDeclarations filters by type.', 'AST - getTopLevelDeclarations - Filter Type');

        const filteredDeclsValue = await callMcpTool('getTopLevelDeclarations', { code: getTopLevelDeclarationsTestCode, filters: { value: "Effect Unit" } });
        assert(filteredDeclsValue && filteredDeclsValue.length === 1 && filteredDeclsValue[0].name === "anotherFunction", 'getTopLevelDeclarations filters by value.', 'AST - getTopLevelDeclarations - Filter Value');
    }
    
    // 3. getFunctionNames
    testResult = await callMcpTool('getFunctionNames', { code: functionsCode });
    assertDeepEqual(testResult, ["myFunction", "anotherFunction", "main"], 'getFunctionNames finds all functions.', 'AST - getFunctionNames');

    // 16. getWhereBindings
    testResult = await callMcpTool('getWhereBindings', { code: whereBindingsCode });
    const expectedWhereBlock = `where 
    intermediate = x + 1
    result = intermediate * 2`;
    // The tool returns an array of where block texts.
    assert(Array.isArray(testResult) && testResult.length === 1 && testResult[0].replace(/\s+/g, ' ').trim() === expectedWhereBlock.replace(/\s+/g, ' ').trim(),
           `getWhereBindings returns the full where block text. Expected: "${expectedWhereBlock.replace(/\s+/g, ' ')}", Got: "${testResult && testResult[0] ? testResult[0].replace(/\s+/g, ' ') : 'undefined'}"`,
           'AST - getWhereBindings');

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
    assert(echoResult && typeof echoResult === 'string' && echoResult.trim() === 'Echo: Hello Test', 
           `Echo tool responds correctly. Got: "${echoResult}" (type: ${typeof echoResult})`, 
           'Echo');

    // Test 2: get_server_status
    const serverStatusResult = await callMcpTool('get_server_status');
    assert(serverStatusResult && serverStatusResult.status === 'running' && serverStatusResult.purescript_tools_mcp_version, 'get_server_status reports running and version.', 'Server Status');
    if (serverStatusResult && serverStatusResult.purs_ide_server_status) {
        assert(serverStatusResult.purs_ide_server_status.status === 'not_started' || serverStatusResult.purs_ide_server_status.status === 'stopped', 'get_server_status reports purs_ide_server initially not started or stopped.', 'Server Status - Purescript IDE');
    }


    // Run AST tool tests
    await runAstToolTests();

    // Test: start_purs_ide_server
    console.log(chalk.yellow(`\nINFO: For 'start_purs_ide_server' test, ensure '${TEST_PROJECT_PATH}' is compiled (run 'spago build' in it).`));
    const startIdeResult = await callMcpTool('start_purs_ide_server', {
        project_path: TEST_PROJECT_PATH,
        log_level: "debug"
    });
    assert(startIdeResult && startIdeResult.status_message && typeof startIdeResult.port === 'number', 'start_purs_ide_server reports success and returns a port number.', 'Start purs ide');
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

        const typeTestOld = await callMcpTool('query_purs_ide', {
            purs_ide_command: "type",
            purs_ide_params: { search: "main", currentModule: "Main" }
        });
        assert(typeTestOld && typeTestOld.resultType === 'success' && typeTestOld.result.some(r => r.identifier === 'main' && r.type.includes('Effect Unit')), 'query_purs_ide for "type main".', 'Query purs ide - Type (Old)');
        
        const usagesTestOld = await callMcpTool('query_purs_ide', {
            purs_ide_command: "usages",
            purs_ide_params: { module: "Effect.Console", namespace: "value", identifier: "log" }
        });
        assert(usagesTestOld && usagesTestOld.resultType === 'success' && usagesTestOld.result.length >= 2, 'query_purs_ide for "usages log".', 'Query purs ide - Usages (Old)');

        const depGraphTest = await callMcpTool('generate_dependency_graph', {
            target_modules: ["Main", "Utils", "Effect.Console"]
        });
        assert(depGraphTest && depGraphTest.graph_nodes && depGraphTest.graph_nodes.some(n => n.id === "Main.main"), 'generate_dependency_graph for Main module.', 'Dependency Graph - Main Module Presence');

        // Run tests for dedicated purs ide tools
        await runDedicatedPursIdeToolTests();

    } else {
        logTest("Skipping purs ide query, dependency graph, and dedicated purs ide tool tests as purs ide server did not start/load project successfully.", 'warn');
        testsFailed += 4; // Mark these dependent tests as failed (query_purs_ide tests)
        testsFailed += 8; // Mark dedicated purs ide tool tests as failed (7 existing + 1 new for pursIdeQuit)
    }

    const stopIdeResult = await callMcpTool('stop_purs_ide_server', {});
    const stopMessage = stopIdeResult ? stopIdeResult.status_message : "";
    assert(stopIdeResult && (stopMessage === "purs ide server stopped." || stopMessage === "No purs ide server was running."), 
           `stop_purs_ide_server reports appropriate status. Got: "${stopMessage}"`, 
           'Stop purs ide');


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

async function runDedicatedPursIdeToolTests() {
    logTest("--- Running Dedicated Purs IDE Tool Tests ---", "info");

    // Test: pursIdeLoad (all modules - already done by start_purs_ide_server, but test explicit call)
    const loadAllResult = await callMcpTool('pursIdeLoad', {});
    assert(loadAllResult && loadAllResult.resultType === 'success', 'pursIdeLoad (all modules) reports success.', 'PursIDE - Load All');

    // Test: pursIdeLoad (specific module)
    const loadSpecificResult = await callMcpTool('pursIdeLoad', { modules: ["Main"] });
    assert(loadSpecificResult && loadSpecificResult.resultType === 'success', 'pursIdeLoad (specific module "Main") reports success.', 'PursIDE - Load Specific');

    // Test: pursIdeCwd
    const cwdResult = await callMcpTool('pursIdeCwd');
    assert(cwdResult && cwdResult.result === TEST_PROJECT_PATH, `pursIdeCwd returns correct path. Expected: ${TEST_PROJECT_PATH}, Got: ${cwdResult.result}`, 'PursIDE - Cwd');

    // Test: pursIdeType
    const typeResult = await callMcpTool('pursIdeType', { search: "main", currentModule: "Main" });
    assert(typeResult && typeResult.resultType === 'success' && typeResult.result.some(r => r.identifier === 'main' && r.type.includes('Effect Unit')), 'pursIdeType for "main" in "Main".', 'PursIDE - Type');
    
    const typeWithFilterResult = await callMcpTool('pursIdeType', { search: "log", filters: [{ "filter": "exact", "params": {"search": "log", "module": ["Effect.Console"]}}] });
    assert(typeWithFilterResult && typeWithFilterResult.resultType === 'success' && typeWithFilterResult.result.some(r => r.identifier === 'log' && r.module === 'Effect.Console'), 'pursIdeType for "log" with module filter.', 'PursIDE - Type with Filter');

    // Test: pursIdeUsages
    const usagesResult = await callMcpTool('pursIdeUsages', { module: "Effect.Console", namespace: "value", identifier: "log" });
    assert(usagesResult && usagesResult.resultType === 'success' && usagesResult.result.length >= 2, 'pursIdeUsages for "log" in "Effect.Console".', 'PursIDE - Usages');

    // Test: pursIdeList (availableModules)
    const listModulesResult = await callMcpTool('pursIdeList', { listType: "availableModules" });
    assert(listModulesResult && listModulesResult.resultType === 'success' && Array.isArray(listModulesResult.result) && listModulesResult.result.includes("Main"), 'pursIdeList (availableModules) lists "Main".', 'PursIDE - List Available Modules');

    // Test: pursIdeList (import)
    const listImportResult = await callMcpTool('pursIdeList', { listType: "import", file: path.join(TEST_PROJECT_PATH, "src/Main.purs") });
    assert(listImportResult && listImportResult.resultType === 'success' && 
           listImportResult.result && Array.isArray(listImportResult.result.imports) && 
           listImportResult.result.imports.some(imp => imp.module === "Effect.Console"), 
           'pursIdeList (import for Main.purs) lists "Effect.Console".', 'PursIDE - List Imports');

    // Test: pursIdeRebuild
    // For a simple rebuild test, we'll use the existing Utils.purs.
    // A more robust test might involve modifying the file, but for now, just check if rebuild runs.
    const utilsFilePath = path.join(TEST_PROJECT_PATH, 'src/Utils.purs');
    const rebuildResult = await callMcpTool('pursIdeRebuild', { file: utilsFilePath });
    assert(rebuildResult && rebuildResult.resultType === 'success', `pursIdeRebuild for "${utilsFilePath}" reports success.`, 'PursIDE - Rebuild');
    if (rebuildResult && rebuildResult.resultType === 'success' && rebuildResult.result && rebuildResult.result.length > 0) {
        const firstRebuildEntry = rebuildResult.result[0];
        assert(firstRebuildEntry.file === utilsFilePath && firstRebuildEntry.status === 'rebuilt', 'pursIdeRebuild result entry indicates rebuilt file.', 'PursIDE - Rebuild Status');
    } else if (rebuildResult && rebuildResult.resultType === 'success' && (!rebuildResult.result || rebuildResult.result.length === 0)) {
        logTest(`pursIdeRebuild for "${utilsFilePath}" succeeded but returned empty result array. This might mean no changes were detected.`, 'warn');
        assert(true, `pursIdeRebuild for "${utilsFilePath}" succeeded (empty result).`, 'PursIDE - Rebuild');
    }


    // Test: pursIdeReset
    const resetResult = await callMcpTool('pursIdeReset');
    assert(resetResult && resetResult.resultType === 'success', 'pursIdeReset reports success.', 'PursIDE - Reset');
    // After reset, a type query might fail or return empty if modules are truly cleared.
    // However, the server might auto-reload. Let's re-load to be sure for subsequent tests if any.
    await callMcpTool('pursIdeLoad', {}); // Reload all for safety

    // Test: pursIdeQuit
    // This should cause the purs ide server to stop.
    // The subsequent call to 'stop_purs_ide_server' in the main runTests function
    // should then confirm it's stopped or handle it gracefully.
    logTest("Attempting to quit purs ide server via pursIdeQuit tool...", "info");
    const quitResult = await callMcpTool('pursIdeQuit');
    assert(quitResult && (quitResult.resultType === 'success' || quitResult.message === 'purs ide server quit successfully.'), 'pursIdeQuit reports success.', 'PursIDE - Quit');
    
    // Verify server status after quit
    const serverStatusAfterQuit = await callMcpTool('get_server_status');
    if (serverStatusAfterQuit && serverStatusAfterQuit.purs_ide_server_status) {
        assert(serverStatusAfterQuit.purs_ide_server_status.status === 'stopped' || serverStatusAfterQuit.purs_ide_server_status.status === 'not_running', 'get_server_status reports purs_ide_server stopped after pursIdeQuit.', 'Server Status - Purescript IDE After Quit');
    }
}
