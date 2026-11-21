// Bundles the SDK into dist/index.js for runtimes that cannot load TypeScript
// from node_modules, such as plain Node.js and Playwright. Bundlers keep using
// the TypeScript source, so plugin archives are unaffected.
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  configFile: false,
  root,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    target: "es2022",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rolldownOptions: {
      external: ["semver"],
      output: { codeSplitting: false },
    },
  },
});
