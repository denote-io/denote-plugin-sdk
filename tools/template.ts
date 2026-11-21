import type { PluginManifest } from "../src/index.ts";
import { SDK_PACKAGE_NAME, pluginShortName } from "./project.ts";

export const SDK_REPOSITORY = "denote-io/denote-plugin-sdk";
export const NODE_VERSION = "26.12.1";

/** Shared build and test toolchain for plugin repositories. */
export const PLUGIN_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  "@types/node": "^26.6.6",
  acorn: "^8.19.0",
  jsdom: "^31.0.1",
  pako: "3.0.3",
  tar: "^7.5.23",
  tsx: "^4.23.15",
  typescript: "^7.0.2",
  vite: "8.3.8",
  vitest: "^5.1.0",
};

/** npm install-script policy: only esbuild's binary check may run. */
export const PLUGIN_ALLOW_SCRIPTS: Readonly<Record<string, boolean>> = { "esbuild@0.28.2": true, fsevents: false };

/** Rolldown 1.2.15 keeps archive bytes stable for the pinned Vite 8.3.8 build. */
export const PLUGIN_OVERRIDES: Readonly<Record<string, string>> = { rolldown: "1.2.15" };

export const PLUGIN_SCRIPTS: Readonly<Record<string, string>> = {
  build: "denote-plugin build",
  check: "denote-plugin check",
  typecheck: "tsc --noEmit",
  test: "vitest run",
  package: "denote-plugin build && denote-plugin check --artifacts && denote-plugin pack",
  dev: "denote-plugin dev",
};

export function sdkDependencySpec(sdkVersion: string): string {
  return `github:${SDK_REPOSITORY}#v${sdkVersion}`;
}

export function pluginRepositoryName(pluginId: string): string {
  return `denote-${pluginShortName(pluginId)}`;
}

export interface DevelopmentPackageOptions {
  sdkVersion: string;
  extraDevDependencies?: Record<string, string>;
}

/**
 * Adds repository development fields to a plugin package.json. Only the
 * archived fields (see `archivedPackageJson`) ship inside the plugin archive.
 */
export function developmentPackageJson(
  base: Record<string, unknown>,
  manifest: PluginManifest,
  options: DevelopmentPackageOptions,
): Record<string, unknown> {
  const dependencies = { ...(base.dependencies as Record<string, string> | undefined) };
  dependencies[SDK_PACKAGE_NAME] = sdkDependencySpec(options.sdkVersion);
  return {
    name: base.name,
    version: base.version,
    private: true,
    description: manifest.description,
    license: manifest.license,
    repository: {
      type: "git",
      url: `git+https://github.com/denote-io/${pluginRepositoryName(manifest.id)}.git`,
    },
    type: base.type ?? "module",
    main: base.main ?? "./dist/index.js",
    files: base.files,
    engines: { node: "^22.22.2 || ^24.15.0 || >=26.0.0" },
    scripts: { ...PLUGIN_SCRIPTS },
    dependencies: sortRecord(dependencies),
    devDependencies: sortRecord({ ...PLUGIN_DEV_DEPENDENCIES, ...options.extraDevDependencies }),
    overrides: { ...PLUGIN_OVERRIDES },
    allowScripts: { ...PLUGIN_ALLOW_SCRIPTS },
  };
}

export interface RepositoryFileOptions {
  /**
   * A published version whose archive was built against an earlier SDK
   * revision and therefore cannot be rebuilt byte for byte. CI only warns for
   * this exact version; any later version must reproduce.
   */
  unreproducibleVersion?: string;
}

/** Configuration and automation files shared by every plugin repository. */
export function repositoryFiles(options: RepositoryFileOptions = {}): Record<string, string> {
  return {
    ".node-version": `${NODE_VERSION}\n`,
    ".gitignore": [
      "node_modules/",
      "dist/",
      ".plugin-artifacts/",
      ".plugin-dev/",
      ".published/",
      "*.tgz",
      "",
    ].join("\n"),
    ".gitattributes": "* text=auto eol=lf\n*.png binary\n",
    "tsconfig.json": `${JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: ["node"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ["src", "tests", "plugin.json"],
    }, null, 2)}\n`,
    "vitest.config.ts": [
      'import { defineConfig } from "vitest/config";',
      "",
      "export default defineConfig({",
      "  test: {",
      '    environment: "jsdom",',
      '    include: ["tests/**/*.test.ts"],',
      "    // The SDK ships TypeScript source, which Node cannot load from node_modules.",
      `    server: { deps: { inline: ["${SDK_PACKAGE_NAME}"] } },`,
      "  },",
      "});",
      "",
    ].join("\n"),
    ".github/workflows/ci.yml": ciWorkflow(options),
    ".github/workflows/release.yml": releaseWorkflow(options),
  };
}

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const SETUP_NODE = "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0";
const UPLOAD_ARTIFACT = "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2";

function validationSteps(options: RepositoryFileOptions): string {
  return `      - uses: ${CHECKOUT}
        with:
          persist-credentials: false

      - uses: ${SETUP_NODE}
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install dependencies
        run: npm ci --no-audit

      - name: Audit dependencies
        run: npm audit --audit-level=high

      - name: Type check
        run: npm run typecheck

      - name: Test
        run: npm test

      - name: Validate plugin source
        run: npm run check

      - name: Build and package
        run: npm run package

      - name: Verify the published version still reproduces
        env:
          GH_TOKEN: \${{ github.token }}
          UNREPRODUCIBLE_VERSION: "${options.unreproducibleVersion ?? ""}"
        run: |
          id="$(node -p 'require("./plugin.json").id')"
          version="$(node -p 'require("./plugin.json").version')"
          archive="$id-$version.tgz"
          if ! gh release view "v$version" >/dev/null 2>&1; then
            echo "v$version is not published yet."
            exit 0
          fi
          gh release download "v$version" --pattern "$archive" --dir .published
          if ! cmp -s ".published/$archive" ".plugin-artifacts/$archive"; then
            if [ "$version" = "$UNREPRODUCIBLE_VERSION" ]; then
              echo "::warning::v$version was built against an earlier SDK revision and does not reproduce with this SDK. Its published bytes stay authoritative; the next version must reproduce."
              exit 0
            fi
            echo "::error::The source no longer reproduces the published v$version archive. Released versions are immutable; bump the version."
            exit 1
          fi
          echo "Rebuilt $archive matches the published v$version asset."
`;
}

function ciWorkflow(options: RepositoryFileOptions): string {
  return `name: CI

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest
    steps:
${validationSteps(options)}
      - name: Upload plugin archive
        uses: ${UPLOAD_ARTIFACT}
        with:
          name: plugin-archive
          path: .plugin-artifacts/*.tgz
          if-no-files-found: error
`;
}

function releaseWorkflow(options: RepositoryFileOptions): string {
  return `name: Release

# Publishes the version in plugin.json as an immutable GitHub release asset.
# Bump plugin.json and package.json together before running this workflow.
on:
  workflow_dispatch:

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    steps:
${validationSteps(options)}
      - name: Publish release
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          id="$(node -p 'require("./plugin.json").id')"
          version="$(node -p 'require("./plugin.json").version')"
          name="$(node -p 'require("./plugin.json").name')"
          tag="v$version"
          archive=".plugin-artifacts/$id-$version.tgz"
          if gh release view "$tag" >/dev/null 2>&1; then
            echo "::error::$tag is already published. Released versions are immutable; bump the version."
            exit 1
          fi
          sha256="$(sha256sum "$archive" | cut -d' ' -f1)"
          size="$(stat -c%s "$archive")"
          printf '%s\\n' \\
            "$name $version for Denote." \\
            "" \\
            "Asset: \\\`$id-$version.tgz\\\`" \\
            "SHA-256: \\\`$sha256\\\`" \\
            "Size: $size bytes" \\
            "Source: $GITHUB_SHA" > release-notes.md
          gh release create "$tag" "$archive" --target "$GITHUB_SHA" --title "$name $version" --notes-file release-notes.md
`;
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
