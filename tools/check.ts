import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { PLUGIN_GUIDE_SECTIONS } from "../src/index.ts";
import {
  containsPluginRuntimeImport, dependencyName, runtimeSourceImports, sourceImportSpecifiers,
} from "./imports.ts";
import {
  SDK_PACKAGE_NAME, errorMessage, executableEntrypoints, isRecord, readPluginProject, sourceEntrypoint,
} from "./project.ts";

export interface CheckOptions {
  /** Also require built entrypoints and verify they are self-contained. */
  artifacts?: boolean;
}

/** Validates a plugin project and returns every problem found. */
export async function checkPlugin(directory = process.cwd(), options: CheckOptions = {}): Promise<string[]> {
  const errors: string[] = [];
  let project;
  try {
    project = readPluginProject(directory);
  } catch (error) {
    return [errorMessage(error)];
  }
  const { root, manifest, packageJson } = project;
  if (packageJson.private !== true) {
    errors.push("package.json must remain private; plugins are distributed as release archives.");
  }
  if (packageJson.bin !== undefined) errors.push("package.json cannot declare executable bins.");
  if (packageJson.version !== manifest.version) {
    errors.push("package.json and plugin.json versions must match.");
  }

  const documentationPath = join(root, manifest.documentation);
  if (!existsSync(documentationPath) || !statSync(documentationPath).isFile()) {
    errors.push(`Missing ${manifest.documentation}.`);
  } else {
    const guide = readFileSync(documentationPath, "utf8").toLowerCase();
    for (const heading of PLUGIN_GUIDE_SECTIONS) {
      if (!guide.includes(`## ${heading}`)) errors.push(`Guide is missing the "${heading}" section.`);
    }
  }

  const entrypoints = executableEntrypoints(manifest);
  const required = [
    manifest.icon,
    ...(manifest.legal ?? []),
    ...entrypoints.map((path) => options.artifacts ? path : sourceEntrypoint(path)),
  ];
  for (const path of required) {
    const target = join(root, path);
    if (!existsSync(target) || !statSync(target).isFile()) errors.push(`Missing ${path}.`);
  }
  if (options.artifacts) checkArtifacts(root, entrypoints, errors);

  for (const group of [packageJson.dependencies, packageJson.devDependencies, packageJson.peerDependencies]) {
    for (const dependency of Object.keys(isRecord(group) ? group : {})) {
      if (dependency.startsWith("@denote/plugin-") && dependency !== SDK_PACKAGE_NAME) {
        errors.push(`Plugins cannot depend on another plugin package: ${dependency}.`);
      }
    }
  }
  const runtimeDependencies = new Set([
    ...Object.keys(isRecord(packageJson.dependencies) ? packageJson.dependencies : {}),
    ...Object.keys(isRecord(packageJson.peerDependencies) ? packageJson.peerDependencies : {}),
  ]);
  await checkSourceImports(root, runtimeDependencies, errors);
  return errors;
}

function checkArtifacts(root: string, entrypoints: string[], errors: string[]): void {
  const distPath = join(root, "dist");
  const outputs = existsSync(distPath)
    ? readdirSync(distPath, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
    : [];
  const expected = entrypoints.map((path) => path.replace(/^dist\//, "")).sort();
  if (outputs.length !== expected.length || outputs.some((file, index) => file !== expected[index])) {
    errors.push("The build must emit only the declared self-contained entrypoints.");
    return;
  }
  for (const entrypoint of entrypoints) {
    if (containsPluginRuntimeImport(readFileSync(join(root, entrypoint), "utf8"), entrypoint)) {
      errors.push(`${entrypoint} contains a runtime import and is not self-contained.`);
    }
  }
}

async function checkSourceImports(
  root: string, runtimeDependencies: ReadonlySet<string>, errors: string[],
): Promise<void> {
  const sourceRoot = join(root, "src");
  if (!existsSync(sourceRoot)) {
    errors.push("Missing src/.");
    return;
  }
  for (const path of sourceFiles(sourceRoot)) {
    const label = relative(root, path).split(sep).join("/");
    const source = readFileSync(path, "utf8");
    for (const specifier of sourceImportSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        if (!isInside(root, resolve(dirname(path), specifier))) {
          errors.push(`${label} imports outside its plugin folder: ${specifier}.`);
        }
      } else if (
        (specifier.startsWith("@denote/plugin-") && specifier !== SDK_PACKAGE_NAME) ||
        specifier.startsWith("@tauri-apps/") ||
        specifier.startsWith("src/") ||
        specifier.startsWith("@/")
      ) {
        errors.push(`${label} uses forbidden import ${specifier}.`);
      }
    }
    for (const specifier of await runtimeSourceImports(source, path)) {
      if (specifier.startsWith(".") || specifier === SDK_PACKAGE_NAME) continue;
      const name = dependencyName(specifier);
      if (!runtimeDependencies.has(name)) {
        errors.push(`${label} imports undeclared runtime dependency ${name}.`);
      }
    }
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(extname(path)) ? [path] : [];
  });
}

function isInside(parent: string, child: string): boolean {
  const canonicalParent = realpathSync(parent);
  const candidate = existsSync(child) ? realpathSync(child) : resolve(child);
  return candidate === canonicalParent || candidate.startsWith(`${canonicalParent}${sep}`);
}
