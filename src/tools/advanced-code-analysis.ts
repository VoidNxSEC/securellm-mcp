import { z } from "zod";
import ts from "typescript";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { zodToMcpSchema } from "../utils/schema-converter.js";
import { stringifyGeneric } from "../utils/json-schemas.js";

/**
 * Advanced Code Analysis Tool (TS/JS)
 *
 * Goal: "zero-friction" debugging + code understanding:
 * - High-level: module summary, exports, imports, file map
 * - Low-level: symbol declaration, type/signature, references (where used)
 *
 * Note: uses TypeScript Language Service; works best on TS/TSX/JS/JSX.
 */

const advancedCodeAnalysisSchema = z.object({
  /** Path to analyze: file or directory */
  target: z.string().describe("File or directory to analyze (absolute path recommended)"),

  /** Optional TSConfig path. If omitted, auto-detects tsconfig.json upward from target. */
  tsconfig_path: z.string().optional().describe("Path to tsconfig.json (optional)"),

  /**
   * What you want from the tool (low-friction):
   * - overview: file/dir summary (imports/exports/top-level)
   * - symbol: declaration + type + refs
   * - callers: who calls this function / constructs this class
   * - callees: what this function calls
   * - impact: files likely impacted by changing symbol/module (refs + importers)
   * - import_trace: trace how a module export reaches an entrypoint (best-effort)
   * - entrypoints: find likely entrypoints in the target tree
   */
  intent: z
    .enum(["overview", "symbol", "callers", "callees", "impact", "import_trace", "entrypoints"])
    .optional()
    .default("symbol")
    .describe("Analysis intent (default: symbol)"),

  /** Optional file to disambiguate symbol lookup */
  symbol_file: z.string().optional().describe("File path to search symbol within first (optional)"),

  /** Optional symbol to focus on (identifier, e.g. 'SemanticCache' or 'setupToolHandlers') */
  symbol: z.string().optional().describe("Symbol name to analyze (required for symbol/callers/callees/impact/import_trace)"),

  /** Output mode */
  mode: z
    .enum(["high", "low", "both"])
    .optional()
    .default("both")
    .describe("Return high-level, low-level, or both"),

  /** Max files to include in high-level summary (directories only) */
  max_files: z.number().optional().default(80).describe("Max files to scan when target is a directory"),

  /** Max references to return */
  max_refs: z.number().optional().default(80).describe("Max symbol references to return"),

  /** Depth for import/call graph traversals (best-effort) */
  depth: z.number().optional().default(2).describe("Traversal depth for call/import tracing"),
});

export const advancedCodeAnalysisTool = {
  name: "advanced_code_analysis",
  description:
    "Advanced TS/JS code analysis for debugging: overview, symbol types/refs, callers/callees, impact, entrypoints (low-friction).",
  defer_loading: true,
  inputSchema: zodToMcpSchema(advancedCodeAnalysisSchema),
};

type Args = z.infer<typeof advancedCodeAnalysisSchema>;

function isCodeFile(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function statSafe(p: string) {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

async function findUpward(startDir: string, filename: string): Promise<string | null> {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(dir, filename);
    if (await fileExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function listFilesRec(dir: string, maxFiles: number): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [dir];

  while (queue.length && out.length < maxFiles) {
    const cur = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      if (ent.name.startsWith(".")) continue;
      if (ent.name === "node_modules" || ent.name === "build" || ent.name === "dist") continue;

      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) queue.push(full);
      else if (ent.isFile() && isCodeFile(full)) out.push(full);
    }
  }

  return out;
}

function getLineSnippet(text: string, line: number, context: number = 2): { startLine: number; endLine: number; snippet: string } {
  const lines = text.split(/\r?\n/);
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length - 1, line - 1 + context);
  const snippet = lines.slice(start, end + 1).join("\n");
  return { startLine: start + 1, endLine: end + 1, snippet };
}

function positionFromLineCol(text: string, line: number, col: number): number {
  // line/col are 1-based
  const sf = ts.createSourceFile("tmp.ts", text, ts.ScriptTarget.ES2022, true);
  return ts.getPositionOfLineAndCharacter(sf, Math.max(0, line - 1), Math.max(0, col - 1));
}

function createLanguageService(rootFiles: string[], options: ts.CompilerOptions) {
  const versions = new Map<string, number>();
  const snapshots = new Map<string, ts.IScriptSnapshot>();

  const getSnapshot = (fileName: string) => {
    const normalized = path.normalize(fileName);
    const cached = snapshots.get(normalized);
    if (cached) return cached;
    if (!fs.existsSync(normalized)) return undefined;
    const text = fs.readFileSync(normalized, "utf8");
    const snap = ts.ScriptSnapshot.fromString(text);
    snapshots.set(normalized, snap);
    return snap;
  };

  for (const f of rootFiles) versions.set(path.normalize(f), 1);

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => rootFiles,
    getScriptVersion: (fileName) => String(versions.get(path.normalize(fileName)) || 1),
    getScriptSnapshot: getSnapshot,
    getCurrentDirectory: () => process.cwd(),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function loadTsConfig(tsconfigPath: string): { rootFiles: string[]; options: ts.CompilerOptions; projectDir: string } {
  const projectDir = path.dirname(tsconfigPath);
  const configText = ts.sys.readFile(tsconfigPath);
  if (!configText) {
    return { rootFiles: [], options: {}, projectDir };
  }
  const result = ts.parseConfigFileTextToJson(tsconfigPath, configText);
  if (result.error) {
    return { rootFiles: [], options: {}, projectDir };
  }
  const configParse = ts.parseJsonConfigFileContent(result.config, ts.sys, projectDir);
  return { rootFiles: configParse.fileNames, options: configParse.options, projectDir };
}

function summarizeSourceFile(sf: ts.SourceFile, checker: ts.TypeChecker) {
  const exports: Array<{ name: string; kind: string }> = [];
  const topLevel: Array<{ name: string; kind: string; line: number }> = [];
  const imports: Array<{ specifier: string; from: string; line: number }> = [];

  const addTop = (name: string, kind: string, node: ts.Node) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    topLevel.push({ name, kind, line: line + 1 });
  };

  sf.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const from = node.moduleSpecifier.text;
      const specifier = node.importClause?.getText(sf) || "";
      imports.push({ specifier, from, line: line + 1 });
    }

    if (ts.isFunctionDeclaration(node) && node.name) addTop(node.name.text, "function", node);
    if (ts.isClassDeclaration(node) && node.name) addTop(node.name.text, "class", node);
    if (ts.isInterfaceDeclaration(node)) addTop(node.name.text, "interface", node);
    if (ts.isTypeAliasDeclaration(node)) addTop(node.name.text, "type", node);
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) addTop(decl.name.text, "const/let/var", decl);
      }
    }
  });

  // Exports via checker on symbols (best-effort)
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (moduleSymbol) {
    const exp = checker.getExportsOfModule(moduleSymbol);
    for (const sym of exp) {
      exports.push({ name: sym.getName(), kind: ts.SymbolFlags[sym.getFlags()] || "symbol" });
    }
  }

  return { imports, exports, topLevel };
}

function findSymbolDeclarations(
  service: ts.LanguageService,
  checker: ts.TypeChecker,
  fileName: string,
  symbolName: string
) {
  const program = service.getProgram();
  if (!program) return { candidates: [] as any[] };
  const sf = program.getSourceFile(fileName);
  if (!sf) return { candidates: [] as any[] };

  const candidates: any[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === symbolName) {
      const sym = checker.getSymbolAtLocation(node);
      if (!sym) return;
      const decl = sym.valueDeclaration || sym.declarations?.[0];
      if (!decl) return;
      const declSf = decl.getSourceFile();
      const { line, character } = declSf.getLineAndCharacterOfPosition(decl.getStart(declSf));
      const type = checker.getTypeOfSymbolAtLocation(sym, node);
      const typeStr = checker.typeToString(type);
      candidates.push({
        name: sym.getName(),
        kind: ts.SymbolFlags[sym.getFlags()] || "symbol",
        file: declSf.fileName,
        line: line + 1,
        col: character + 1,
        type: typeStr,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { candidates };
}

function findEnclosingCallableName(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      // Try to name from variable declarator: const foo = () => {}
      const parent = cur.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    }
    if (ts.isClassDeclaration(cur) && cur.name) return cur.name.text;
    cur = cur.parent;
  }
  return null;
}

function isCallLikeIdentifier(sf: ts.SourceFile, pos: number): boolean {
  // Best-effort: if identifier is within CallExpression/ NewExpression expression position
  const nodeAt = findNodeAtPosition(sf, pos);
  if (!nodeAt) return false;
  let cur: ts.Node | undefined = nodeAt;
  while (cur) {
    if (ts.isCallExpression(cur) || ts.isNewExpression(cur)) return true;
    if (ts.isSourceFile(cur)) break;
    cur = cur.parent;
  }
  return false;
}

function findNodeAtPosition(sf: ts.SourceFile, pos: number): ts.Node | null {
  let best: ts.Node | null = null;
  const visit = (node: ts.Node) => {
    const start = node.getFullStart();
    const end = node.getEnd();
    if (pos >= start && pos < end) {
      best = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(sf);
  return best;
}

function collectCalleesInFunction(sf: ts.SourceFile, checker: ts.TypeChecker, declPos: number): Array<{ name: string; type?: string; line: number; col: number }> {
  const node = findNodeAtPosition(sf, declPos);
  if (!node) return [];
  // find nearest callable node
  let callable: ts.Node | undefined = node;
  while (callable) {
    if (
      ts.isFunctionDeclaration(callable) ||
      ts.isMethodDeclaration(callable) ||
      ts.isArrowFunction(callable) ||
      ts.isFunctionExpression(callable)
    ) {
      break;
    }
    callable = callable.parent;
  }
  if (!callable) return [];

  const out: Array<{ name: string; type?: string; line: number; col: number }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const expr = n.expression;
      const sym = checker.getSymbolAtLocation(expr);
      const name = sym?.getName() || expr.getText(sf);
      const t = sym ? checker.typeToString(checker.getTypeOfSymbolAtLocation(sym, expr)) : undefined;
      const { line, character } = sf.getLineAndCharacterOfPosition(expr.getStart(sf));
      out.push({ name, type: t, line: line + 1, col: character + 1 });
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(callable, visit);
  return out.slice(0, 80);
}

async function getFileText(p: string): Promise<string | null> {
  try {
    return await fsp.readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function handleAdvancedCodeAnalysis(rawArgs: unknown) {
  const args = advancedCodeAnalysisSchema.parse(rawArgs);
  const targetPath = path.resolve(args.target);
  const st = await statSafe(targetPath);
  if (!st) {
    return { content: [{ type: "text", text: `Target not found: ${targetPath}` }], isError: true };
  }

  const tsconfigPath =
    (args.tsconfig_path ? path.resolve(args.tsconfig_path) : null) ||
    (await findUpward(st.isDirectory() ? targetPath : path.dirname(targetPath), "tsconfig.json"));

  if (!tsconfigPath) {
    return {
      content: [
        {
          type: "text",
          text: stringifyGeneric({
            error: "tsconfig.json not found",
            hint: "Pass tsconfig_path or run from a TS project root",
            target: targetPath,
          }),
        },
      ],
      isError: true,
    };
  }

  const { rootFiles, options, projectDir } = loadTsConfig(tsconfigPath);
  const filesToAnalyze = st.isDirectory() ? await listFilesRec(targetPath, args.max_files) : [targetPath];

  // Ensure the target file(s) are included (tsconfig might exclude them)
  const fileSet = new Set<string>(rootFiles.map((f) => path.normalize(f)));
  for (const f of filesToAnalyze) fileSet.add(path.normalize(f));
  const allFiles = Array.from(fileSet);

  const service = createLanguageService(allFiles, options);
  const program = service.getProgram();
  if (!program) {
    return {
      content: [{ type: "text", text: stringifyGeneric({ error: "Failed to create TS program", tsconfigPath }) }],
      isError: true,
    };
  }
  const checker = program.getTypeChecker();

  const result: any = {
    meta: {
      tool: "advanced_code_analysis",
      mode: args.mode,
      intent: args.intent,
      tsconfigPath,
      projectDir,
      analyzedTarget: targetPath,
      analyzedFilesCount: filesToAnalyze.length,
    },
  };

  const wantHigh = args.mode === "high" || args.mode === "both" || args.intent === "overview" || args.intent === "entrypoints";
  const wantLow = args.mode === "low" || args.mode === "both" || ["symbol", "callers", "callees", "impact", "import_trace"].includes(args.intent);

  if (wantHigh) {
    const fileSummaries: any[] = [];
    for (const f of filesToAnalyze) {
      const sf = program.getSourceFile(f);
      if (!sf) continue;
      const sum = summarizeSourceFile(sf, checker);
      fileSummaries.push({
        file: f,
        imports: sum.imports.slice(0, 40),
        exports: sum.exports.slice(0, 60),
        topLevel: sum.topLevel.slice(0, 80),
      });
    }
    result.high = {
      summary: st.isDirectory()
        ? "Directory overview (TS/JS): imports/exports/top-level declarations"
        : "File overview (TS/JS): imports/exports/top-level declarations",
      files: fileSummaries,
    };
  }

  if (wantLow) {
    if (args.intent !== "entrypoints" && !args.symbol && args.intent !== "overview") {
      return {
        content: [
          {
            type: "text",
            text: stringifyGeneric({
              error: "symbol is required for this intent",
              intent: args.intent,
              hint: 'Pass { "symbol": "MyThing" } (and optionally symbol_file)',
            }),
          },
        ],
        isError: true,
      };
    }

    if (args.intent === "entrypoints") {
      // Heuristic entrypoints: files with shebang, new Server(), createServer/listen, process.argv usage, or "export default" main.
      const entrypoints: any[] = [];
      for (const f of filesToAnalyze) {
        const text = await getFileText(f);
        if (!text) continue;
        const score =
          (text.startsWith("#!/") ? 3 : 0) +
          (text.includes("new Server(") ? 3 : 0) +
          (text.includes("createServer(") || text.includes(".listen(") ? 2 : 0) +
          (text.includes("process.argv") ? 1 : 0) +
          (text.includes("export default") ? 1 : 0);
        if (score > 0) {
          entrypoints.push({ file: f, score });
        }
      }
      entrypoints.sort((a, b) => b.score - a.score);
      result.entrypoints = entrypoints.slice(0, 30);
    } else if (args.symbol) {
      const focusFile = args.symbol_file
        ? path.resolve(args.symbol_file)
        : st.isDirectory()
          ? filesToAnalyze[0]
          : targetPath;
      const decls = findSymbolDeclarations(service, checker, focusFile, args.symbol);

      // Build references using correct position (decl line/col) when possible.
      const refs: any[] = [];
      const callers: Record<string, number> = {};
      const refFiles = new Set<string>();

      for (const cand of decls.candidates.slice(0, 3)) {
        const fileText = await getFileText(cand.file);
        if (!fileText) continue;
        const pos = positionFromLineCol(fileText, cand.line, cand.col);
        const found = service.findReferences(cand.file, pos) || [];

        for (const entry of found) {
          for (const r of entry.references) {
            const refFile = r.fileName;
            const refText = await getFileText(refFile);
            if (!refText) continue;
            refFiles.add(refFile);
            const refSf = ts.createSourceFile(refFile, refText, ts.ScriptTarget.ES2022, true);
            const { line, character } = ts.getLineAndCharacterOfPosition(refSf, r.textSpan.start);
            const snippet = getLineSnippet(refText, line + 1, 2);

            // Caller heuristic: enclosing function/method name for call sites
            const isCallish = isCallLikeIdentifier(refSf, r.textSpan.start);
            const nodeAt = findNodeAtPosition(refSf, r.textSpan.start);
            const encl = nodeAt ? findEnclosingCallableName(nodeAt) : null;
            if (isCallish && encl) callers[encl] = (callers[encl] || 0) + 1;

            refs.push({
              file: refFile,
              line: line + 1,
              col: character + 1,
              isWriteAccess: r.isWriteAccess,
              isCallSite: isCallish,
              enclosing: encl,
              snippet,
            });
            if (refs.length >= args.max_refs) break;
          }
          if (refs.length >= args.max_refs) break;
        }
        if (refs.length >= args.max_refs) break;
      }

      const callersTop = Object.entries(callers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([name, count]) => ({ name, count }));

      // Callees: parse the first declaration file and collect calls inside that callable.
      let callees: any[] = [];
      const firstDecl = decls.candidates[0];
      if (firstDecl) {
        const declText = await getFileText(firstDecl.file);
        if (declText) {
          const declSf = ts.createSourceFile(firstDecl.file, declText, ts.ScriptTarget.ES2022, true);
          const declPos = positionFromLineCol(declText, firstDecl.line, firstDecl.col);
          callees = collectCalleesInFunction(declSf, checker, declPos);
        }
      }

      // Impact: combine ref files + naive importers of the declaration file (string match on relative import)
      let importers: string[] = [];
      if (args.intent === "impact" && firstDecl) {
        const declRel = path.relative(projectDir, firstDecl.file).replaceAll(path.sep, "/");
        const baseNoExt = declRel.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
        const candidatesImport = new Set<string>([baseNoExt, `./${baseNoExt}`, `../${baseNoExt}`]);
        const foundImporters: string[] = [];
        for (const f of filesToAnalyze) {
          const text = await getFileText(f);
          if (!text) continue;
          for (const imp of candidatesImport) {
            if (text.includes(imp)) {
              foundImporters.push(f);
              break;
            }
          }
        }
        importers = Array.from(new Set(foundImporters)).slice(0, 80);
      }

      result.low = {
        symbol: args.symbol,
        symbol_file: focusFile,
        declarations: decls.candidates,
        references: refs,
        callers: args.intent === "callers" || args.intent === "symbol" || args.intent === "impact" ? callersTop : undefined,
        callees: args.intent === "callees" || args.intent === "symbol" || args.intent === "impact" ? callees : undefined,
        impact:
          args.intent === "impact"
            ? {
                referencedInFiles: Array.from(refFiles).slice(0, 120),
                importers,
                note: "Impact is best-effort (refs + naive importers). For accuracy, keep target narrow.",
              }
            : undefined,
      };
    }
  }

  return {
    content: [{ type: "text", text: stringifyGeneric(result) }],
  };
}

