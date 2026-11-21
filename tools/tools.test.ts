// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  archivedPackageJson, checkPlugin, gzipPluginArchive, stableModuleLabel, writePluginArchive,
} from "./index.ts";

const GUIDE = ["Purpose", "Enablement and permissions", "Usage", "Settings", "Disable behavior", "Troubleshooting"]
  .map((heading) => `## ${heading}\n\nSynthetic text.\n`).join("\n");

function fixture(manifestOverrides: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "denote-sdk-tools-"));
  const manifest = {
    schemaVersion: 1,
    id: "denote.synthetic",
    name: "Synthetic plugin",
    version: "1.0.0",
    description: "Synthetic plugin.",
    publisher: { name: "Synthetic publisher" },
    license: "MIT",
    repository: "https://github.com/example/synthetic",
    icon: "icon.svg",
    category: "other",
    compatibility: { apiVersion: 1, minimumDenoteVersion: "0.1.0" },
    permissions: [],
    entrypoint: "dist/index.js",
    documentation: "guide.md",
    ...manifestOverrides,
  };
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "plugin.json"), JSON.stringify(manifest));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@denote/plugin-synthetic",
    version: "1.0.0",
    private: true,
    type: "module",
    main: "./dist/index.js",
    files: ["dist", "plugin.json", "guide.md", "icon.svg"],
    scripts: { build: "denote-plugin build" },
    dependencies: { "@denote/plugin-sdk": "github:denote-io/denote-plugin-sdk#v0.1.0" },
    devDependencies: { vite: "8.3.8" },
  }));
  writeFileSync(join(root, "guide.md"), `# Synthetic guide\n\n${GUIDE}`);
  writeFileSync(join(root, "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
  writeFileSync(join(root, "dist/index.js"), "export default {};\n");
  writeFileSync(join(root, "src/index.ts"), "import { parsePluginManifest } from \"@denote/plugin-sdk\";\nexport default parsePluginManifest;\n");
  return { root, manifest };
}

describe("plugin archives", () => {
  it("retains canonical gzip bytes across Node and native zlib implementations", () => {
    const data = Buffer.from(Array.from({ length: 2048 }, (_, id) => JSON.stringify({
      id,
      text: `Synthetic paragraph ${id % 73}`,
      unicode: ["😄", "👋🏽", "🧑‍💻"][id % 3],
    })).join("\n"));
    const bytes = gzipPluginArchive(data);
    expect([...bytes.subarray(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 0, 255]);
    expect(bytes.length).toBe(10504);
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe("297528e97723f846da2f8dbcb3c3fae880c1e2f3b249b19ee95a4e36f0ec4652");
    expect(gunzipSync(bytes)).toEqual(data);
  });

  it("ships only archived package fields and records the built SDK version", () => {
    expect(JSON.parse(archivedPackageJson({
      name: "@denote/plugin-synthetic",
      version: "1.0.0",
      private: true,
      description: "Development only",
      type: "module",
      scripts: { build: "denote-plugin build" },
      dependencies: { "@denote/plugin-sdk": "github:denote-io/denote-plugin-sdk#v0.1.0", yaml: "2.9.1" },
      devDependencies: { vite: "8.3.8" },
    }, "0.1.0"))).toEqual({
      name: "@denote/plugin-synthetic",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: { "@denote/plugin-sdk": "0.1.0", yaml: "2.9.1" },
    });
  });

  it("normalizes checkout line endings for deterministic archives", async () => {
    const { root } = fixture();
    const first = await writePluginArchive(root, join(root, "lf.tgz"));
    writeFileSync(join(root, "guide.md"), `# Synthetic guide\r\n\r\n${GUIDE.replace(/\n/g, "\r\n")}`);
    writeFileSync(join(root, "dist/index.js"), "export default {};\r\n");
    const second = await writePluginArchive(root, join(root, "crlf.tgz"));
    expect(second.bytes).toEqual(first.bytes);
    expect(second.sha256).toBe(first.sha256);
  });

  it("bounds total expanded input before replacing existing output", async () => {
    const { root } = fixture();
    const output = join(root, "existing.tgz");
    writeFileSync(output, "synthetic existing output");
    const content = Buffer.alloc(13 * 1024 * 1024, "a");
    writeFileSync(join(root, "dist/index.js"), content);
    writeFileSync(join(root, "guide.md"), content);
    await expect(writePluginArchive(root, output)).rejects.toThrow("expanded package limit");
    expect(readFileSync(output, "utf8")).toBe("synthetic existing output");
  });

  it.each(["worker", "diagram renderer"])("accepts a 10 MiB %s entrypoint and rejects one byte more", async (kind) => {
    const renderer = kind === "diagram renderer";
    const { root } = fixture(renderer
      ? { permissions: [{ capability: "diagram-renderer" }], diagramRenderer: { entrypoint: "dist/renderer.js" } }
      : {});
    const entrypoint = join(root, renderer ? "dist/renderer.js" : "dist/index.js");
    const limit = 10 * 1024 * 1024;
    writeFileSync(entrypoint, Buffer.alloc(limit, " "));
    await expect(writePluginArchive(root, join(root, "bounded.tgz"))).resolves.toBeDefined();
    writeFileSync(entrypoint, Buffer.alloc(limit + 1, " "));
    await expect(writePluginArchive(root, join(root, "bounded.tgz"))).rejects.toThrow("expanded size limits");
  });
});

describe("plugin builds", () => {
  it("labels plugin and SDK modules independently of the checkout", () => {
    const project = { root: "/synthetic/repo", name: "synthetic" };
    const sdk = "/synthetic/repo/node_modules/@denote/plugin-sdk";
    expect(stableModuleLabel("/synthetic/repo/src/index.ts", project, sdk))
      .toEqual({ from: "src/index.ts", to: "plugins/synthetic/src/index.ts" });
    expect(stableModuleLabel(`${sdk}/src/contracts.ts`, project, sdk))
      .toEqual({ from: "node_modules/@denote/plugin-sdk/src/contracts.ts", to: "packages/plugin-sdk/src/contracts.ts" });
    expect(stableModuleLabel("/elsewhere/sdk/src/contracts.ts", project, "/elsewhere/sdk"))
      .toEqual({ from: "../../elsewhere/sdk/src/contracts.ts", to: "packages/plugin-sdk/src/contracts.ts" });
    expect(stableModuleLabel("/synthetic/repo/node_modules/yaml/dist/index.js", project, sdk)).toBeNull();
    expect(stableModuleLabel("\0rolldown/runtime.js", project, sdk)).toBeNull();
  });
});

describe("plugin checks", () => {
  it("accepts a valid plugin project", async () => {
    const { root } = fixture();
    await expect(checkPlugin(root, { artifacts: true })).resolves.toEqual([]);
  });

  it("reports guide, version, boundary, and dependency problems", async () => {
    const { root } = fixture();
    writeFileSync(join(root, "guide.md"), "# Synthetic guide\n");
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      ...packageJson, version: "2.0.0", dependencies: { "@denote/plugin-other": "1.0.0" },
    }));
    writeFileSync(join(root, "src/index.ts"), [
      'import "../../outside";',
      'import "@tauri-apps/api";',
      'import "yaml";',
      "",
    ].join("\n"));
    writeFileSync(join(root, "dist/index.js"), 'import "yaml";\n');
    const errors = await checkPlugin(root, { artifacts: true });
    expect(errors).toEqual(expect.arrayContaining([
      'Guide is missing the "purpose" section.',
      "package.json and plugin.json versions must match.",
      "Plugins cannot depend on another plugin package: @denote/plugin-other.",
      "src/index.ts imports outside its plugin folder: ../../outside.",
      "src/index.ts uses forbidden import @tauri-apps/api.",
      "src/index.ts imports undeclared runtime dependency yaml.",
      "dist/index.js contains a runtime import and is not self-contained.",
    ]));
  });
});
