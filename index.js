const { Parser, Language, Query } = require('web-tree-sitter');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const chalk = require('chalk');
const fs = require('fs').promises;
const readline = require('readline');

// --- Tree-sitter PureScript Parser State ---
let PureScriptLanguage;
let purescriptTsParser; // Global Tree-sitter parser instance
let treeSitterInitialized = false;

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

function logToStderr(message, level = 'info') {
    const timestamp = new Date().toISOString();
    let coloredMessage = message;
    switch (level) {
        case 'error': coloredMessage = chalk.redBright(`[${timestamp}] [ERROR] ${message}`); break;
        case 'warn': coloredMessage = chalk.yellowBright(`[${timestamp}] [WARN] ${message}`); break;
        case 'info': coloredMessage = chalk.blueBright(`[${timestamp}] [INFO] ${message}`); break;
        case 'debug': coloredMessage = chalk.gray(`[${timestamp}] [DEBUG] ${message}`); break;
        default: coloredMessage = `[${timestamp}] ${message}`;
    }
    process.stderr.write(coloredMessage + '\\n');
}

function logPursIdeOutput(data, type = 'stdout') {
    const message = data.toString().trim();
    const logType = type === 'stderr' ? 'error' : 'info';
    logToStderr(`[purs ide ${type}]: ${message}`, logType);
    
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
        ENCLOSING_DECL_TS_QUERY = new Query(PureScriptLanguage, ENCLOSING_DECL_QUERY_SOURCE);
        MODULE_NAME_TS_QUERY = new Query(PureScriptLanguage, MODULE_NAME_QUERY_SOURCE);
        treeSitterInitialized = true;
        logToStderr("Tree-sitter PureScript grammar and parser initialized successfully.", "info");
    } catch (error) {
        logToStderr(`Failed to load Tree-sitter PureScript grammar: ${error.message}`, "error");
        // Don't exit, allow other tools to function if possible, or report error via status.
    }
}

// --- MCP Server Manifest (adapted for stdio) ---
const mcpManifest = {
    name: "purescript-mcp-stdio-server",
    description: "MCP server for PureScript tasks (via stdio), including AST querying, purs ide interaction, and dependency graph generation.",
    tools: [
        {
            name: "get_manifest",
            description: "Returns this manifest.",
            input_schema: {},
            output_schema: { type: "object", description: "The MCP manifest object." }
        },
        {
            name: "get_server_status",
            description: "Returns the current status of the server and its components.",
            input_schema: {},
            output_schema: { type: "object" }
        },
        {
            name: "echo",
            description: "Echoes back the input string.",
            input_schema: { type: "object", properties: { message: { type: "string"}}, required: ["message"] },
            output_schema: { type: "object", properties: { echoed_message: { type: "string" }}}
        },
        {
            name: "query_purescript_ast",
            description: "Parses PureScript code and executes a Tree-sitter query against its AST.",
            input_schema: { type: "object", properties: { purescript_code: { type: "string" }, tree_sitter_query: { type: "string" }}, required: ["purescript_code", "tree_sitter_query"]},
            output_schema: { type: "object", properties: { results: { type: "array" } }}
        },
        {
            name: "start_purs_ide_server",
            description: "Starts a purs ide server process. Manages one server instance at a time.",
            input_schema: { type: "object", properties: { project_path: { type: "string" }, port: { type: "integer", default: 4242 }, output_directory: { type: "string", default: "output/" }, source_globs: { type: "array", items: { type: "string" }, default: ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"]}, log_level: { type: "string", enum: ["all", "debug", "perf", "none"], default: "none" }}},
            output_schema: { type: "object", properties: { status_message: {type: "string"}, port: {type: "integer"}, project_path: {type: "string"}, initial_load_result: {type: "object"}, logs: {type: "array"}}}
        },
        {
            name: "stop_purs_ide_server",
            description: "Stops the currently managed purs ide server process.",
            input_schema: {},
            output_schema: { type: "object", properties: { status_message: {type: "string"}}}
        },
        {
            name: "query_purs_ide",
            description: "Sends a command to the currently running purs ide server.",
            input_schema: { type: "object", properties: { purs_ide_command: { type: "string" }, purs_ide_params: { type: "object" }}, required: ["purs_ide_command"]},
            output_schema: { type: "object" } // Output is the direct JSON result from purs ide
        },
        {
            name: "generate_dependency_graph",
            description: "Generates a dependency graph for specified PureScript modules.",
            input_schema: {
                type: "object",
                properties: {
                    target_modules: { type: "array", items: { type: "string" }, description: "Array of module names." },
                    max_concurrent_requests: { type: "integer", description: "Max concurrent 'usages' requests.", default: 5 }
                },
                required: ["target_modules"]
            },
            output_schema: { type: "object", properties: { graph_nodes: { type: "array", items: { type: "object" }}}}
        }
    ]
};

// --- Helper Functions ---
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
            logToStderr(`[MCP Client->purs ide]: Sending command: ${JSON.stringify(commandPayload).substring(0,100)}...`, 'debug');
            client.write(JSON.stringify(commandPayload) + '\\n');
        });
        client.on('data', (data) => {
            responseData += data.toString();
            // purs ide sends newline-terminated JSON
            if (responseData.includes('\\n')) {
                 const completeResponses = responseData.split('\\n').filter(Boolean);
                 responseData = ''; // Clear buffer for next potential chunk
                 if (completeResponses.length > 0) {
                    try {
                        // Assuming purs ide sends one JSON object per command, take the first complete one.
                        // Or, if it could send multiple, this logic would need adjustment.
                        // For now, assume one JSON response per line/command.
                        resolve(JSON.parse(completeResponses[0].trim()));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON response from purs ide: ${e.message}. Raw: ${completeResponses[0]}`));
                    }
                 }
                 client.end(); // Close after first complete response.
            }
        });
         client.on('end', () => {
            // If responseData still has content here, it means it didn't end with a newline or wasn't parsed.
            if (responseData.trim()) {
                 try {
                    resolve(JSON.parse(responseData.trim()));
                } catch (e) {
                    reject(new Error(`Failed to parse JSON response from purs ide on end: ${e.message}. Raw: ${responseData}`));
                }
            }
            // If already resolved, this is fine.
        });
        client.on('close', () => {
            logToStderr(`[MCP Client->purs ide]: Connection closed.`, 'debug');
        });
        client.on('error', (err) => reject(new Error(`TCP connection error with purs ide server: ${err.message}`)));
    });
}

// --- Tool Handlers ---
async function handleGetManifest() {
    return mcpManifest;
}

async function handleGetServerStatus() {
    return {
        treeSitterInitialized,
        pursIdeServer: {
            running: !!pursIdeProcess,
            ready: pursIdeIsReady,
            port: pursIdeServerPort,
            projectPath: pursIdeProjectPath,
            recentLogs: pursIdeLogBuffer.slice(-10) // Last 10 log entries
        }
    };
}

async function handleEcho(args) {
    if (!args || typeof args.message !== 'string') throw new Error("Invalid input. 'message' (string) is required.");
    return { echoed_message: `Echo: ${args.message}` };
}

async function handleQueryPurescriptAst(args) {
    if (!treeSitterInitialized || !PureScriptLanguage || !purescriptTsParser) throw new Error("Tree-sitter PureScript grammar/parser not loaded.");
    if (!args || typeof args.purescript_code !== 'string' || typeof args.tree_sitter_query !== 'string') {
        throw new Error("Invalid input: 'purescript_code' and 'tree_sitter_query' (strings) are required.");
    }
    const tree = purescriptTsParser.parse(args.purescript_code);
    const query = new Query(PureScriptLanguage, args.tree_sitter_query);
    const captures = query.captures(tree.rootNode);
    const results = captures.map(capture => ({ name: capture.name, text: capture.node.text }));
    return { results };
}

async function handleStartPursIdeServer(args) {
    if (pursIdeProcess) {
        logToStderr("Stopping existing purs ide server before starting a new one.", "warn");
        pursIdeProcess.kill(); pursIdeProcess = null; pursIdeIsReady = false;
    }
    pursIdeServerPort = args.port || 4242;
    pursIdeProjectPath = path.resolve(args.project_path || process.cwd());
    const outputDir = args.output_directory || "output/";
    const sourceGlobs = args.source_globs || ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"];
    const logLevel = args.log_level || "none";
    pursIdeLogBuffer = [];

    const cmdArgs = ['ide', 'server', '--port', pursIdeServerPort.toString(), '--output-directory', outputDir, '--log-level', logLevel, ...sourceGlobs];
    logToStderr(`Spawning 'npx purs ${cmdArgs.join(' ')}' in CWD: ${pursIdeProjectPath}`, "info");
    
    return new Promise((resolve, reject) => {
        pursIdeProcess = spawn('npx', ['purs', ...cmdArgs], { cwd: pursIdeProjectPath, shell: true });
        pursIdeIsReady = false;

        pursIdeProcess.stdout.on('data', (data) => logPursIdeOutput(data, 'stdout'));
        pursIdeProcess.stderr.on('data', (data) => logPursIdeOutput(data, 'stderr'));
        pursIdeProcess.on('error', (err) => {
            logPursIdeOutput(`Failed to start purs ide server: ${err.message}`, 'error');
            pursIdeProcess = null;
            reject(new Error(`Failed to start purs ide server: ${err.message}`));
        });
        pursIdeProcess.on('close', (code) => {
            logPursIdeOutput(`purs ide server process exited with code ${code}`, code === 0 ? 'info' : 'error');
            if (pursIdeProcess) { pursIdeProcess = null; pursIdeIsReady = false; }
            // If it closes unexpectedly during startup, this might be an issue.
        });

        // Attempt initial load after a delay
        setTimeout(async () => {
            try {
                logToStderr("Attempting initial 'load' command to purs ide server...", "info");
                pursIdeIsReady = true; // Assume ready for this first call
                const loadResult = await sendCommandToPursIde({ command: "load", params: {} });
                logToStderr("Initial 'load' command to purs ide server successful.", "info");
                resolve({ status_message: "purs ide server started and initial load attempted.", port: pursIdeServerPort, project_path: pursIdeProjectPath, initial_load_result: loadResult, logs: pursIdeLogBuffer });
            } catch (error) {
                pursIdeIsReady = false;
                logToStderr(`Error during initial 'load' to purs ide server: ${error.message}`, "error");
                if(pursIdeProcess) { pursIdeProcess.kill(); pursIdeProcess = null; }
                reject(new Error(`purs ide server started but initial load command failed: ${error.message}`));
            }
        }, 3000); // Wait for server to potentially start
    });
}

async function handleStopPursIdeServer() {
    if (pursIdeProcess) {
        pursIdeProcess.kill(); pursIdeProcess = null; pursIdeIsReady = false;
        logPursIdeOutput("purs ide server stopped by MCP.", "info");
        return { status_message: "purs ide server stopped." };
    }
    return { status_message: "No purs ide server was running." };
}

async function handleQueryPursIde(args) {
    if (!pursIdeProcess || !pursIdeIsReady) throw new Error("purs ide server is not running or not ready. Please start it first.");
    if (!args || typeof args.purs_ide_command !== 'string') throw new Error("Invalid input. 'purs_ide_command' (string) is required.");
    return await sendCommandToPursIde({ command: args.purs_ide_command, params: args.purs_ide_params || {} });
}

async function handleGenerateDependencyGraph(args) {
    if (!pursIdeProcess || !pursIdeIsReady) throw new Error("purs ide server is not running or not ready. Please start it first.");
    if (!treeSitterInitialized || !purescriptTsParser || !PureScriptLanguage) throw new Error("Tree-sitter parser for PureScript not initialized.");
    if (!args || !Array.isArray(args.target_modules) || args.target_modules.some(m => typeof m !== 'string')) {
        throw new Error("Invalid input: 'target_modules' (array of strings) is required.");
    }

    const { target_modules, max_concurrent_requests = 5 } = args;
    const graphNodesMap = new Map();
    const graphNodesList = [];
    logToStderr(`[DepGraph]: Phase 1: Identifying all declarations in [${target_modules.join(', ')}]...`, "info");

    for (const moduleName of target_modules) {
        try {
            const completeResponse = await sendCommandToPursIde({
                command: "complete",
                params: { filters: [{ filter: "modules", params: { modules: [moduleName] } }], matcher: {}, options: { maxResults: MAX_RESULTS_COMPLETIONS_FOR_GRAPH, groupReexports: false } }
            });
            if (completeResponse.resultType === "success" && Array.isArray(completeResponse.result)) {
                completeResponse.result.forEach(decl => {
                    if (decl.definedAt && decl.definedAt.name) {
                        const declId = getDeclarationId(decl);
                        if (!graphNodesMap.has(declId)) {
                            const node = {
                                id: declId, module: decl.module, identifier: decl.identifier, type: decl.type,
                                declarationType: decl.declarationType, definedAt: decl.definedAt,
                                filePath: path.relative(pursIdeProjectPath || process.cwd(), decl.definedAt.name), usedBy: []
                            };
                            graphNodesMap.set(declId, node);
                            graphNodesList.push(node);
                        }
                    }
                });
            } else {
                logToStderr(`[DepGraph]: Could not get completions for module ${moduleName}: ${JSON.stringify(completeResponse.result)}`, "warn");
            }
        } catch (error) {
            logToStderr(`[DepGraph]: Error fetching completions for module ${moduleName}: ${error.message}`, "error");
        }
    }
    logToStderr(`[DepGraph]: Identified ${graphNodesList.length} declarations with source locations.`, "info");
    logToStderr(`[DepGraph]: Phase 2: Identifying dependencies...`, "info");

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
                    command: "usages", params: { module: sourceDeclNode.module, identifier: sourceDeclNode.identifier, namespace: namespace }
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
                                        if(qmNodeCap) callerModuleName = qmNodeCap.node.text.replace(/\\s+/g, "");
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
                                            if (!existingCaller.usagesAt.some(ud => ud.file === usageDetail.file && ud.moduleName === usageDetail.moduleName && ud.declarationName === usageDetail.declarationName && ud.startLine === usageDetail.startLine && ud.startCol === usageDetail.startCol && ud.endLine === usageDetail.endLine && ud.endCol === usageDetail.endCol)) {
                                                existingCaller.usagesAt.push(usageDetail);
                                            }
                                        }
                                    } else {
                                         logToStderr(`[DepGraph]: Could not extract caller module/id for usage in ${relativeFilePath} at L${usageLocation.start[0]}. CallerName: ${callerIdentifierName}, CallerModule: ${callerModuleName}`, "warn");
                                    }
                                }
                            });
                        } catch (fileReadError) {
                            logToStderr(`[DepGraph]: Error reading/parsing file ${absoluteFilePath}: ${fileReadError.message}`, "error");
                        }
                    }
                } else if (usagesResponse.resultType === "error") {
                    // logToStderr(`[DepGraph]: Could not get usages for ${sourceDeclNode.id}: ${JSON.stringify(usagesResponse.result)}`, "warn");
                }
            } catch (error) {
                logToStderr(`[DepGraph]: Error processing usages for ${sourceDeclNode.id}: ${error.message}`, "error");
            } finally {
                activePromises--;
                processedDeclarations++;
                if (processedDeclarations % 10 === 0 || processedDeclarations === graphNodesList.length) {
                    logToStderr(`[DepGraph]: Processed ${processedDeclarations}/${graphNodesList.length} declarations for usages...`, "debug");
                }
            }
        };
        processUsageQueue.push(taskFn);

        // Simple concurrent execution
        while(processUsageQueue.length > 0 || activePromises > 0) {
            while(processUsageQueue.length > 0 && activePromises < max_concurrent_requests) {
                const taskToRun = processUsageQueue.shift();
                if (taskToRun) taskToRun(); // Fire and forget for concurrency
            }
            await delay(50); // Yield if concurrency limit reached or queue empty but promises active
        }
    }
    logToStderr(`[DepGraph]: Dependency graph generation complete.`, "info");
    return { graph_nodes: graphNodesList };
}


// --- Main Stdio Processing Logic ---
const toolHandlers = {
    "get_manifest": handleGetManifest,
    "get_server_status": handleGetServerStatus,
    "echo": handleEcho,
    "query_purescript_ast": handleQueryPurescriptAst,
    "start_purs_ide_server": handleStartPursIdeServer,
    "stop_purs_ide_server": handleStopPursIdeServer,
    "query_purs_ide": handleQueryPursIde,
    "generate_dependency_graph": handleGenerateDependencyGraph
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false // Ensures it doesn't try to use terminal features
});

rl.on('line', async (line) => {
    let request;
    try {
        request = JSON.parse(line);
    } catch (e) {
        process.stdout.write(JSON.stringify({ status: "error", error: { message: "Invalid JSON input.", details: e.message } }) + '\\n');
        return;
    }

    const { toolName, args, requestId } = request; // requestId is optional, for client tracking

    if (!toolName || typeof toolName !== 'string') {
        process.stdout.write(JSON.stringify({ status: "error", error: { message: "Missing or invalid 'toolName'." }, requestId }) + '\\n');
        return;
    }

    const handler = toolHandlers[toolName];
    if (!handler) {
        process.stdout.write(JSON.stringify({ status: "error", error: { message: `Tool '${toolName}' not found.` }, requestId }) + '\\n');
        return;
    }

    try {
        const result = await handler(args || {});
        process.stdout.write(JSON.stringify({ status: "success", result, requestId }) + '\\n');
    } catch (e) {
        logToStderr(`Error executing tool '${toolName}': ${e.message}${e.stack ? '\\nStack: ' + e.stack : ''}`, 'error');
        process.stdout.write(JSON.stringify({ status: "error", error: { message: e.message, details: e.stack }, requestId }) + '\\n');
    }
});

rl.on('close', () => {
    logToStderr("Stdin closed. Exiting.", "info");
    if (pursIdeProcess) {
        logToStderr("Stopping active purs ide server due to stdin close.", "warn");
        pursIdeProcess.kill();
        pursIdeProcess = null;
    }
    process.exit(0);
});

async function main() {
    logToStderr("PureScript MCP Stdio Server starting...", "info");
    await initializeTreeSitterParser();
    logToStderr("Ready to process commands from stdin.", "info");
}

main();
