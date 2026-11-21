import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { writePluginArchive } from "./archive.ts";
import { buildPlugin } from "./build.ts";
import { errorMessage, readPluginProject } from "./project.ts";

/**
 * Rebuilds `.plugin-dev/<plugin-id>.tgz` for Denote Development's
 * Settings → Plugins → Load local plugin archive.
 */
export async function developPlugin(directory = process.cwd(), options: { once?: boolean } = {}): Promise<boolean> {
  const { root, manifest } = readPluginProject(directory);
  const destination = join(root, ".plugin-dev", `${manifest.id}.tgz`);
  let building = false;
  let queued = false;
  let timer: NodeJS.Timeout | null = null;

  async function rebuild(): Promise<boolean> {
    if (building) {
      queued = true;
      return false;
    }
    building = true;
    try {
      await buildPlugin(root);
      const archive = await writePluginArchive(root, destination);
      console.log(`Development archive ready: ${destination} (${archive.sizeBytes} bytes, ${archive.sha256.slice(0, 12)}…).`);
      console.log("In Denote Development, open Settings → Plugins and choose Load local plugin archive.");
      return true;
    } catch (error) {
      console.error(`Development plugin build failed: ${errorMessage(error)}`);
      return false;
    } finally {
      building = false;
      if (queued) {
        queued = false;
        await rebuild();
      }
    }
  }

  const built = await rebuild();
  if (options.once) return built;
  const watchers: FSWatcher[] = ["src", "plugin.json", "guide.md", "icon.svg", "package.json"].map((path) =>
    watch(join(root, path), { recursive: path === "src" }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 150);
    }));
  console.log("Watching plugin sources. Press Ctrl+C to stop.");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      for (const watcher of watchers) watcher.close();
      if (timer) clearTimeout(timer);
      resolve();
    });
  });
  return built;
}
