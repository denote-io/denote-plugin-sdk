import { join } from "node:path";
import { artifactName, errorMessage, readPluginProject } from "./project.ts";

// Commands load their toolchain lazily, so `create` needs no build dependencies.

const USAGE = `Usage: denote-plugin <command>

Commands:
  build                     Build the declared entrypoints into dist/.
  check [--artifacts]       Validate the manifest, guide, imports, and (with
                            --artifacts) the built entrypoints.
  pack [--out <directory>]  Write a reproducible <id>-<version>.tgz archive
                            (default directory: .plugin-artifacts).
  dev [--once]              Rebuild .plugin-dev/<id>.tgz on every change.
  create <directory> <plugin-id> <display-name> [category]
                            Scaffold a new plugin repository.`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  switch (command) {
    case "build":
      expectNoArguments(args);
      await (await import("./build.ts")).buildPlugin();
      return 0;
    case "check": {
      const unknown = args.filter((argument) => argument !== "--artifacts");
      if (unknown.length) throw new Error(`Unknown check arguments: ${unknown.join(" ")}`);
      const { checkPlugin } = await import("./check.ts");
      const errors = await checkPlugin(process.cwd(), { artifacts: args.includes("--artifacts") });
      if (errors.length) {
        console.error(`Plugin validation failed:\n- ${errors.join("\n- ")}`);
        return 1;
      }
      const { manifest } = readPluginProject();
      console.log(`Validated ${manifest.id}@${manifest.version}.`);
      return 0;
    }
    case "pack": {
      const outIndex = args.indexOf("--out");
      const out = outIndex >= 0 ? args[outIndex + 1] : ".plugin-artifacts";
      if ((outIndex >= 0 && !out) || args.length !== (outIndex >= 0 ? 2 : 0)) {
        throw new Error("Usage: denote-plugin pack [--out <directory>]");
      }
      const { manifest } = readPluginProject();
      const destination = join(process.cwd(), out, artifactName(manifest));
      const { writePluginArchive } = await import("./archive.ts");
      const archive = await writePluginArchive(process.cwd(), destination);
      console.log(`Packed ${destination} (${archive.sizeBytes} bytes, sha256 ${archive.sha256}).`);
      return 0;
    }
    case "dev": {
      const unknown = args.filter((argument) => argument !== "--once");
      if (unknown.length) throw new Error(`Unknown dev arguments: ${unknown.join(" ")}`);
      const { developPlugin } = await import("./dev.ts");
      return (await developPlugin(process.cwd(), { once: args.includes("--once") })) ? 0 : 1;
    }
    case "create": {
      const [directory, pluginId, displayName, category, ...extra] = args;
      if (!directory || !pluginId || !displayName || extra.length) {
        throw new Error("Usage: denote-plugin create <directory> <plugin-id> <display-name> [category]");
      }
      const { createPlugin } = await import("./create.ts");
      const root = createPlugin({ directory, pluginId, displayName, category });
      console.log(`Created ${root}. Run npm install, then npm run dev while implementing it.`);
      return 0;
    }
    case undefined:
    case "help":
    case "--help":
      console.log(USAGE);
      return command === undefined ? 1 : 0;
    default:
      throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

function expectNoArguments(args: string[]): void {
  if (args.length) throw new Error(`Unexpected arguments: ${args.join(" ")}`);
}

export async function run(argv: string[]): Promise<void> {
  try {
    process.exitCode = await main(argv);
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}
