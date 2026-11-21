import { parse } from "acorn";
import { transformWithOxc } from "vite";

/** Returns every module specifier that survives TypeScript compilation. */
export async function runtimeSourceImports(source: string, filename: string): Promise<string[]> {
  const compiled = await transformWithOxc(source, filename);
  const tree = parse(compiled.code, { ecmaVersion: "latest", sourceType: "module" });
  const imports: string[] = [];
  const literal = (value: unknown) => {
    if (record(value) && typeof value.value === "string") imports.push(value.value);
  };
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!record(value)) return;
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(String(value.type))) {
      literal(value.source);
    } else if (value.type === "CallExpression" && record(value.callee) &&
        value.callee.type === "Identifier" && value.callee.name === "require" && Array.isArray(value.arguments)) {
      literal(value.arguments[0]);
    }
    Object.values(value).forEach(visit);
  };
  visit(tree);
  return imports;
}

/** Returns every specifier written in source, including type-only imports. */
export function sourceImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Detects module loading that would escape a self-contained plugin bundle. */
export function containsPluginRuntimeImport(source: string, fileName = "plugin.js"): boolean {
  let sourceFile: unknown;
  try {
    sourceFile = parse(source, {
      allowHashBang: true,
      ecmaVersion: "latest",
      sourceFile: fileName,
      sourceType: "module",
    });
  } catch {
    return true;
  }
  let found = false;
  const visit = (value: unknown) => {
    if (found || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
        if (found) return;
      }
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === "ImportExpression" ||
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      (node.type === "ExportNamedDeclaration" && node.source !== null && node.source !== undefined) ||
      (node.type === "CallExpression" && importScriptsCall(node.callee))
    ) {
      found = true;
      return;
    }
    for (const child of Object.values(node)) {
      if (child !== node) {
        visit(child);
        if (found) return;
      }
    }
  };
  visit(sourceFile);
  return found;
}

function importScriptsCall(expression: unknown): boolean {
  if (!record(expression)) return false;
  if (expression.type === "ChainExpression") return importScriptsCall(expression.expression);
  if (expression.type === "Identifier") return expression.name === "importScripts";
  if (expression.type !== "MemberExpression" || !record(expression.property)) return false;
  const property = expression.property;
  return expression.computed === true
    ? property.type === "Literal" && property.value === "importScripts"
    : property.type === "Identifier" && property.name === "importScripts";
}

export function dependencyName(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
