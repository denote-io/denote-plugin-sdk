import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { build, type Plugin } from "vite";
import type { PluginManifest } from "../src/index.ts";
import {
  readPluginProject, resolveSdkRoot, sourceEntrypoint, type PluginProject,
} from "./project.ts";

/** Package-export conditions used for each kind of bundled entrypoint. */
export function pluginEntrypointConditions(kind: "worker" | "diagram-renderer"): string[] {
  return kind === "worker" ? ["worker"] : [];
}

/**
 * Builds every declared entrypoint into one self-contained ES module.
 * Activation workers must not load other modules at runtime.
 */
export async function buildPlugin(directory = process.cwd()): Promise<PluginManifest> {
  const project = readPluginProject(directory);
  const { manifest, root } = project;
  const sdkRoot = resolveSdkRoot(root);
  const entrypoints = [
    { path: manifest.entrypoint, minify: false, conditions: pluginEntrypointConditions("worker") },
    ...(manifest.diagramRenderer
      ? [{
          path: manifest.diagramRenderer.entrypoint,
          minify: true,
          conditions: pluginEntrypointConditions("diagram-renderer"),
        }]
      : []),
  ];
  for (const [index, entrypoint] of entrypoints.entries()) {
    const outputPath = join(root, entrypoint.path);
    await build({
      configFile: false,
      root,
      publicDir: false,
      logLevel: "error",
      plugins: [
        pluginBoundary(root, sdkRoot),
        stableSourceLabels(project, sdkRoot),
      ],
      resolve: { conditions: entrypoint.conditions },
      build: {
        emptyOutDir: index === 0,
        minify: entrypoint.minify,
        sourcemap: false,
        outDir: dirname(outputPath),
        lib: {
          entry: join(root, sourceEntrypoint(entrypoint.path)),
          formats: ["es"],
          fileName: () => basename(outputPath),
        },
        rolldownOptions: { output: { codeSplitting: false } },
      },
    });
  }
  console.log(`Built ${manifest.id}@${manifest.version}.`);
  return manifest;
}

/**
 * Maps a bundled module to a checkout-independent debug label. Plugin modules
 * use `plugins/<name>/...` and SDK modules use `packages/plugin-sdk/...`, the
 * labels of every archive published since API 1, so the same source and
 * dependency graph produce the same bytes in any checkout.
 */
export function stableModuleLabel(
  moduleId: string, project: Pick<PluginProject, "root" | "name">, sdkRoot: string,
): { from: string; to: string } | null {
  const path = moduleId.split("?")[0];
  if (path.startsWith("\0")) return null;
  const portable = (value: string) => value.split(sep).join("/").replace(/\\/g, "/");
  const from = portable(relative(project.root, path));
  const inside = (parent: string) => path === parent || path.startsWith(`${parent}${sep}`) ||
    portable(path).startsWith(`${portable(parent)}/`);
  if (inside(sdkRoot)) {
    return { from, to: `packages/plugin-sdk/${portable(relative(sdkRoot, path))}` };
  }
  if (from.startsWith("../") || from.startsWith("node_modules/") || from.includes("/node_modules/")) {
    return null;
  }
  return { from, to: `plugins/${project.name}/${from}` };
}

function stableSourceLabels(project: PluginProject, sdkRoot: string): Plugin {
  return {
    name: "denote-stable-plugin-source-labels",
    renderChunk(code, chunk) {
      let output = code;
      for (const moduleId of chunk.moduleIds) {
        const label = stableModuleLabel(moduleId, project, sdkRoot);
        if (!label || label.from === label.to) continue;
        output = output.split(`\n// ${label.from}\n`).join(`\n// ${label.to}\n`);
        if (output.startsWith(`// ${label.from}\n`)) {
          output = `// ${label.to}\n${output.slice(label.from.length + 4)}`;
        }
      }
      return output === code ? null : { code: output, map: null };
    },
  };
}

function pluginBoundary(pluginRoot: string, sdkRoot: string): Plugin {
  return {
    name: "denote-plugin-boundary",
    moduleParsed(moduleInfo) {
      const modulePath = moduleInfo.id.split("?")[0];
      if (modulePath.startsWith("\0") || !existsSync(modulePath)) return;
      const canonicalPath = realpathSync(modulePath);
      if (
        canonicalPath === pluginRoot ||
        canonicalPath.startsWith(`${pluginRoot}${sep}`) ||
        canonicalPath === sdkRoot ||
        canonicalPath.startsWith(`${sdkRoot}${sep}`) ||
        canonicalPath.includes(`${sep}node_modules${sep}`)
      ) {
        return;
      }
      this.error(`Plugin module resolves outside its package: ${canonicalPath}.`);
    },
  };
}
