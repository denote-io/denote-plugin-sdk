# Denote plugin SDK

The SDK for building [Denote](https://github.com/denote-io/denote) plugins.
It contains the plugin API 1 contracts and validation used by both Denote and
its plugins, capability helpers, and the `denote-plugin` command that builds,
checks, and packages a plugin.

Denote's optional plugins each live in their own repository in the
[denote-io](https://github.com/denote-io) organization and build with this SDK.

## Install

The SDK is installed from this repository, pinned to a release tag:

```bash
npm install github:denote-io/denote-plugin-sdk#v0.2.0
```

`@denote/plugin-sdk` ships TypeScript source, which bundlers such as Vite and
type checkers use directly. Node.js cannot load TypeScript from
`node_modules`, so the `node` export condition selects the bundled
`dist/index.js` instead; `npm run build` regenerates it and CI checks it is
current. Plugin bundles always compile the TypeScript source.

## Create a plugin

```bash
npx --package github:denote-io/denote-plugin-sdk#v0.2.0 \
  denote-plugin create denote-example denote.example "Example"
cd denote-example
npm install
npm run dev
```

The scaffold contains a manifest, guide, icon, activation entrypoint, test,
TypeScript and Vitest configuration, and CI and release workflows. The
[plugin ecosystem documentation](https://github.com/denote-io/denote/blob/main/docs/plugins.md)
describes the package contract, permissions, lifecycle, and security
boundaries.

## Plugin commands

Run these from a plugin repository. The scaffold exposes them as npm scripts.

| Command | Purpose |
| --- | --- |
| `denote-plugin build` | Bundle each declared entrypoint into one self-contained ES module in `dist/`. |
| `denote-plugin check [--artifacts]` | Validate the manifest, guide sections, package metadata, and import boundaries. `--artifacts` also requires built entrypoints without runtime imports. |
| `denote-plugin pack [--out <dir>]` | Write `<plugin-id>-<version>.tgz`, by default to `.plugin-artifacts/`. |
| `denote-plugin dev [--once]` | Rebuild `.plugin-dev/<plugin-id>.tgz` on every change. Load it in Denote Development from **Settings → Plugins → Load local plugin archive**. |
| `denote-plugin create <dir> <plugin-id> <name> [category]` | Scaffold a new plugin repository. |

The build, check, and pack commands need `vite`, `acorn`, `tar`, and `pako` as
development dependencies. The scaffold pins them.

### Reproducible archives

The same source and dependency graph always produce the same archive bytes:

- The archive contains only the declared entrypoints, legal files, guide, icon,
  `plugin.json`, and `package.json`, with fixed modes and no timestamps.
- Text files use LF line endings regardless of checkout settings.
- Compression uses `pako` 3.0.3 with its legacy hash mode, fixed gzip
  parameters, and a portable OS byte, not the platform's native zlib.
- Bundle module labels are independent of the checkout path: plugin modules
  appear as `plugins/<name>/…` and SDK modules as `packages/plugin-sdk/…`.
- The archived `package.json` keeps only `name`, `version`, `private`, `type`,
  `main`, `files`, and `dependencies`, with the SDK dependency recorded as the
  exact SDK version used for the build.

Pin Vite 8.3.8 with Rolldown 1.2.15, as the scaffold does, to keep the bundle
output stable. Changing the compiler, compressor, or their settings changes
archive bytes and requires a new plugin version.

## API compatibility

`api/v1/` holds the frozen declaration baseline for plugin API 1. CI fails if
the public declarations change. Review compatibility and Denote's
[API freeze and deprecation policy](https://github.com/denote-io/denote/blob/main/docs/plugins.md#api-1-freeze-and-deprecation-policy)
before explicitly recording a change:

```bash
npm run check:api -- --update-baseline
```

## Development

Use the Node.js version in `.node-version`.

```bash
npm ci
npm run check   # type check, tests, and the frozen API baseline
```

## Release

1. Bump `version` in `package.json`, run `npm run build`, and merge with CI
   passing.
2. Tag the merge commit `v<version>` and publish a GitHub release.
3. Update consumers to `github:denote-io/denote-plugin-sdk#v<version>`.

A plugin version that was already published keeps its archive bytes. Rebuild it
with a newer SDK only as a new plugin version.

## History

The SDK was developed in `packages/plugin-sdk` of
[mbianchidev/denote](https://github.com/mbianchidev/denote); that history is
preserved here. The `denote-plugin` command replaces the repository's former
plugin build, packaging, and scaffolding scripts.

## License

[MIT](LICENSE)
