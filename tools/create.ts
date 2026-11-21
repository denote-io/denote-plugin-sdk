import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  PLUGIN_CATEGORIES, parsePluginManifest, type PluginCategory, type PluginManifest,
} from "../src/index.ts";
import { pluginShortName, resolveSdkRoot, sdkVersion } from "./project.ts";
import { developmentPackageJson, pluginRepositoryName, repositoryFiles } from "./template.ts";

export interface CreatePluginOptions {
  directory: string;
  pluginId: string;
  displayName: string;
  category?: string;
}

/** Scaffolds a standalone plugin repository that builds with this SDK. */
export function createPlugin(options: CreatePluginOptions): string {
  const { pluginId, displayName } = options;
  const requestedCategory = options.category ?? "other";
  if (!/^(?=.*\.)[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(pluginId)) {
    throw new Error("Plugin ID must be a namespaced lowercase identifier such as denote.example.");
  }
  if (!PLUGIN_CATEGORIES.includes(requestedCategory as PluginCategory)) {
    throw new Error(`Category must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`);
  }
  const root = resolve(options.directory);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(`Plugin directory is not empty: ${root}`);
  }
  const name = pluginShortName(pluginId);
  const repository = `https://github.com/denote-io/${pluginRepositoryName(pluginId)}`;
  const manifest: PluginManifest = parsePluginManifest({
    schemaVersion: 1,
    id: pluginId,
    name: displayName,
    version: "0.1.0",
    description: `Describe the ${displayName} plugin.`,
    publisher: { name: "Denote", url: repository },
    license: "MIT",
    repository,
    icon: "icon.svg",
    category: requestedCategory,
    compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.0", maximumDenoteVersion: "2.0.0" },
    permissions: [],
    entrypoint: "dist/index.js",
    documentation: "guide.md",
  });
  const packageJson = developmentPackageJson({
    name: `@denote/plugin-${name}`,
    version: manifest.version,
    type: "module",
    main: "./dist/index.js",
    files: ["dist", "plugin.json", "guide.md", "icon.svg"],
    dependencies: {},
  }, manifest, { sdkVersion: sdkVersion(resolveSdkRoot(root)) });
  const files: Record<string, string> = {
    ...repositoryFiles(),
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    "plugin.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "guide.md": guide(displayName),
    "icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="8" fill="#202327"/>
  <path d="M18 16h20l8 8v24H18z" fill="none" stroke="#b1cf98" stroke-width="4"/>
</svg>
`,
    "src/index.ts": `import {
  parsePluginManifest,
  type DenotePlugin,
} from "@denote/plugin-sdk";
import manifestJson from "../plugin.json";

const plugin: DenotePlugin = {
  manifest: parsePluginManifest(manifestJson),
  activate(context) {
    context.logger.info(${JSON.stringify(`${displayName} activated.`)});
  },
};

export default plugin;
`,
    "tests/manifest.test.ts": `import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@denote/plugin-sdk";
import manifest from "../plugin.json";

describe(${JSON.stringify(displayName)}, () => {
  it("declares a valid manifest", () => {
    expect(parsePluginManifest(manifest).id).toBe(${JSON.stringify(pluginId)});
  });
});
`,
  };
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function guide(displayName: string): string {
  return `# ${displayName}

## Purpose

Describe the problem this plugin solves.

## Enablement and permissions

Explain every requested permission and why it is necessary.

## Usage

Document commands, views, and expected workflows.

## Settings

Document settings, or state that the plugin has none.

## Disable behavior

Explain retained data and confirm that package code is deleted.

## Troubleshooting

List actionable recovery steps and known limitations.
`;
}
