const { Parser, Language, Query } = require('web-tree-sitter');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const chalk = require('chalk');
const fs = require('fs').promises;
const readline = require('readline');

// --- Tree-sitter PureScript Parser State ---
let PureScriptLanguage;
let purescriptTsParser;
let treeSitterInitialized = false;

// --- purs ide Server State ---
let pursIdeProcess = null;
let pursIdeServerPort = null;
let pursIdeProjectPath = null;
let pursIdeIsReady = false;
let pursIdeLogBuffer = [];
const MAX_IDE_LOG_BUFFER = 200;

// --- Constants for Dependency Graph ---
const MAX_RESULTS_COMPLETIONS_FOR_GRAPH = 10000;
const ENCLOSING_DECL_QUERY_SOURCE = `(function name: (_) @name) @decl ;; Covers top-level bindings and functions`;
const MODULE_NAME_QUERY_SOURCE = "(purescript name: (qualified_module) @qmodule.name_node)";
let ENCLOSING_DECL_TS_QUERY;
let MODULE_NAME_TS_QUERY;

// --- Server Info and Capabilities (MCP Standard) ---
const SERVER_INFO = {
    name: 'purescript-tools-mcp',
    version: '1.1.0', // Updated version for stdio protocol change
    description: 'Provides tools for PureScript development tasks via stdio MCP.'
};

// Fix: Update SERVER_CAPABILITIES declaration
const SERVER_CAPABILITIES = {
    resources: {}, // Empty if no resources
    tools: {}, // Tools are listed by tools/list, not in capabilities directly for full definitions
    resourceTemplates: {} // Empty if no resource templates
};

// --- Logging ---
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
    process.stderr.write(coloredMessage + '\n');
}

function logPursIdeOutput(data, type = 'stdout') {
    const message = data.toString().trim();
    const logType = type === 'stderr' ? 'error' : 'info';
    logToStderr(`[purs ide ${type}]: ${message}`, logType);
    pursIdeLogBuffer.push(`[${type}] ${message}`);
    if (pursIdeLogBuffer.length > MAX_IDE_LOG_BUFFER) pursIdeLogBuffer.shift();
}

// --- Initialization ---
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
    }
}

// --- Helper Functions (unchanged) ---
function getNamespaceForDeclaration(declarationType) { /* ... */ }
function getDeclarationId(decl) { /* ... */ }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Helper to get code from input args (filePath or code string)
async function getCodeFromInput(args, isModuleOriented = true) {
    if (isModuleOriented) {
        const hasFilePath = args && typeof args.filePath === 'string';
        const hasCode = args && typeof args.code === 'string';

        if ((hasFilePath && hasCode) || (!hasFilePath && !hasCode)) {
            throw new Error("Invalid input: Exactly one of 'filePath' or 'code' must be provided for module-oriented tools.");
        }
        if (hasFilePath) {
            try {
                return await fs.readFile(args.filePath, 'utf-8');
            } catch (e) {
                throw new Error(`Failed to read file at ${args.filePath}: ${e.message}`);
            }
        }
        return args.code;
    } else { // Snippet-oriented
        if (!args || typeof args.code !== 'string') {
            throw new Error("Invalid input: 'code' (string) is required for snippet-oriented tools.");
        }
        return args.code;
    }
}

// (Full implementations for getNamespaceForDeclaration and getDeclarationId are kept from previous version)
getNamespaceForDeclaration = function(declarationType) {
  switch (declarationType) {
    case "value": case "valueoperator": case "dataconstructor": return "value";
    case "type": case "typeoperator": case "synonym": case "typeclass": return "type";
    case "kind": return "kind";
    default: return null;
  }
};
getDeclarationId = function(decl) {
  if (!decl || !decl.module || !decl.identifier) return `unknown.${Date.now()}.${Math.random()}`;
  return `${decl.module}.${decl.identifier}`;
};


// --- `purs ide` Communication & Management (largely unchanged) ---
function sendCommandToPursIde(commandPayload) {
    return new Promise((resolve, reject) => {
        if (!pursIdeProcess || !pursIdeIsReady || !pursIdeServerPort) {
            return reject(new Error("purs ide server is not running or not ready."));
        }
        const client = new net.Socket();
        let responseData = '';
        client.connect(pursIdeServerPort, '127.0.0.1', () => {
            logToStderr(`[MCP Client->purs ide]: Sending command: ${JSON.stringify(commandPayload).substring(0,100)}...`, 'debug');
            client.write(JSON.stringify(commandPayload) + '\n');
        });
        client.on('data', (data) => {
            responseData += data.toString();
            if (responseData.includes('\n')) {
                 const completeResponses = responseData.split('\n').filter(Boolean);
                 responseData = ''; 
                 if (completeResponses.length > 0) {
                    try {
                        resolve(JSON.parse(completeResponses[0].trim()));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON response from purs ide: ${e.message}. Raw: ${completeResponses[0]}`));
                    }
                 }
                 client.end(); 
            }
        });
        client.on('end', () => {
            if (responseData.trim()) {
                 try { resolve(JSON.parse(responseData.trim())); } 
                 catch (e) { reject(new Error(`Failed to parse JSON response from purs ide on end: ${e.message}. Raw: ${responseData}`));}
            }
        });
        client.on('close', () => { logToStderr(`[MCP Client->purs ide]: Connection closed.`, 'debug'); });
        client.on('error', (err) => reject(new Error(`TCP connection error with purs ide server: ${err.message}`)));
    });
}

// --- Internal Tool Handlers (adapted from previous version) ---
// These functions now expect 'args' to be the 'params' or 'arguments' object from the 'tools/call' request.
// Updated to return MCP standard response format { content: [{type: "text", text: ...}] }

async function internalHandleGetServerStatus() {
    const statusResponse = {
        status: 'running', // Overall server status
        purescript_tools_mcp_version: SERVER_INFO.version,
        treeSitterInitialized,
        purs_ide_server_status: { // Renamed for clarity and to match test assertion expectation
            status: pursIdeProcess ? (pursIdeIsReady ? 'ready' : 'starting') : (pursIdeServerPort ? 'stopped' : 'not_started'),
            running: !!pursIdeProcess, // Keep this for direct boolean check if needed
            ready: pursIdeIsReady,
            port: pursIdeServerPort,
            projectPath: pursIdeProjectPath,
            recentLogs: pursIdeLogBuffer.slice(-10)
        }
    };
    return { content: [{ type: "text", text: JSON.stringify(statusResponse, null, 2) }] };
}

async function internalHandleEcho(args) {
    if (!args || typeof args.message !== 'string') {
        throw new Error("Invalid input. 'message' (string) is required.");
    }
    return { content: [{ type: "text", text: `Echo: ${args.message}` }] };
}

async function internalHandleQueryPurescriptAst(args) {
    if (!treeSitterInitialized || !PureScriptLanguage || !purescriptTsParser) {
        throw new Error("Tree-sitter PureScript grammar/parser not loaded.");
    }
    if (!args || typeof args.purescript_code !== 'string' || typeof args.tree_sitter_query !== 'string') {
        throw new Error("Invalid input: 'purescript_code' and 'tree_sitter_query' (strings) are required.");
    }
    const tree = purescriptTsParser.parse(args.purescript_code);
    const query = new Query(PureScriptLanguage, args.tree_sitter_query);
    const captures = query.captures(tree.rootNode);
    const results = captures.map(capture => ({ 
        name: capture.name, 
        text: capture.node.text 
    }));
    return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
}

async function internalHandleStartPursIdeServer(args) {
    if (pursIdeProcess) {
        logToStderr("Stopping existing purs ide server before starting a new one.", "warn");
        pursIdeProcess.kill(); 
        pursIdeProcess = null; 
        pursIdeIsReady = false;
    }

    if (!args.project_path || typeof args.project_path !== 'string') {
        throw new Error("Invalid input: 'project_path' (string) is required for start_purs_ide_server.");
    }
    pursIdeServerPort = args.port || 4242;
    pursIdeProjectPath = path.resolve(args.project_path); // Removed default process.cwd()
    const outputDir = args.output_directory || "output/";
    const sourceGlobs = args.source_globs || ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"];
    const logLevel = args.log_level || "none";
    pursIdeLogBuffer = [];
    // Reverted to pass sourceGlobs directly as arguments
    const cmdArgs = ['ide', 'server', '--port', pursIdeServerPort.toString(), '--output-directory', outputDir, '--log-level', logLevel, ...sourceGlobs];
    const fullCommand = `npx purs ${cmdArgs.join(' ')}`;
    logToStderr(`Spawning '${fullCommand}' in CWD: ${pursIdeProjectPath}`, "info");
    
    return new Promise((resolve, reject) => {
        pursIdeProcess = spawn('npx', ['purs', ...cmdArgs], { cwd: pursIdeProjectPath, shell: true });
        pursIdeIsReady = false;
        pursIdeProcess.stdout.on('data', (data) => logPursIdeOutput(data, 'stdout'));
        pursIdeProcess.stderr.on('data', (data) => logPursIdeOutput(data, 'stderr'));
        pursIdeProcess.on('error', (err) => {
            logPursIdeOutput(`Failed to start purs ide server: ${err.message}`, 'error');
            pursIdeProcess = null;
            reject(new Error(`Failed to start purs ide server: ${err.message}`)); // This error will be caught by handleMcpRequest
        });
        pursIdeProcess.on('close', (code) => {
            logPursIdeOutput(`purs ide server process exited with code ${code}`, code === 0 ? 'info' : 'error');
            if (pursIdeProcess) { 
                pursIdeProcess = null; 
                pursIdeIsReady = false; 
            }
        });
        setTimeout(async () => {
            try {
                logToStderr("Attempting initial 'load' command to purs ide server...", "info");
                pursIdeIsReady = true;
                const loadResult = await sendCommandToPursIde({ command: "load", params: {} });
                logToStderr("Initial 'load' command to purs ide server successful.", "info");
                const result = {
                    status_message: "purs ide server started and initial load attempted.",
                    command_executed: fullCommand,
                    port: pursIdeServerPort,
                    project_path: pursIdeProjectPath,
                    initial_load_result: loadResult,
                    logs: pursIdeLogBuffer.slice(-20)
                };
                resolve({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
            } catch (error) {
                pursIdeIsReady = false;
                logToStderr(`Error during initial 'load' to purs ide server: ${error.message}`, "error");
                if(pursIdeProcess) { 
                    pursIdeProcess.kill(); 
                    pursIdeProcess = null; 
                }
                reject(new Error(`purs ide server started but initial load command failed: ${error.message}`)); // This error will be caught by handleMcpRequest
            }
        }, 3000);
    });
}

async function internalHandleStopPursIdeServer() {
    let message;
    if (pursIdeProcess) {
        pursIdeProcess.kill(); 
        pursIdeProcess = null; 
        pursIdeIsReady = false;
        logPursIdeOutput("purs ide server stopped by MCP.", "info");
        message = "purs ide server stopped.";
    } else {
        message = "No purs ide server was running.";
    }
    return { content: [{ type: "text", text: JSON.stringify({ status_message: message }, null, 2) }] };
}

async function internalHandleQueryPursIde(args) {
    if (!pursIdeProcess || !pursIdeIsReady) {
        throw new Error("purs ide server is not running or not ready. Please start it first.");
    }
    if (!args || typeof args.purs_ide_command !== 'string') {
        throw new Error("Invalid input. 'purs_ide_command' (string) is required.");
    }
    const result = await sendCommandToPursIde({ 
        command: args.purs_ide_command, 
        params: args.purs_ide_params || {} 
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

async function internalHandleGenerateDependencyGraph(args) {
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
        while(processUsageQueue.length > 0 || activePromises > 0) {
            while(processUsageQueue.length > 0 && activePromises < max_concurrent_requests) {
                const taskToRun = processUsageQueue.shift();
                if (taskToRun) taskToRun();
            }
            await delay(50);
        }
    }
    logToStderr(`[DepGraph]: Dependency graph generation complete.`, "info");
    const result = { graph_nodes: graphNodesList }; // graphNodesList is already the result
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}


// --- Tool Definitions for 'tools/list' ---
// Updated based on user feedback
const TOOL_DEFINITIONS = [
    {
        name: "get_server_status", 
        description: "Returns the current status of the server and its components.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "echo",
        description: "Echoes back the input string.",
        inputSchema: { type: "object", properties: { message: { type: "string"}}, required: ["message"], additionalProperties: false },
    },
    {
        name: "query_purescript_ast",
        description: "[DEPRECATED] Parses PureScript code and executes a Tree-sitter query against its AST. Prefer specific AST query tools.",
        inputSchema: { type: "object", properties: { purescript_code: { type: "string" }, tree_sitter_query: { type: "string" }}, required: ["purescript_code", "tree_sitter_query"], additionalProperties: false },
    },
    // --- Phase 1: Core AST Query Tools ---
    // Module Information
    {
        name: "getModuleName",
        description: "Extracts the module name from a PureScript file or code string.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Absolute path to the PureScript file." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    {
        name: "getImports",
        description: "Retrieves all import statements with module and submodule information.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Absolute path to the PureScript file." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    {
        name: "getTopLevelDeclarationNames",
        description: "Extracts the names of all top-level declarations (functions, data types, type classes, etc.) from a PureScript file or code string.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Absolute path to the PureScript file." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    // Function and Value Declarations
    {
        name: "getFunctionNames",
        description: "Gets all function names defined in the code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getTypeSignatures",
        description: "Extracts function type signatures from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getLetBindings",
        description: "Finds variables bound in let expressions from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    // Data Types and Type Classes
    {
        name: "getDataTypes",
        description: "Extracts data type declarations from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getTypeClasses",
        description: "Gets type class declarations from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getInstances",
        description: "Finds type class instances from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getTypeAliases",
        description: "Extracts type alias declarations from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    // Expressions and Literals
    {
        name: "getStringLiterals",
        description: "Finds all string literals in a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getIntegerLiterals",
        description: "Extracts all integer literals from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getVariableReferences",
        description: "Gets all variable names used in expressions in a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getRecordFields",
        description: "Extracts record field information from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    // Control Flow Analysis
    {
        name: "getCasePatterns",
        description: "Analyzes case expression patterns from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getDoBindings",
        description: "Finds variable bindings in do blocks from a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getWhereBindings",
        description: "Extracts function names from where clauses in a code snippet.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    // End of Phase 1 tools
    {
        name: "start_purs_ide_server",
        description: "Starts a purs ide server process. Manages one server instance at a time.",
        inputSchema: {
            type: "object",
            properties: {
                project_path: { type: "string", description: "Absolute or relative path to the PureScript project directory." },
                port: { type: "integer", default: 4242 },
                output_directory: { type: "string", default: "output/" },
                source_globs: { type: "array", items: { type: "string" }, default: ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"]},
                log_level: { type: "string", enum: ["all", "debug", "perf", "none"], default: "none" }
            },
            required: ["project_path"],
            additionalProperties: false
        },
    },
    {
        name: "stop_purs_ide_server",
        description: "Stops the currently managed purs ide server process.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "query_purs_ide",
        description: "Sends a command to the currently running purs ide server.",
        inputSchema: { type: "object", properties: { purs_ide_command: { type: "string" }, purs_ide_params: { type: "object" }}, required: ["purs_ide_command"], additionalProperties: false },
    },
    {
        name: "generate_dependency_graph",
        description: "Generates a dependency graph for specified PureScript modules.",
        inputSchema: {
            type: "object",
            properties: {
                target_modules: { type: "array", items: { type: "string" }, description: "Array of module names." },
                max_concurrent_requests: { type: "integer", description: "Max concurrent 'usages' requests.", default: 5 }
            },
            required: ["target_modules"],
            additionalProperties: false
        },
    },
    // --- purs ide direct command wrappers ---
    {
        name: "pursIdeLoad",
        description: "Loads modules into the purs ide server. Typically the first command after server start.",
        inputSchema: {
            type: "object",
            properties: {
                modules: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "Optional: specific modules to load. If omitted, attempts to load all compiled modules."
                }
            },
            additionalProperties: false
        }
    },
    {
        name: "pursIdeType",
        description: "Looks up the type of a given identifier using purs ide server.",
        inputSchema: {
            type: "object",
            properties: {
                search: { type: "string", description: "Identifier name to search for." },
                filters: { type: "array", items: { type: "object" }, description: "Optional: Array of Filter objects." },
                currentModule: { type: "string", description: "Optional: Current module context." }
            },
            required: ["search"],
            additionalProperties: false
        }
    },
    {
        name: "pursIdeCwd",
        description: "Gets the current working directory of the purs ide server.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeReset",
        description: "Clears loaded modules in the purs ide server.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeQuit",
        description: "Requests the purs ide server to quit and stops the managed process.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeRebuild",
        description: "Provides a fast rebuild for a single module using purs ide server.",
        inputSchema: {
            type: "object",
            properties: {
                file: { type: "string", description: "Path to the module to rebuild, or 'data:' prefixed source code." },
                actualFile: { type: "string", description: "Optional: Real path if 'file' is 'data:' or a temp file." },
                codegen: { type: "array", items: { type: "string" }, description: "Optional: Codegen targets (e.g., 'js', 'corefn'). Defaults to ['js']." }
            },
            required: ["file"],
            additionalProperties: false
        }
    },
    {
        name: "pursIdeUsages",
        description: "Finds all usages of a uniquely identified declaration using purs ide server.",
        inputSchema: {
            type: "object",
            properties: {
                module: { type: "string", description: "Module where the identifier is defined." },
                namespace: { type: "string", enum: ["value", "type", "kind"], description: "Namespace of the identifier." },
                identifier: { type: "string", description: "The identifier to find usages for." }
            },
            required: ["module", "namespace", "identifier"],
            additionalProperties: false
        }
    },
    {
        name: "pursIdeList",
        description: "Lists available modules or imports for a file using purs ide server.",
        inputSchema: {
            type: "object",
            properties: {
                listType: { type: "string", enum: ["availableModules", "import"], description: "Type of list to retrieve." },
                file: { type: "string", description: "Path to the .purs file (required for 'import' listType)." }
            },
            required: ["listType"],
            additionalProperties: false
        }
    }
];

// SERVER_CAPABILITIES.tools should remain an empty object {}
// The client will use 'tools/list' to get the full definitions.

// Map internal tool names to their handlers
const INTERNAL_TOOL_HANDLERS = {
    "get_server_status": internalHandleGetServerStatus,
    "echo": internalHandleEcho,
    "query_purescript_ast": internalHandleQueryPurescriptAst,
    "start_purs_ide_server": internalHandleStartPursIdeServer,
    "stop_purs_ide_server": internalHandleStopPursIdeServer,
    "query_purs_ide": internalHandleQueryPursIde,
    "generate_dependency_graph": internalHandleGenerateDependencyGraph,
    // --- Phase 1: Core AST Query Tool Handlers (to be added) ---
    "getModuleName": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, true);
        const tree = purescriptTsParser.parse(code);
        // Corrected query to capture the full text of the qualified_module node
        const query = new Query(PureScriptLanguage, `(purescript name: (qualified_module) @module.qname)`);
        const captures = query.captures(tree.rootNode);
        if (captures.length > 0 && captures[0].name === 'module.qname') {
            // The text of the qualified_module node itself is the full module name
            return { content: [{ type: "text", text: JSON.stringify(captures[0].node.text.replace(/\s+/g, ''), null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(null, null, 2) }] };
    },
    "getFunctionNames": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const query = new Query(PureScriptLanguage, `(function name: (variable) @func.name)`);
        const captures = query.captures(tree.rootNode);
        const functionNames = captures.map(capture => capture.node.text);
        return { content: [{ type: "text", text: JSON.stringify(functionNames, null, 2) }] };
    },
    // Stubs for other Phase 1 handlers - to be implemented
    "getImports": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, true);
        const tree = purescriptTsParser.parse(code);
        const query = new Query(PureScriptLanguage, `(import module: (qualified_module) @import.path)`);
        const captures = query.captures(tree.rootNode);
        
        const imports = [];
        for (const capture of captures) {
            if (capture.name === 'import.path') {
                const moduleNodes = capture.node.children.filter(child => child.type === 'module');
                if (moduleNodes.length > 0) {
                    const fullPath = moduleNodes.map(n => n.text).join('.');
                    const moduleName = moduleNodes[0].text;
                    const submoduleName = moduleNodes.length > 1 ? moduleNodes[1].text : undefined;
                    imports.push({
                        module: moduleName,
                        submodule: submoduleName,
                        fullPath: fullPath
                    });
                }
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(imports, null, 2) }] };
    },
    "getTopLevelDeclarationNames": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, true); // true for module-oriented
        const tree = purescriptTsParser.parse(code);
        const querySource = `
[
  (function name: (variable) @name)
  (data name: (type) @name)
  (class_declaration (class_head (class_name (type) @name)))
  (type_alias name: (type) @name)
  (foreign_import name: (variable) @name)
  (signature name: (variable) @name)
  (class_instance (instance_name) @name)
  (kind_value_declaration name: (type) @name)
]
`;
        const query = new Query(PureScriptLanguage, querySource);
        const captures = query.captures(tree.rootNode);
        const declarationNames = captures.map(capture => capture.node.text).filter(Boolean);
        // Deduplicate names
        const uniqueNames = [...new Set(declarationNames)];
        return { content: [{ type: "text", text: JSON.stringify(uniqueNames, null, 2) }] };
    },
    "getTypeSignatures": async (args) => {
    if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
    const code = await getCodeFromInput(args, false);
    const tree = purescriptTsParser.parse(code);
    
    // Query to capture the full text of signature nodes
    const querySource = `((signature) @full_signature)`; 
    const query = new Query(PureScriptLanguage, querySource);
    // Use query.captures() for named captures as we are interested in the named capture @full_signature
    const captures = query.captures(tree.rootNode);

    const typeSignatures = captures.map(capture => {
        // Ensure we are processing the intended capture
        if (capture.name === 'full_signature') { 
            return capture.node.text.trim(); // Get the full text of the signature node
        }
        return null;
    }).filter(Boolean); // Filter out any nulls if other (unexpected) captures were included
    
    return { content: [{ type: "text", text: JSON.stringify(typeSignatures, null, 2) }] };
},
    "getLetBindings": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const letBindings = [];

        // Query for 'let ... in ...' expressions
        const letInQuery = new Query(PureScriptLanguage, `(exp_let_in (declarations (function name: (variable) @let.name)))`);
        const letInCaptures = letInQuery.captures(tree.rootNode);
        letInCaptures.forEach(capture => {
            if (capture.name === 'let.name') {
                letBindings.push({ name: capture.node.text, context: "let" });
            }
        });

        // Query for 'let' statements in 'do' blocks
        const doLetQuery = new Query(PureScriptLanguage, `(statement (let (declarations (function name: (variable) @do.let.name))))`);
        const doLetCaptures = doLetQuery.captures(tree.rootNode);
        doLetCaptures.forEach(capture => {
            if (capture.name === 'do.let.name') {
                letBindings.push({ name: capture.node.text, context: "do-let" });
            }
        });
        
        return { content: [{ type: "text", text: JSON.stringify(letBindings, null, 2) }] };
    },
    "getDataTypes": async (args) => {
    if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
    const code = await getCodeFromInput(args, false);
    const tree = purescriptTsParser.parse(code);
    
    // Single query to find all data declarations with their components
    // ... inside getDataTypes

// Query for the entire data declaration block
    const query = new Query(PureScriptLanguage, `
        (data
        name: (type) @type_name
        ) @data_declaration_block
    `);

    const matches = query.matches(tree.rootNode);
    const dataTypes = [];

    for (const match of matches) {
        let typeName = null;
        let dataDeclarationNode = null;

        // Find the type name and the data declaration block node
        for (const capture of match.captures) {
            if (capture.name === 'type_name') {
                typeName = capture.node.text;
            }
            if (capture.name === 'data_declaration_block') {
                dataDeclarationNode = capture.node;
            }
        }

        if (typeName && dataDeclarationNode) {
            const constructors = [];
            // Now, traverse the children of the dataDeclarationNode to find constructors
            for (const child of dataDeclarationNode.children) {
                if (child.type === 'constructor') {
                    constructors.push(child.text);
                }
            }
            dataTypes.push({
                name: typeName,
                constructors: constructors.sort()
            });
        }
    }

    return { content: [{ type: "text", text: JSON.stringify(dataTypes, null, 2) }] };
},
    "getTypeClasses": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const typeClasses = [];
        
        const query = new Query(PureScriptLanguage, `
            (class_declaration
              (class_head
                (class_name (type) @class.name)
                (type_variable)* @type.param
              )
            )
        `); 
        
        const matches = query.matches(tree.rootNode);
        matches.forEach(match => {
            let currentClassName = null;
            const currentParams = [];
            match.captures.forEach(cap => {
                if (cap.name === 'class.name') {
                    currentClassName = cap.node.text;
                } else if (cap.name === 'type.param') {
                    currentParams.push(cap.node.text);
                }
            });
            if (currentClassName) {
                typeClasses.push({
                    name: currentClassName,
                    typeParameter: currentParams.join(' ') || undefined
                });
            }
        });
        
        return { content: [{ type: "text", text: JSON.stringify(typeClasses, null, 2) }] };
    },
    "getInstances": async (args) => {
         if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const instances = [];
       
    const query = new Query(PureScriptLanguage, `
        (class_instance
            (instance_name)? @instance.name
            (instance_head
                (class_name) @instance.class
                (type_name)? @instance.type
            )
        )
    `);

        const matches = query.matches(tree.rootNode);

        for (const match of matches) {
            let instance = {
                name: undefined, 
                className: null,
                type: undefined
            };
            for (const capture of match.captures) {
                const node = capture.node;
                const captureName = capture.name;

                if (captureName === 'instance.name') {
                    instance.name = node.text.trim();
                } else if (captureName === 'instance.class') {
                    instance.className = node.text.trim();
                } else if (captureName === 'instance.type') {
                    instance.type = node.text.trim();
                }
            }
            if (instance.className) { 
                instances.push(instance);
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(instances, null, 2) }] };
    },
    "getTypeAliases": async (args) => { 
        if (!treeSitterInitialized) {
            throw new Error("Tree-sitter not initialized.");
        }
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const typeAliasesTexts = [];
    
        const query = new Query(PureScriptLanguage, `(type_alias) @alias_declaration`);
        const matches = query.matches(tree.rootNode);
    
        for (const match of matches) {
            const aliasNodeCapture = match.captures.find(c => c.name === 'alias_declaration');
            if (aliasNodeCapture) {
                 typeAliasesTexts.push(aliasNodeCapture.node.text.trim()); 
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(typeAliasesTexts, null, 2) }] };
    },
    "getStringLiterals": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const stringLiterals = [];
        
        const query = new Query(PureScriptLanguage, `(string) @string.literal`);
        const captures = query.captures(tree.rootNode);
        
        captures.forEach(capture => {
            if (capture.name === 'string.literal') {
                // Remove surrounding quotes
                let text = capture.node.text;
                if (text.startsWith('"') && text.endsWith('"')) {
                    text = text.substring(1, text.length - 1);
                } else if (text.startsWith('"""') && text.endsWith('"""')) {
                    text = text.substring(3, text.length - 3);
                }
                stringLiterals.push(text);
            }
        });
        return { content: [{ type: "text", text: JSON.stringify(stringLiterals, null, 2) }] };
    },
    "getIntegerLiterals": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const integerLiterals = [];

        const query = new Query(PureScriptLanguage, `(integer) @integer.literal`);
        const captures = query.captures(tree.rootNode);

        captures.forEach(capture => {
            if (capture.name === 'integer.literal') {
                integerLiterals.push(parseInt(capture.node.text, 10));
            }
        });
        return { content: [{ type: "text", text: JSON.stringify(integerLiterals, null, 2) }] };
    },
    "getVariableReferences": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const variableReferences = [];
        
        const query = new Query(PureScriptLanguage, `(exp_name (variable) @var)`);
        const captures = query.captures(tree.rootNode);
        
        captures.forEach(capture => {
            if (capture.name === 'var') {
                variableReferences.push(capture.node.text);
            }
        });
        // Deduplicate
        return { content: [{ type: "text", text: JSON.stringify([...new Set(variableReferences)], null, 2) }] };
    },
    "getRecordFields": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const recordFields = [];

        // Record literal fields
        const literalQuery = new Query(PureScriptLanguage, `(record_field (field_name) @field.name.literal)`);
        const literalCaptures = literalQuery.captures(tree.rootNode);
        literalCaptures.forEach(capture => {
            if (capture.name === 'field.name.literal') {
                recordFields.push({ name: capture.node.text, context: "literal" });
            }
        });

        // Record type fields
        const typeQuery = new Query(PureScriptLanguage, `(row_field (field_name) @field.name.type)`);
        const typeCaptures = typeQuery.captures(tree.rootNode);
        typeCaptures.forEach(capture => {
            if (capture.name === 'field.name.type') {
                recordFields.push({ name: capture.node.text, context: "type" });
            }
        });
        
        // Deduplicate based on name and context
        const uniqueFields = [];
        const seen = new Set();
        for (const field of recordFields) {
            const key = `${field.name}|${field.context}`;
            if (!seen.has(key)) {
                uniqueFields.push(field);
                seen.add(key);
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(uniqueFields, null, 2) }] };
    },
    "getCasePatterns": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const casePatternsTexts = [];
    
        const query = new Query(PureScriptLanguage, `(alt pat: (_) @pattern_node)`);
        const matches = query.matches(tree.rootNode);
    
        for (const match of matches) {
            const patternNodeCapture = match.captures.find(c => c.name === 'pattern_node');
            if (patternNodeCapture) {
                casePatternsTexts.push(patternNodeCapture.node.text.trim());
            }
        }
        return { content: [{ type: "text", text: JSON.stringify(casePatternsTexts, null, 2) }] };
    },
    "getDoBindings": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const doBindings = [];

        // Query for '<-' bindings
        const bindQuery = new Query(PureScriptLanguage, `(bind_pattern (pat_name (variable) @do.binding))`);
        const bindCaptures = bindQuery.captures(tree.rootNode);
        bindCaptures.forEach(capture => {
            if (capture.name === 'do.binding') {
                doBindings.push({ variable: capture.node.text, bindingType: "bind" });
            }
        });

        // Query for 'let' statements in 'do' blocks
        const doLetQuery = new Query(PureScriptLanguage, `(statement (let (declarations (function name: (variable) @do.let.name))))`);
        const doLetCaptures = doLetQuery.captures(tree.rootNode);
        doLetCaptures.forEach(capture => {
            if (capture.name === 'do.let.name') {
                 // Ensure this 'let' is within a 'do' block context if possible, though the query is fairly specific.
                 // For now, assume this query correctly targets 'let' in 'do'.
                doBindings.push({ variable: capture.node.text, bindingType: "let" });
            }
        });
        
        return { content: [{ type: "text", text: JSON.stringify(doBindings, null, 2) }] };
    },
    "getWhereBindings": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false);
        const tree = purescriptTsParser.parse(code);
        const whereBindingNames = [];
    
        const query = new Query(PureScriptLanguage, `(where) (declarations (function name: (variable) @binding_name))`);
        const matches = query.matches(tree.rootNode);
    
        for (const match of matches) {
            const bindingNameCapture = match.captures.find(c => c.name === 'binding_name');
            if (bindingNameCapture) {
                whereBindingNames.push(bindingNameCapture.node.text.trim());
            }
        }
        // Deduplicate if necessary, though the query structure might already handle it per 'where' block.
        // For simplicity, returning as is, assuming test will handle order/duplicates if they arise.
        return { content: [{ type: "text", text: JSON.stringify([...new Set(whereBindingNames)], null, 2) }] };
    },
    // --- New purs ide command wrapper handlers ---
    "pursIdeLoad": async (args) => {
        const params = args || {}; // If args is null/undefined, pass empty object for default load all
        const result = await sendCommandToPursIde({ command: "load", params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeType": async (args) => {
        if (!args || typeof args.search !== 'string') {
            throw new Error("Invalid input: 'search' (string) is required for pursIdeType.");
        }
        const params = {
            search: args.search,
            filters: args.filters || [], // Default to empty filters array
            currentModule: args.currentModule
        };
        const result = await sendCommandToPursIde({ command: "type", params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeCwd": async () => {
        const result = await sendCommandToPursIde({ command: "cwd" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeReset": async () => {
        const result = await sendCommandToPursIde({ command: "reset" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeQuit": async () => {
        let quitMessage = "purs ide server quit command initiated.";
        let pursIdeResponded = false;

        if (pursIdeProcess && pursIdeIsReady) {
            logToStderr("[pursIdeQuit] Attempting to send 'quit' command to purs ide server.", "debug");
            sendCommandToPursIde({ command: "quit" })
                .then(res => {
                    pursIdeResponded = true;
                    logToStderr(`[pursIdeQuit] purs ide server responded to quit command: ${JSON.stringify(res)}`, 'debug');
                })
                .catch(err => {
                    logToStderr(`[pursIdeQuit] Error/No response from purs ide server for quit command: ${err.message}`, 'warn');
                });
            
            // Wait a short period to allow purs ide server to shut down gracefully
            // or for the sendCommandToPursIde to potentially resolve/reject.
            await delay(250); // Increased slightly to 250ms
        } else {
            quitMessage = "No purs ide server was running or ready to send quit command to.";
            logToStderr("[pursIdeQuit] " + quitMessage, "info");
        }

        // Ensure our managed process is stopped regardless of purs ide's response
        if (pursIdeProcess) {
            logToStderr("[pursIdeQuit] Ensuring managed purs ide process is stopped.", "debug");
            pursIdeProcess.kill();
            pursIdeProcess = null;
            pursIdeIsReady = false;
            logPursIdeOutput("Managed purs ide server process stopped via pursIdeQuit tool.", "info");
            quitMessage += " Managed purs ide process has been stopped.";
        } else {
            if (!quitMessage.includes("No purs ide server was running")) {
                 quitMessage += " No managed purs ide process was found running to stop.";
            }
        }
        
        if (pursIdeResponded) {
            quitMessage += " purs ide server acknowledged quit.";
        } else {
            quitMessage += " purs ide server may not have acknowledged quit before process termination.";
        }

        return { content: [{ type: "text", text: JSON.stringify({ status_message: quitMessage, resultType: "success" }, null, 2) }] };
    },
    "pursIdeRebuild": async (args) => {
        if (!args || typeof args.file !== 'string') {
            throw new Error("Invalid input: 'file' (string) is required for pursIdeRebuild.");
        }
        const params = {
            file: args.file,
            actualFile: args.actualFile,
            codegen: args.codegen // purs ide server defaults to js if undefined
        };
        const result = await sendCommandToPursIde({ command: "rebuild", params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeUsages": async (args) => {
        if (!args || typeof args.module !== 'string' || typeof args.namespace !== 'string' || typeof args.identifier !== 'string') {
            throw new Error("Invalid input: 'module', 'namespace', and 'identifier' (strings) are required for pursIdeUsages.");
        }
        const params = {
            module: args.module,
            namespace: args.namespace,
            identifier: args.identifier
        };
        const result = await sendCommandToPursIde({ command: "usages", params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
    "pursIdeList": async (args) => {
        if (!args || typeof args.listType !== 'string') {
            throw new Error("Invalid input: 'listType' (string) is required for pursIdeList.");
        }
        const params = { type: args.listType };
        if (args.listType === "import") {
            if (typeof args.file !== 'string') {
                throw new Error("'file' (string) is required when listType is 'import'.");
            }
            params.file = args.file;
        }
        const result = await sendCommandToPursIde({ command: "list", params });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
};


// --- MCP Stdio Protocol Handling ---
function createSuccessResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
}

function createErrorResponse(id, code, message, data = undefined) {
    return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// Updated handleMcpRequest based on user feedback
async function handleMcpRequest(request) {
    const { method, params, id } = request;

    try {
        if (method === 'initialize') {
            logToStderr(`Received initialize request from client (id: ${id}). Params: ${JSON.stringify(params)}`, 'info');
            return createSuccessResponse(id, {
                protocolVersion: '2024-11-05',
                serverInfo: SERVER_INFO,
                capabilities: SERVER_CAPABILITIES // SERVER_CAPABILITIES.tools is now correctly an empty object
            });
        }
        
        if (method === 'initialized' || method === 'notifications/initialized') {
            logToStderr(`Received initialized notification from client. Params: ${JSON.stringify(params)}`, 'info');
            return null; 
        }
        
        if (method === 'tools/list') {
            const toolsToExclude = ['query_purescript_ast', 'query_purs_ide']; // Keep query_purs_ide for now, for direct access if needed
            const filteredToolDefinitions = TOOL_DEFINITIONS.filter(
                tool => !toolsToExclude.includes(tool.name)
            );
            return createSuccessResponse(id, { tools: filteredToolDefinitions });
        }
        
        if (method === 'tools/call') {
            if (!params || typeof params.name !== 'string') {
                return createErrorResponse(id, -32602, "Invalid params: 'name' of tool is required for tools/call.");
            }
            const toolName = params.name;
            const toolArgs = params.arguments || {};

            const handler = INTERNAL_TOOL_HANDLERS[toolName];
            if (!handler) {
                return createErrorResponse(id, -32601, `Method not found (tool): ${toolName}`);
            }
            
            const result = await handler(toolArgs); // This now returns { content: [...] }
            return createSuccessResponse(id, result); // The entire { content: [...] } is the result for tools/call
        }

        if (method === 'resources/list') {
            return createSuccessResponse(id, { resources: [] });
        }

        if (method === 'resources/templates/list') {
            return createSuccessResponse(id, { resourceTemplates: [] });
        }

        if (method === 'resources/read') {
            return createErrorResponse(id, -32601, "No resources available to read");
        }

        return createErrorResponse(id, -32601, `Method not found: ${method}`);

    } catch (error) {
        logToStderr(`Error handling MCP request (method: ${method}, id: ${id}): ${error.message}\n${error.stack}`, 'error');
        return createErrorResponse(id, -32000, `Server error: ${error.message}`, { stack: error.stack });
    }
}

// Updated rl.on('line') handler based on user feedback
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout, 
    terminal: false
});

rl.on('line', async (line) => {
    logToStderr(`Received line: ${line.substring(0, 200)}...`, 'debug');
    let request;
    try {
        if (line.trim() === '') return;
        request = JSON.parse(line);
    } catch (e) {
        const errResp = createErrorResponse(null, -32700, 'Parse error', { details: e.message, receivedLine: line });
        process.stdout.write(JSON.stringify(errResp) + '\n');
        return;
    }

    if (typeof request.method !== 'string') { 
         const errResp = createErrorResponse(request.id || null, -32600, 'Invalid Request: method must be a string.');
         process.stdout.write(JSON.stringify(errResp) + '\n');
         return;
    }
    
    const response = await handleMcpRequest(request);
    
    if (response !== null && response !== undefined) {
        process.stdout.write(JSON.stringify(response) + '\n');
        logToStderr(`Sent response for id ${response.id}: ${JSON.stringify(response).substring(0,200)}...`, 'debug');
    } else {
        logToStderr(`Handled notification (method: ${request.method}). No response sent.`, 'debug');
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

// Graceful shutdown signals
const shutdown = (signal) => {
  logToStderr(`Received ${signal}. MCP Server shutting down...`, 'info');
  if (pursIdeProcess) {
    logToStderr("Stopping active purs ide server due to shutdown signal.", "warn");
    pursIdeProcess.kill();
  }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));


async function main() {
    logToStderr("PureScript MCP Stdio Server (JSON-RPC) starting...", "info");
    await initializeTreeSitterParser();
    logToStderr("Ready to process JSON-RPC commands from stdin.", "info");
    // Server waits for the client to send the first 'initialize' request.
}

main();
