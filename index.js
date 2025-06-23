const { Parser, Language, Query } = require('web-tree-sitter');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const chalk = require('chalk');
const fs = require('fs').promises;
const readline = require('readline');

// --- Log File ---
const LOG_FILE_PATH = path.join(__dirname, 'purescript-mcp-server.log');

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
    const plainMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    // Only write to log file to avoid stdio conflicts
    fs.appendFile(LOG_FILE_PATH, plainMessage + '\n')
        .catch(err => {
            // Silently fail if file logging fails to avoid recursive stderr issues
            // Alternative: write to a different error log file if needed
        });
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

// --- Helper Functions ---
function getNamespaceForDeclaration(declarationType) { /* ... */ }
function getDeclarationId(decl) { /* ... */ }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Helper to find an available random port
function findAvailablePort(startPort = 4242, endPort = 65535) {
    return new Promise((resolve, reject) => {
        const randomPort = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
        const server = net.createServer();
        
        server.listen(randomPort, (err) => {
            if (err) {
                // Port is busy, try another random port
                server.close();
                if (randomPort === endPort) {
                    reject(new Error(`No available ports found in range ${startPort}-${endPort}`));
                } else {
                    // Try a different random port
                    resolve(findAvailablePort(startPort, endPort));
                }
            } else {
                const port = server.address().port;
                server.close(() => {
                    resolve(port);
                });
            }
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                server.close();
                // Try a different random port
                resolve(findAvailablePort(startPort, endPort));
            } else {
                reject(err);
            }
        });
    });
}

// Helper to get code from input args (filePath or code string)
async function getCodeFromInput(args, isModuleOriented = true) {
    if (isModuleOriented) {
        const hasFilePath = args && typeof args.filePath === 'string';
        const hasCode = args && typeof args.code === 'string';

        if ((hasFilePath && hasCode) || (!hasFilePath && !hasCode)) {
            throw new Error("Invalid input: Exactly one of 'filePath' or 'code' must be provided for module-oriented tools.");
        }
        if (hasFilePath) {
            let resolvedPath = args.filePath;
            try {
                if (!path.isAbsolute(resolvedPath)) {
                    if (pursIdeProjectPath) {
                        resolvedPath = path.resolve(pursIdeProjectPath, args.filePath);
                        logToStderr(`[getCodeFromInput] Resolved relative filePath "${args.filePath}" to "${resolvedPath}" using pursIdeProjectPath.`, 'debug');
                    } else {
                        resolvedPath = path.resolve(process.cwd(), args.filePath);
                        logToStderr(`[getCodeFromInput] Warning: pursIdeProjectPath not set. Resolved relative filePath "${args.filePath}" to "${resolvedPath}" using process.cwd(). Consider starting purs-ide-server to set project context.`, 'warn');
                    }
                }
                return await fs.readFile(resolvedPath, 'utf-8');
            } catch (e) {
                throw new Error(`Failed to read file at ${resolvedPath} (original: ${args.filePath}): ${e.message}`);
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
    
    // Always use a random available port
    try {
        pursIdeServerPort = await findAvailablePort();
        logToStderr(`Using random available port: ${pursIdeServerPort}`, "info");
    } catch (portError) {
        throw new Error(`Failed to find available port: ${portError.message}`);
    }
    
    pursIdeProjectPath = path.resolve(args.project_path);
    const outputDir = args.output_directory || "output/";
    const sourceGlobs = args.source_globs || ["src/**/*.purs", ".spago/*/*/src/**/*.purs", "test/**/*.purs"];
    const logLevel = args.log_level || "none";
    pursIdeLogBuffer = [];
    
    const cmdArgs = ['ide', 'server', '--port', pursIdeServerPort.toString(), '--output-directory', outputDir, '--log-level', logLevel, ...sourceGlobs];
    const fullCommand = `npx purs ${cmdArgs.join(' ')}`;
    logToStderr(`Spawning '${fullCommand}' in CWD: ${pursIdeProjectPath}`, "info");
    
    return new Promise((resolve, reject) => {
        pursIdeProcess = spawn('npx', ['purs', ...cmdArgs], { cwd: pursIdeProjectPath, shell: false, env: process.env });
        pursIdeIsReady = false;
        
        pursIdeProcess.stdout.on('data', (data) => logPursIdeOutput(data, 'stdout'));
        pursIdeProcess.stderr.on('data', (data) => logPursIdeOutput(data, 'stderr'));
        
        pursIdeProcess.on('error', (err) => {
            const errorMsg = `Failed to start purs ide server process: ${err.message}`;
            logPursIdeOutput(errorMsg, 'error');
            pursIdeProcess = null;
            reject(new Error(errorMsg));
        });
        
        pursIdeProcess.on('close', (code) => {
            const codeMessage = `purs ide server process exited with code ${code}`;
            logPursIdeOutput(codeMessage, code === 0 ? 'info' : 'error');
            
            if (pursIdeProcess) { 
                pursIdeProcess = null; 
                pursIdeIsReady = false; 
            }
            
            if (code !== 0) {
                reject(new Error(`Server failed to start (exit code ${code})`));
            }
        });
        
        // Check if server started successfully after a short delay
        setTimeout(async () => {
            if (!pursIdeProcess) {
                return; // Process already exited
            }
            
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
                reject(new Error(`purs ide server started but initial load command failed: ${error.message}`));
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
        description: "Check if heavy IDE server processes are running to avoid resource conflicts. Shows status of Tree-sitter parser (lightweight code analysis) and purs IDE server (heavy process for type checking). ALWAYS use this before starting new IDE servers to prevent running multiple heavy processes simultaneously.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "echo",
        description: "Simple test tool that echoes back your input. Use to verify the MCP server is responding correctly.",
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
        description: "Extract the module name (like 'Data.List' or 'Main') from PureScript code. Works on files or code snippets without needing the heavy IDE server. Useful for understanding code structure.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the PureScript file. Relative paths resolved (project-relative if IDE server active, else CWD-relative). Absolute paths used as-is." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    {
        name: "getImports",
        description: "Find all import statements in PureScript code (like 'import Data.List', 'import Prelude'). Shows what external modules the code depends on. Works without the heavy IDE server.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the PureScript file. Relative paths resolved (project-relative if IDE server active, else CWD-relative). Absolute paths used as-is." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    {
        name: "getTopLevelDeclarationNames",
        description: "List all main definitions in PureScript code: function names, data types, type classes, etc. Gets just the names (like 'myFunction', 'MyDataType'). Fast analysis without needing IDE server.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the PureScript file. Relative paths resolved (project-relative if IDE server active, else CWD-relative). Absolute paths used as-is." },
                code: { type: "string", description: "PureScript code string." }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided."
        }
    },
    // Function and Value Declarations
    {
        name: "getFunctionNames",
        description: "Extract only function names from PureScript code snippets. Focuses specifically on functions, ignoring data types and classes. Quick analysis for code understanding.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    // Expressions and Literals
    // Control Flow Analysis
    {
        name: "getWhereBindings",
        description: "Find 'where' clauses in PureScript functions. These contain local helper functions and variables. Useful for understanding function implementation details.",
        inputSchema: {
            type: "object",
            properties: { code: { type: "string", description: "PureScript code snippet." } },
            required: ["code"],
            additionalProperties: false
        }
    },
    {
        name: "getTopLevelDeclarations",
        description: "Get detailed information about all main definitions in PureScript code: names, types (function/data/class), and full source code. Includes filtering options to find specific items. More comprehensive than getTopLevelDeclarationNames.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the PureScript file. Relative paths resolved (project-relative if IDE server active, else CWD-relative). Absolute paths used as-is." },
                code: { type: "string", description: "PureScript code string." },
                filters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Regex to filter declarations by name." },
                        type: { type: "string", description: "Regex to filter declarations by their mapped type (e.g., DeclData, DeclValue)." },
                        value: { type: "string", description: "Regex to filter declarations by their full text value." }
                    },
                    additionalProperties: false,
                    description: "Optional filters to apply to the declarations."
                }
            },
            additionalProperties: false,
            description: "Exactly one of 'filePath' or 'code' must be provided. Filters are optional."
        }
    },
    // End of Phase 1 tools
    {
        name: "start_purs_ide_server",
        description: "Start the heavy PureScript IDE server for type checking, auto-completion, and error detection. WARNING: This is a resource-intensive process. Automatically stops any existing server to prevent conflicts. Only run one at a time. Required for all pursIde* tools to work. Automatically selects a random available port to avoid conflicts - the port number is returned in the response.",
        inputSchema: {
            type: "object",
            properties: {
                project_path: { type: "string", description: "Absolute or relative path to the PureScript project directory." },
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
        description: "Stop the heavy PureScript IDE server to free up system resources. Use when you're done with type checking or want to switch projects. All pursIde* tools will stop working after this.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
        name: "query_purs_ide",
        description: "Send raw commands to the PureScript IDE server. PREREQUISITE: IDE server must be running (use start_purs_ide_server first). Advanced tool - prefer specific pursIde* tools for common tasks.",
        inputSchema: { type: "object", properties: { purs_ide_command: { type: "string" }, purs_ide_params: { type: "object" }}, required: ["purs_ide_command"], additionalProperties: false },
    },
    {
        name: "generate_dependency_graph",
        description: "Create a dependency graph showing which functions/types use which others in PureScript modules. PREREQUISITES: IDE server must be running and modules must be loaded. Useful for understanding code relationships and refactoring impact.",
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
        description: "Load PureScript modules into the IDE server for type checking and completions. PREREQUISITE: IDE server must be running. ALWAYS run this first after starting the IDE server before using other pursIde* tools.",
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
        description: "Look up the type signature of functions, variables, or values in PureScript code. PREREQUISITES: IDE server running and modules loaded. Helpful for understanding what a function expects and returns.",
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
        description: "Get the current working directory that the IDE server is using. PREREQUISITE: IDE server must be running. Useful for understanding the project context.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeReset",
        description: "Clear all loaded modules from the IDE server's memory. PREREQUISITE: IDE server must be running. Use when switching projects or after major code changes. You'll need to run pursIdeLoad again after this.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeQuit",
        description: "Gracefully shut down the IDE server and free up resources. PREREQUISITE: IDE server must be running. Same effect as stop_purs_ide_server but uses the server's built-in quit command first.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
        name: "pursIdeRebuild",
        description: "Quickly recompile a single PureScript module and check for errors. PREREQUISITES: IDE server running and modules loaded. Much faster than full project rebuild. Use when editing code to get immediate feedback.",
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
        description: "Find everywhere a specific function, type, or value is used across the project. PREREQUISITES: IDE server running and modules loaded. Essential for refactoring - shows impact of changes.",
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
        description: "List available modules in the project or imports in a specific file. PREREQUISITES: IDE server running and modules loaded. Helps understand project structure and dependencies.",
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
    "getWhereBindings": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, false); // Snippet-oriented
        const tree = purescriptTsParser.parse(code);
        const whereClausesText = [];
    
        // Query for 'where' keyword followed by a 'declarations' block within a function or let binding
        const querySource = `
          (function
            (where) @where_keyword
            (declarations) @declarations_block)
        `;
        // Also consider 'let' bindings with 'where' clauses, though less common for top-level 'where'
        // (let_binding (where) @where_keyword (declarations) @declarations_block)

        const query = new Query(PureScriptLanguage, querySource);
        const matches = query.matches(tree.rootNode);
    
        for (const match of matches) {
            const whereKeywordNode = match.captures.find(c => c.name === 'where_keyword')?.node;
            const declarationsNode = match.captures.find(c => c.name === 'declarations_block')?.node;
            
            if (whereKeywordNode && declarationsNode) {
                // Construct the text from "where" keyword to the end of the declarations block
                // This requires careful handling of start and end positions if they are not contiguous in the source text string
                // For simplicity, if they are siblings and in order, we can take text from start of 'where' to end of 'declarations'
                // A safer way is to combine their individual texts if they represent the full conceptual block
                const fullWhereClauseText = `${whereKeywordNode.text} ${declarationsNode.text}`;
                whereClausesText.push(fullWhereClauseText.trim());
            }
        }
        // Deduplicate, as some complex structures might yield multiple partial matches
        const uniqueWhereClauses = [...new Set(whereClausesText)];
        return { content: [{ type: "text", text: JSON.stringify(uniqueWhereClauses, null, 2) }] };
    },
    "getTopLevelDeclarations": async (args) => {
        if (!treeSitterInitialized) throw new Error("Tree-sitter not initialized.");
        const code = await getCodeFromInput(args, true); // true for module-oriented
        const tree = purescriptTsParser.parse(code);

        const querySource = `
            [
              (function name: (variable) @name.function) @DeclValue
              (data name: (type) @name.data_type) @DeclData
              (class_declaration (class_head (class_name (type) @name.class))) @DeclClass
              (type_alias name: (type) @name.type_alias) @DeclType
              (newtype name: (type) @name.newtype) @DeclNewtype
              (foreign_import name: (variable) @name.foreign) @DeclForeign
              (signature name: (variable) @name.signature) @DeclSignature
              (class_instance (instance_head (class_name) @name.instance_class (type_name)? @name.instance_type)) @DeclInstanceChain
              (kind_value_declaration name: (type) @name.kind_sig) @DeclKindSignature
              (derive_declaration) @DeclDerive
              (type_role_declaration (type) @name.role_type (type_role)+ @name.role_value) @DeclRole
              (operator_declaration (operator) @name.operator) @DeclFixity
            ]
        `;
        const query = new Query(PureScriptLanguage, querySource);
        const matches = query.matches(tree.rootNode);
        const rawDeclarations = [];

        for (const match of matches) {
            const mainCapture = match.captures.find(c => c.name.startsWith("Decl"));
            if (!mainCapture) continue;

            const declNode = mainCapture.node;
            const mappedType = mainCapture.name;
            const value = declNode.text; // This is the full text of the declaration node

            // Create a map of captures for efficient lookup
            // Store the full capture object {name, node} as node properties (like .text) are needed
            const allCapturesMap = new Map(match.captures.map(c => [c.name, c]));

            let finalName;

            // Prioritized list of capture names that directly provide the 'name'
            const singleNameCaptureKeys = [
                "name.function", "name.data_type", "name.class", "name.type_alias",
                "name.newtype", "name.foreign", "name.signature", "name.kind_sig",
                "name.role_type", "name.operator"
            ];

            let foundSingleName = false;
            for (const key of singleNameCaptureKeys) {
                if (allCapturesMap.has(key)) {
                    finalName = allCapturesMap.get(key).node.text;
                    foundSingleName = true;
                    break;
                }
            }

            if (!foundSingleName) {
                if (allCapturesMap.has("name.instance_class")) {
                    finalName = allCapturesMap.get("name.instance_class").node.text;
                    if (allCapturesMap.has("name.instance_type")) {
                        finalName += ` ${allCapturesMap.get("name.instance_type").node.text}`;
                    }
                } else if (mappedType === "DeclDerive" || mappedType === "DeclFixity") {
                    // declNode is mainCapture.node, which is already available
                    const firstIdentNode = declNode.descendantsOfType("identifier")[0] ||
                                       declNode.descendantsOfType("type")[0] ||
                                       declNode.descendantsOfType("operator")[0];
                    finalName = firstIdentNode ? firstIdentNode.text : `complex_${mappedType.toLowerCase().replace('decl', '')}`;
                } else {
                    finalName = "unknown"; // Default if no other specific name found
                }
            }
            
            rawDeclarations.push({ name: finalName, type: mappedType, value, treeSitterType: declNode.type }); // Removed node property
        }

        let declarations = rawDeclarations; // Use rawDeclarations directly without consolidation

        // Apply filters if provided
        if (args.filters) {
            const { name, type, value } = args.filters;
            if (name) {
                const nameRegex = new RegExp(name);
                declarations = declarations.filter(d => nameRegex.test(d.name));
            }
            if (type) {
                const typeRegex = new RegExp(type);
                declarations = declarations.filter(d => typeRegex.test(d.type));
            }
            if (value) {
                const valueRegex = new RegExp(value);
                declarations = declarations.filter(d => valueRegex.test(d.value));
            }
        }

        return { content: [{ type: "text", text: JSON.stringify(declarations, null, 2) }] };
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
