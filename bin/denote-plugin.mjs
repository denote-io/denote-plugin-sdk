#!/usr/bin/env node
// The SDK ships TypeScript source; tsx loads it, including from node_modules.
import { register } from "tsx/esm/api";

register();
const { run } = await import("../tools/cli.ts");
await run(process.argv.slice(2));
