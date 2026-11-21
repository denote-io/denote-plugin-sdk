import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePluginManifest, type PluginManifest } from "../src/index.ts";

export const SDK_PACKAGE_NAME = "@denote/plugin-sdk";
export const MAX_PLUGIN_PACKAGE_BYTES = 25 * 1024 * 1024;
export const MAX_PLUGIN_ENTRYPOINT_BYTES = 10 * 1024 * 1024;

export interface PluginPackageJson {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  type?: unknown;
  main?: unknown;
  files?: unknown;
  bin?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  [key: string]: unknown;
}

export interface PluginProject {
  root: string;
  manifest: PluginManifest;
  packageJson: PluginPackageJson;
  /** Short plugin name, such as `kanban` for `denote.kanban`. */
  name: string;
}

export function readPluginProject(directory = process.cwd()): PluginProject {
  const root = realpathSync(resolve(directory));
  const manifestPath = join(root, "plugin.json");
  const packagePath = join(root, "package.json");
  if (!existsSync(manifestPath)) throw new Error(`${root} is missing plugin.json.`);
  if (!existsSync(packagePath)) throw new Error(`${root} is missing package.json.`);
  const manifest = parsePluginManifest(readJson(manifestPath));
  const packageJson = readJson(packagePath);
  if (!isRecord(packageJson)) throw new Error("package.json must contain an object.");
  return { root, manifest, packageJson, name: pluginShortName(manifest.id) };
}

export function pluginShortName(pluginId: string): string {
  const name = pluginId.split(".").pop();
  if (!name) throw new Error(`Plugin ID ${pluginId} does not contain a package name.`);
  return name;
}

export function artifactName(manifest: Pick<PluginManifest, "id" | "version">): string {
  return `${manifest.id}-${manifest.version}.tgz`;
}

export function sourceEntrypoint(entrypoint: string): string {
  return entrypoint.replace(/^dist\//, "src/").replace(/\.js$/, ".ts");
}

export function executableEntrypoints(manifest: PluginManifest): string[] {
  return [
    manifest.entrypoint,
    ...(manifest.diagramRenderer ? [manifest.diagramRenderer.entrypoint] : []),
  ];
}

/** Resolves the SDK package that the plugin project builds against. */
export function resolveSdkRoot(projectRoot: string): string {
  const require = createRequire(join(projectRoot, "package.json"));
  try {
    return realpathSync(dirname(require.resolve(`${SDK_PACKAGE_NAME}/package.json`)));
  } catch {
    // The SDK repository builds its own fixtures against itself.
    return realpathSync(fileURLToPath(new URL("..", import.meta.url)));
  }
}

export function sdkVersion(sdkRoot: string): string {
  const value = readJson(join(sdkRoot, "package.json"));
  if (!isRecord(value) || typeof value.version !== "string") {
    throw new Error("The plugin SDK package has no version.");
  }
  return value.version;
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`Unable to parse ${path}: ${errorMessage(error)}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
