const express = require('express');
const { Parser, Language, Query } = require('web-tree-sitter');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const chalk = require('chalk');
const fs = require('fs').promises; // Added for file reading

const app = express();
const mcpPort = 3000;

app.use(express.json());

// --- Tree-sitter PureScript Parser State ---
let PureScriptLanguage;
let purescriptTsParser; // Global Tree-sitter parser instance

// --- purs ide Server State ---
let pursIdeProcess = null;
let pursIdeServerPort = null;
let pursIdeProjectPath = null; // Stores the project path used to start purs ide
let pursIdeIsReady = false;
let pursIdeLogBuffer = [];
const MAX_IDE_LOG_BUFFER = 200;

// --- Constants for Dependency Graph ---
const MAX_RESULTS_COMPLETIONS_FOR_GRAPH = 10000;
const ENCLOSING_DECL_QUERY_SOURCE = `(function name: (_) @name) @decl ;; Covers top-level bindings and functions`;
const MODULE_NAME_QUERY_SOURCE = "(purescript name: (qualified_module) @qmodule.name_node)";
let ENCLOSING_DECL_TS_QUERY;
let MODULE_NAME_TS_QUERY;


function logPursIdeOutput(data, type = 'stdout') {
    const message = data.toString().trim();
    if (type === 'stderr') {
        console.error(chalk.redBright(`[purs ide stderr]: ${message}`));
    } else {
        console.log(chalk.blueBright(`[purs ide stdout]: ${message}`));
    }
    pursIdeLogBuffer.push(`[${type}] ${message}`);
    if (pursIdeLogBuffer.length > MAX_IDE_LOG_BUFFER) {
        pursIdeLogBuffer.shift();
    }
}

async function initializeTreeSitterParser() {
    try {
        await Parser.init();
        const wasmPath = path.join(__dirname, 'tree-sitter-purescript.wasm');
        PureScriptLanguage = await Language.load(wasmPath);
        purescriptTsParser = new Parser();
        purescriptTsParser.setLanguage(PureScriptLanguage);
        // Initialize TS queries
        ENCLOSING_DECL_TS_QUERY = new Query(PureScriptLanguage, ENCLOSING_DECL_QUERY_SOURCE);
        MODULE_NAME_TS_QUERY = new Query(PureScriptLanguage, MODULE_NAME_QUERY_SOURCE);
        console.log(chalk.green("Tree-sitter PureScript grammar and parser initialized successfully."));
    } catch (error) {
        console.error(chalk.red("Failed to load Tree-sitter PureScript grammar:"), error);
        process.exit(1);
    }
}

// --- MCP Server Manifest ---
const mcpManifest = {
    name: "purescript-mcp-server",
    description: "MCP server for PureScript tasks, including AST querying, purs ide interaction, and dependency graph generation.",
    tools: [
        {
            name: "echo",
            description: "Echoes back the input string.",
            input_schema: { /* ... */ }, output_schema: { /* ... */ }
        },
        {
            name: "query_purescript_ast",
            description: "Parses PureScript code and executes a Tree-sitter query against its AST.",
            input_schema: { /* ... */ }, output_schema: { /* ... */ }
        },
        {
            name: "start_purs_ide_server",
            description: "Starts a purs ide server process for a given PureScript project. This server is then used by 'query_purs_ide' and 'generate_dependency_graph'. Manages one server instance at a time.",
            input_schema: { /* ... */ }, output_schema: { /* ... */ }
        },
        {
            name: "stop_purs_ide_server",
            description: "Stops the currently managed purs ide server process.",
            input_schema: {}, output_schema: { /* ... */ }
        },
        {
            name: "query_purs_ide",
            description: "Sends a command to the currently running purs ide server (must be started first using 'start_purs_ide_server').",
            input_schema: { /* ... */ }, output_schema: { /* ... */ }
        },
        {
            name: "generate_dependency_graph",
            description: "Generates a dependency graph for specified PureScript modules using purs ide and Tree-sitter.",
            input_schema: {
                type: "object",
                properties: {
                    target_modules: {
                        type: "array",
                        items: { type: "string" },
                        description: "Array of module names to analyze (e.g., ['Main', 'My.Module'])."
                    },
                    max_concurrent_requests: {
                        type: "integer",
                        description: "Maximum number of concurrent 'usages' requests to purs ide.",
                        default: 5
                    }
                },
                required: ["target_modules"]
            },
            output_schema: {
                type: "object",
                properties: {
                    graph_nodes: { type: "array", items: { type: "object" }, description: "Array of declaration nodes with 'usedBy' information." },
                    error: { type: "string" }
                }
            }
        }
    ]
};
// Fill in missing schemas for brevity in manifest definition
mcpManifest.tools.forEach(tool => {
    if (tool.name === "echo") {
        tool.input_schema = { type: "object", properties: { message: { type: "string"}}, required: ["message"] };
        tool.output_schema = { type: "object", properties: { echoed_message: { type: "string" }}};
    } else if (tool.name === "query_purescript_ast") {
        tool.input_schema = { type: "object", properties: { purescript_code: { type: "string" }, tree_sitter_query: { type: "string" }}, required: ["purescript_code", "tree_sitter_query"]};
        tool.output_schema = { type: "object", properties: { results: { type: "array" }, error: { type: "string" }}};
    } else if (tool.name === "start_purs_ide_server") {
        tool.input_schema = { type: "object", properties: { project_path: { type: "string" }, port: { type: "integer", default: 4242 }, output_directory: { type: "string", default: "output/" }, source_globs: { type: "array", items: { type: "string" }, default: ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"]}, log_level: { type: "string", enum: ["all", "debug", "perf", "none"], default: "none" }}};
        tool.output_schema = { type: "object", properties: { status: {type: "string"}, message: {type: "string"}, port: {type: "integer"}, project_path: {type: "string"}, initial_load_result: {type: "object"}, logs: {type: "array"}}};
    } else if (tool.name === "stop_purs_ide_server") {
        tool.output_schema = { type: "object", properties: { status: {type: "string"}, message: {type: "string"}}};
    } else if (tool.name === "query_purs_ide") {
        tool.input_schema = { type: "object", properties: { purs_ide_command: { type: "string" }, purs_ide_params: { type: "object" }}, required: ["purs_ide_command"]};
        tool.output_schema = { type: "object", properties: { status: {type: "string"}, result: {type: "object"}, error: {type: "string"}}};
    }
});


// --- Helper Functions from Script ---
function getNamespaceForDeclaration(declarationType) {
  switch (declarationType) {
    case "value": case "valueoperator": case "dataconstructor": return "value";
    case "type": case "typeoperator": case "synonym": case "typeclass": return "type";
    case "kind": return "kind";
    default: return null;
  }
}

function getDeclarationId(decl) {
  if (!decl || !decl.module || !decl.identifier) return `unknown.${Date.now()}.${Math.random()}`;
  return `${decl.module}.${decl.identifier}`;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- `purs ide` Communication & Management ---
function sendCommandToPursIde(commandPayload) {
    return new Promise((resolve, reject) => {
        if (!pursIdeProcess || !pursIdeIsReady || !pursIdeServerPort) {
            return reject(new Error("purs ide server is not running or not ready."));
        }
        const client = new net.Socket();
        let responseData = '';
        client.connect(pursIdeServerPort, '127.0.0.1', () => {
            console.log(chalk.cyan(`[MCP Client->purs ide]: Sending command: ${JSON.stringify(commandPayload).substring(0,100)}...`));
            client.write(JSON.stringify(commandPayload) + '\n');
        });
        client.on('data', (data) => {
            responseData += data.toString();
            if (responseData.includes('\n')) client.end();
        });
        client.on('close', () => {
            console.log(chalk.cyan(`[MCP Client->purs ide]: Connection closed. Raw response: ${responseData.substring(0,100)}...`));
            try {
                resolve(JSON.parse(responseData.trim()));
            } catch (e) {
                reject(new Error(`Failed to parse JSON response from purs ide: ${e.message}. Raw: ${responseData}`));
            }
        });
        client.on('error', (err) => reject(new Error(`TCP connection error with purs ide server: ${err.message}`)));
    });
}

// --- MCP Endpoints ---
app.get('/mcp/manifest', (req, res) => res.json(mcpManifest));

app.post('/mcp/tools/:toolName', async (req, res) => {
    const toolName = req.params.toolName;
    const args = req.body;
    console.log(chalk.yellow(`[MCP Server]: Received tool execution request for '${toolName}' with args: ${JSON.stringify(args).substring(0,100)}...`));

    if (toolName === "echo") {
        if (!args || typeof args.message !== 'string') return res.status(400).json({ error: "Invalid input. 'message' (string) is required." });
        return res.json({ echoed_message: `Echo: ${args.message}` });
    }
    if (toolName === "query_purescript_ast") {
        if (!PureScriptLanguage || !purescriptTsParser) return res.status(500).json({ error: "Tree-sitter PureScript grammar/parser not loaded." });
        if (!args || typeof args.purescript_code !== 'string' || typeof args.tree_sitter_query !== 'string') {
            return res.status(400).json({ error: "Invalid input for query_purescript_ast: 'purescript_code' and 'tree_sitter_query' (strings) are required." });
        }
        try {
            const tree = purescriptTsParser.parse(args.purescript_code);
            const query = new Query(PureScriptLanguage, args.tree_sitter_query);
            const captures = query.captures(tree.rootNode);
            const results = captures.map(capture => ({ name: capture.name, text: capture.node.text }));
            return res.json({ results });
        } catch (e) {
            return res.status(500).json({ error: `Failed to execute Tree-sitter query: ${e.message}` });
        }
    }
    if (toolName === "start_purs_ide_server") {
        if (pursIdeProcess) {
            logPursIdeOutput("Stopping existing purs ide server before starting a new one.", "mcp_internal");
            pursIdeProcess.kill(); pursIdeProcess = null; pursIdeIsReady = false;
        }
        pursIdeServerPort = args.port || 4242;
        pursIdeProjectPath = path.resolve(args.project_path || process.cwd()); // Resolve to absolute path
        const outputDir = args.output_directory || "output/";
        const sourceGlobs = args.source_globs || ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"];
        const logLevel = args.log_level || "none";
        pursIdeLogBuffer = [];

        const cmdArgs = ['ide', 'server', '--port', pursIdeServerPort.toString(), '--output-directory', outputDir, '--log-level', logLevel, ...sourceGlobs];
        console.log(chalk.magenta(`[MCP Server]: Spawning 'npx purs ${cmdArgs.join(' ')}' in CWD: ${pursIdeProjectPath}`));
        pursIdeProcess = spawn('npx', ['purs', ...cmdArgs], { cwd: pursIdeProjectPath, shell: true });
        pursIdeIsReady = false;

        pursIdeProcess.stdout.on('data', (data) => logPursIdeOutput(data, 'stdout'));
        pursIdeProcess.stderr.on('data', (data) => logPursIdeOutput(data, 'stderr'));
        pursIdeProcess.on('error', (err) => { logPursIdeOutput(`Failed to start purs ide server: ${err.message}`, 'error'); pursIdeProcess = null; });
        pursIdeProcess.on('close', (code) => {
            logPursIdeOutput(`purs ide server process exited with code ${code}`, code === 0 ? 'mcp_internal' : 'error');
            if (pursIdeProcess) { pursIdeProcess = null; pursIdeIsReady = false; }
        });

        await delay(3000); // Wait for server to potentially start

        try {
            console.log(chalk.cyan("[MCP Server]: Attempting initial 'load' command to purs ide server..."));
            pursIdeIsReady = true; // Assume ready for this first call
            const loadResult = await sendCommandToPursIde({ command: "load", params: {} });
            console.log(chalk.green("[MCP Server]: Initial 'load' command to purs ide server successful."));
            return res.json({ status: "success", message: "purs ide server started and initial load attempted.", port: pursIdeServerPort, project_path: pursIdeProjectPath, initial_load_result: loadResult, logs: pursIdeLogBuffer });
        } catch (error) {
            pursIdeIsReady = false;
            console.error(chalk.red(`[MCP Server]: Error during initial 'load' to purs ide server: ${error.message}`));
            if(pursIdeProcess) pursIdeProcess.kill(); pursIdeProcess = null;
            return res.status(500).json({ status: "error", message: `purs ide server started but initial load command failed: ${error.message}`, port: pursIdeServerPort, project_path: pursIdeProjectPath, logs: pursIdeLogBuffer });
        }
    }
    if (toolName === "stop_purs_ide_server") {
        if (pursIdeProcess) {
            pursIdeProcess.kill(); pursIdeProcess = null; pursIdeIsReady = false;
            logPursIdeOutput("purs ide server stopped by MCP.", "mcp_internal");
            return res.json({ status: "success", message: "purs ide server stopped." });
        }
        return res.json({ status: "success", message: "No purs ide server was running." });
    }
    if (toolName === "query_purs_ide") {
        if (!pursIdeProcess || !pursIdeIsReady) return res.status(400).json({ error: "purs ide server is not running or not ready. Please start it first." });
        if (!args || typeof args.purs_ide_command !== 'string') return res.status(400).json({ error: "Invalid input. 'purs_ide_command' (string) is required." });
        try {
            const result = await sendCommandToPursIde({ command: args.purs_ide_command, params: args.purs_ide_params || {} });
            return res.json({ status: "success", result: result });
        } catch (error) {
            console.error(chalk.red(`[MCP Server]: Error querying purs ide: ${error.message}`));
            return res.status(500).json({ status: "error", error: error.message, purs_ide_logs: pursIdeLogBuffer });
        }
    }
    if (toolName === "generate_dependency_graph") {
        if (!pursIdeProcess || !pursIdeIsReady) return res.status(400).json({ error: "purs ide server is not running or not ready. Please start it first using 'start_purs_ide_server'." });
        if (!purescriptTsParser || !PureScriptLanguage) return res.status(500).json({ error: "Tree-sitter parser for PureScript not initialized." });
        if (!args || !Array.isArray(args.target_modules) || args.target_modules.some(m => typeof m !== 'string')) {
            return res.status(400).json({ error: "Invalid input: 'target_modules' (array of strings) is required." });
        }

        const { target_modules, max_concurrent_requests = 5 } = args;
        const graphNodesMap = new Map();
        const graphNodesList = [];

        console.log(chalk.blue(`[DepGraph]: Phase 1: Identifying all declarations in [${target_modules.join(', ')}]...`));
        for (const moduleName of target_modules) {
            try {
                const completeResponse = await sendCommandToPursIde({
                    command: "complete",
                    params: {
                        filters: [{ filter: "modules", params: { modules: [moduleName] } }],
                        matcher: {},
                        options: { maxResults: MAX_RESULTS_COMPLETIONS_FOR_GRAPH, groupReexports: false }
                    }
                });
                if (completeResponse.resultType === "success" && Array.isArray(completeResponse.result)) {
                    completeResponse.result.forEach(decl => {
                        if (decl.definedAt && decl.definedAt.name) { // Ensure source location exists
                            const declId = getDeclarationId(decl);
                            if (!graphNodesMap.has(declId)) {
                                const node = {
                                    id: declId, module: decl.module, identifier: decl.identifier,
                                    type: decl.type, declarationType: decl.declarationType,
                                    definedAt: decl.definedAt,
                                    filePath: path.relative(pursIdeProjectPath || process.cwd(), decl.definedAt.name), // Use pursIdeProjectPath
                                    usedBy: []
                                };
                                graphNodesMap.set(declId, node);
                                graphNodesList.push(node);
                            }
                        }
                    });
                } else {
                    console.warn(chalk.yellow(`[DepGraph]: Could not get completions for module ${moduleName}: ${JSON.stringify(completeResponse.result)}`));
                }
            } catch (error) {
                console.error(chalk.red(`[DepGraph]: Error fetching completions for module ${moduleName}: ${error.message}`));
            }
        }
        console.log(chalk.blue(`[DepGraph]: Identified ${graphNodesList.length} declarations with source locations.`));
        console.log(chalk.blue(`[DepGraph]: Phase 2: Identifying dependencies...`));

        const processUsageQueue = [];
        let activePromises = 0;
        let processedDeclarations = 0;

        for (const sourceDeclNode of graphNodesList) {
            const taskFn = async () => {
                activePromises++;
                try {
                    const namespace = getNamespaceForDeclaration(sourceDeclNode.declarationType);
                    if (!namespace) return;

                    const usagesResponse = await sendCommandToPursIde({
                        command: "usages",
                        params: { module: sourceDeclNode.module, identifier: sourceDeclNode.identifier, namespace: namespace }
                    });

                    if (usagesResponse.resultType === "success" && Array.isArray(usagesResponse.result)) {
                        const usagesByFile = {};
                        usagesResponse.result.forEach(usageLoc => {
                            if (usageLoc && usageLoc.name && usageLoc.start && usageLoc.end) {
                                if (!usagesByFile[usageLoc.name]) usagesByFile[usageLoc.name] = [];
                                usagesByFile[usageLoc.name].push(usageLoc);
                            }
                        });

                        for (const absoluteFilePath in usagesByFile) {
                            try {
                                const resolvedFilePath = path.isAbsolute(absoluteFilePath) ? absoluteFilePath : path.resolve(pursIdeProjectPath, absoluteFilePath);
                                const fileContent = await fs.readFile(resolvedFilePath, "utf-8");
                                const tree = purescriptTsParser.parse(fileContent);
                                const relativeFilePath = path.relative(pursIdeProjectPath || process.cwd(), resolvedFilePath);

                                usagesByFile[absoluteFilePath].forEach(usageLocation => {
                                    const usageStartPoint = { row: usageLocation.start[0] - 1, column: usageLocation.start[1] - 1 };
                                    const usageEndPoint = { row: usageLocation.end[0] - 1, column: usageLocation.end[1] - 1 };
                                    
                                    let bestMatchDeclNode = null;
                                    let bestMatchNameNodeText = null;
                                    let smallestSpanSize = Infinity;

                                    const matches = ENCLOSING_DECL_TS_QUERY.matches(tree.rootNode);
                                    for (const match of matches) {
                                        const declCapture = match.captures.find(c => c.name === 'decl');
                                        const nameCapture = match.captures.find(c => c.name === 'name');

                                        if (declCapture && nameCapture) {
                                            const declNode = declCapture.node;
                                            const declStartPoint = declNode.startPosition;
                                            const declEndPoint = declNode.endPosition;

                                            let withinBounds = usageStartPoint.row >= declStartPoint.row && usageEndPoint.row <= declEndPoint.row;
                                            if (withinBounds && usageStartPoint.row === declStartPoint.row && usageStartPoint.column < declStartPoint.column) withinBounds = false;
                                            if (withinBounds && usageEndPoint.row === declEndPoint.row && usageEndPoint.column > declEndPoint.column) withinBounds = false;
                                            
                                            if (withinBounds) {
                                                const spanSize = (declEndPoint.row - declStartPoint.row) * 10000 + (declEndPoint.column - (declStartPoint.row === declEndPoint.row ? declStartPoint.column : 0));
                                                if (spanSize < smallestSpanSize) {
                                                    smallestSpanSize = spanSize;
                                                    bestMatchDeclNode = declNode;
                                                    bestMatchNameNodeText = nameCapture.node.text;
                                                }
                                            }
                                        }
                                    }

                                    if (bestMatchDeclNode && bestMatchNameNodeText) {
                                        const callerIdentifierName = bestMatchNameNodeText;
                                        let callerModuleName = null;
                                        const moduleNameMatches = MODULE_NAME_TS_QUERY.matches(tree.rootNode);
                                        if (moduleNameMatches.length > 0 && moduleNameMatches[0].captures.length > 0) {
                                            const qmNodeCap = moduleNameMatches[0].captures.find(c => c.name === "qmodule.name_node");
                                            if(qmNodeCap) callerModuleName = qmNodeCap.node.text.replace(/\s+/g, "");
                                        }

                                        if (callerIdentifierName && callerModuleName) {
                                            const callerId = `${callerModuleName}.${callerIdentifierName}`;
                                            const usageDetail = { file: relativeFilePath, moduleName: callerModuleName, declarationName: callerIdentifierName, startLine: usageLocation.start[0], startCol: usageLocation.start[1], endLine: usageLocation.end[0], endCol: usageLocation.end[1] };
                                            
                                            const targetNode = graphNodesMap.get(sourceDeclNode.id);
                                            if(targetNode){
                                                let existingCaller = targetNode.usedBy.find(u => u.from === callerId);
                                                if (!existingCaller) {
                                                    existingCaller = { from: callerId, usagesAt: [] };
                                                    targetNode.usedBy.push(existingCaller);
                                                }
                                                // Ensure usageDetail is not already present by comparing specific fields
                                                if (!existingCaller.usagesAt.some(ud => 
                                                    ud.file === usageDetail.file &&
                                                    ud.moduleName === usageDetail.moduleName && // Also check moduleName and declarationName for robustness
                                                    ud.declarationName === usageDetail.declarationName &&
                                                    ud.startLine === usageDetail.startLine &&
                                                    ud.startCol === usageDetail.startCol &&
                                                    ud.endLine === usageDetail.endLine &&
                                                    ud.endCol === usageDetail.endCol
                                                )) {
                                                    existingCaller.usagesAt.push(usageDetail);
                                                }
                                                // DEBUG LOGGING FOR THE SPECIFIC CASE
                                                if (sourceDeclNode.id === "Effect.Console.log" && callerId === "Main.main") {
                                                    console.log(chalk.magentaBright(`[DepGraph DEBUG]: Added/updated usage for ${sourceDeclNode.id} from ${callerId}. Current usedBy for ${sourceDeclNode.id}:`), JSON.stringify(targetNode.usedBy, null, 2));
                                                }
                                            }
                                        } else {
                                             console.warn(chalk.yellow(`[DepGraph]: Could not extract caller module/id for usage in ${relativeFilePath} at L${usageLocation.start[0]}. CallerName: ${callerIdentifierName}, CallerModule: ${callerModuleName}`));
                                        }
                                    } else {
                                        // console.warn(chalk.yellow(`[DepGraph]: No enclosing declaration found for usage in ${relativeFilePath} at L${usageLocation.start[0]}`));
                                    }
                                });
                            } catch (fileReadError) {
                                console.error(chalk.red(`[DepGraph]: Error reading/parsing file ${absoluteFilePath}: ${fileReadError.message}`));
                            }
                        }
                    } else if (usagesResponse.resultType === "error") {
                        // console.warn(chalk.yellow(`[DepGraph]: Could not get usages for ${sourceDeclNode.id}: ${JSON.stringify(usagesResponse.result)}`));
                    }
                } catch (error) {
                    console.error(chalk.red(`[DepGraph]: Error processing usages for ${sourceDeclNode.id}: ${error.message}`));
                } finally {
                    activePromises--;
                    processedDeclarations++;
                    if (processedDeclarations % 10 === 0 || processedDeclarations === graphNodesList.length) {
                        console.log(chalk.blue(`[DepGraph]: Processed ${processedDeclarations}/${graphNodesList.length} declarations for usages...`));
                    }
                }
            };
            processUsageQueue.push(taskFn);

            if (processUsageQueue.length > 0 && activePromises < max_concurrent_requests) {
                const taskToRun = processUsageQueue.shift();
                if(taskToRun) taskToRun(); // Fire and forget for concurrency
            }
            if (activePromises >= max_concurrent_requests) {
                await delay(50); // Yield if concurrency limit reached
            }
        }
        // Wait for all promises to complete
        while (activePromises > 0 || processUsageQueue.length > 0) {
            if (processUsageQueue.length > 0 && activePromises < max_concurrent_requests) {
                 const taskToRun = processUsageQueue.shift();
                 if(taskToRun) taskToRun();
            } else {
                await delay(100);
            }
        }
        console.log(chalk.green(`[DepGraph]: Dependency graph generation complete.`));
        return res.json({ graph_nodes: graphNodesList });
    }

    console.log(chalk.yellow(`[MCP Server]: Attempted to execute unknown tool: ${toolName}`));
    return res.status(404).json({ error: `Tool '${toolName}' not found.` });
});

async function startMcpServer() {
    await initializeTreeSitterParser();
    app.listen(mcpPort, () => {
        console.log(chalk.bgGreen.black(`PureScript MCP Server listening at http://localhost:${mcpPort}`));
        console.log(chalk.bgGreen.black(`MCP Manifest available at http://localhost:${mcpPort}/mcp/manifest`));
    });
}

startMcpServer();

app.use((err, req, res, next) => {
    console.error(chalk.redBright.bold('[MCP Server Unhandled Error]:'), err.stack);
    res.status(500).send('Something broke!');
});
