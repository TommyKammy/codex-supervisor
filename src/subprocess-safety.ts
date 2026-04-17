import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const TARGET_FILE_PATHS = new Set([
  "src/build.test.ts",
  "src/local-ci.test.ts",
]);

const TARGET_FILE_PREFIXES = [
  "scripts/",
] as const;

const CHILD_PROCESS_MODULES = new Set(["node:child_process", "child_process"]);
const SYNC_CHILD_PROCESS_CALLS = new Set(["execFileSync", "execSync", "spawnSync"]);
const EXECUTABLE_PATH_REQUIRED_CALLS = new Set(["execFile", "execFileSync", "spawn", "spawnSync"]);
const SHELL_TRAMPOLINE_EXECUTABLES = new Set(["bash", "sh"]);
const RESOLUTION_REQUIRED_EXECUTABLES = new Set(["bash", "git", "npx", "npm", "pnpm", "sh", "yarn"]);

export interface SubprocessSafetyFinding {
  filePath: string;
  line: number;
  ruleId: "bounded_timeout_required" | "resolved_executable_required" | "shell_trampoline_disallowed" | "shell_option_disallowed";
  summary: string;
}

export function isSubprocessSafetyTarget(filePath: string): boolean {
  const normalizedPath = normalizeRepoRelativePath(filePath);
  if (TARGET_FILE_PATHS.has(normalizedPath)) {
    return true;
  }

  return TARGET_FILE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix));
}

export function normalizeRepoRelativePath(filePath: string): string {
  return path.posix.normalize(filePath.replaceAll("\\", "/")).replace(/^(?:\.\/)+/, "");
}

export async function findSubprocessSafetyFindings(args: {
  workspacePath: string;
  filePaths?: string[];
}): Promise<SubprocessSafetyFinding[]> {
  const requestedPaths = args.filePaths?.map(normalizeRepoRelativePath).filter((filePath) => isSubprocessSafetyTarget(filePath))
    ?? [];
  const candidatePaths = requestedPaths.length > 0 ? requestedPaths : await discoverTargetFilePaths(args.workspacePath);

  const findings: SubprocessSafetyFinding[] = [];
  for (const filePath of candidatePaths) {
    const absolutePath = path.join(args.workspacePath, filePath);
    let sourceText: string;
    try {
      sourceText = await fs.readFile(absolutePath, "utf8");
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    findings.push(...collectSubprocessSafetyFindings(filePath, sourceText));
  }

  return findings.sort((left, right) => {
    if (left.filePath === right.filePath) {
      if (left.line === right.line) {
        return left.ruleId.localeCompare(right.ruleId);
      }
      return left.line - right.line;
    }
    return left.filePath.localeCompare(right.filePath);
  });
}

async function discoverTargetFilePaths(workspacePath: string): Promise<string[]> {
  const discoveredPaths = new Set<string>(TARGET_FILE_PATHS);

  for (const prefix of TARGET_FILE_PREFIXES) {
    const absolutePrefix = path.join(workspacePath, prefix);
    await collectTargetFilesUnder(absolutePrefix, prefix, discoveredPaths);
  }

  return [...discoveredPaths].sort((left, right) => left.localeCompare(right));
}

async function collectTargetFilesUnder(absoluteDir: string, relativePrefix: string, discoveredPaths: Set<string>): Promise<void> {
  try {
    const dirEntries = await fs.readdir(absoluteDir, { withFileTypes: true });
    for (const entry of dirEntries) {
      const absoluteChildPath = path.join(absoluteDir, entry.name);
      const repoRelativePath = normalizeRepoRelativePath(path.posix.join(relativePrefix, entry.name));
      if (entry.isDirectory()) {
        await collectTargetFilesUnder(absoluteChildPath, repoRelativePath, discoveredPaths);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (repoRelativePath.endsWith(".ts")) {
        discoveredPaths.add(repoRelativePath);
      }
    }
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

function collectSubprocessSafetyFindings(filePath: string, sourceText: string): SubprocessSafetyFinding[] {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const childProcessBindings = collectChildProcessBindings(sourceFile);
  const findings: SubprocessSafetyFinding[] = [];
  const seen = new Set<string>();

  const pushFinding = (finding: SubprocessSafetyFinding): void => {
    const key = `${finding.filePath}:${finding.line}:${finding.ruleId}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push(finding);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callName = resolveChildProcessCallName(node.expression, childProcessBindings);
      if (callName) {
        analyzeChildProcessCall({ filePath, sourceFile, node, callName, pushFinding });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

function collectChildProcessBindings(sourceFile: ts.SourceFile): {
  namedBindings: Map<string, string>;
  namespaceBindings: Set<string>;
} {
  const namedBindings = new Map<string, string>();
  const namespaceBindings = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
    if (!moduleName || !CHILD_PROCESS_MODULES.has(moduleName)) {
      continue;
    }

    const importClause = statement.importClause;
    const namedBindingsNode = importClause?.namedBindings;
    if (!namedBindingsNode) {
      continue;
    }

    if (ts.isNamedImports(namedBindingsNode)) {
      for (const element of namedBindingsNode.elements) {
        namedBindings.set(element.name.text, element.propertyName?.text ?? element.name.text);
      }
      continue;
    }

    if (ts.isNamespaceImport(namedBindingsNode)) {
      namespaceBindings.add(namedBindingsNode.name.text);
    }
  }

  return { namedBindings, namespaceBindings };
}

function resolveChildProcessCallName(
  expression: ts.Expression,
  bindings: { namedBindings: Map<string, string>; namespaceBindings: Set<string> },
): string | null {
  if (ts.isIdentifier(expression)) {
    return bindings.namedBindings.get(expression.text) ?? null;
  }

  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    if (bindings.namespaceBindings.has(expression.expression.text)) {
      return expression.name.text;
    }
  }

  return null;
}

function analyzeChildProcessCall(args: {
  filePath: string;
  sourceFile: ts.SourceFile;
  node: ts.CallExpression;
  callName: string;
  pushFinding: (finding: SubprocessSafetyFinding) => void;
}): void {
  const { filePath, sourceFile, node, callName, pushFinding } = args;
  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const executable = stringLiteralValue(node.arguments[0]);
  const optionsNode = extractOptionsArgument(callName, node.arguments);

  if (SYNC_CHILD_PROCESS_CALLS.has(callName) && !hasTimeoutOption(optionsNode)) {
    pushFinding({
      filePath,
      line,
      ruleId: "bounded_timeout_required",
      summary: `${callName} must set a bounded timeout in repo-owned tests and verifier scripts.`,
    });
  }

  if (hasShellTrueOption(optionsNode)) {
    pushFinding({
      filePath,
      line,
      ruleId: "shell_option_disallowed",
      summary: `${callName} must avoid \`shell: true\`; pass argv directly instead.`,
    });
  }

  if (EXECUTABLE_PATH_REQUIRED_CALLS.has(callName) && executable && requiresResolvedExecutable(executable)) {
    pushFinding({
      filePath,
      line,
      ruleId: "resolved_executable_required",
      summary: `${callName} should use a resolved executable path for ${JSON.stringify(executable)} instead of relying on PATH lookup.`,
    });
  }

  if (executable && SHELL_TRAMPOLINE_EXECUTABLES.has(path.posix.basename(executable))) {
    const argv = extractStaticArgv(node.arguments[1]);
    if (argv[0] === "-c" || argv[0] === "-lc") {
      pushFinding({
        filePath,
        line,
        ruleId: "shell_trampoline_disallowed",
        summary: `${callName} should avoid shell trampolines like ${JSON.stringify(executable)} ${JSON.stringify(argv[0])}; invoke the intended executable directly.`,
      });
    }
  }
}

function stringLiteralValue(node: ts.Expression | undefined): string | null {
  if (!node) {
    return null;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  return null;
}

function extractStaticArgv(node: ts.Expression | undefined): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return [];
  }

  return node.elements.map((element) => stringLiteralValue(element)).filter((value): value is string => value !== null);
}

function extractOptionsArgument(callName: string, args: readonly ts.Expression[]): ts.ObjectLiteralExpression | null {
  if (callName === "execSync") {
    const candidate = args[1];
    return candidate && ts.isObjectLiteralExpression(candidate) ? candidate : null;
  }

  const candidate = args.at(-1);
  return candidate && ts.isObjectLiteralExpression(candidate) ? candidate : null;
}

function hasTimeoutOption(node: ts.ObjectLiteralExpression | null): boolean {
  if (!node) {
    return false;
  }

  return node.properties.some((property) =>
    ts.isPropertyAssignment(property) &&
    property.name.getText() === "timeout",
  );
}

function hasShellTrueOption(node: ts.ObjectLiteralExpression | null): boolean {
  if (!node) {
    return false;
  }

  return node.properties.some((property) =>
    ts.isPropertyAssignment(property) &&
    property.name.getText() === "shell" &&
    property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

function requiresResolvedExecutable(executable: string): boolean {
  if (executable.includes("/") || executable.includes("\\")) {
    return false;
  }

  return RESOLUTION_REQUIRED_EXECUTABLES.has(executable);
}
