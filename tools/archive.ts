import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { create, list } from "tar";
import { Deflate, GZheader, Z_OK, zlibDeflateSetHeader } from "pako";
import type { PluginManifest } from "../src/index.ts";
import { archivedPackageJson } from "./package-metadata.ts";
import {
  MAX_PLUGIN_ENTRYPOINT_BYTES, MAX_PLUGIN_PACKAGE_BYTES, executableEntrypoints,
  readPluginProject, resolveSdkRoot, sdkVersion,
} from "./project.ts";

export interface PluginArchive {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
}

/** Files shipped in every plugin archive, in archive order. */
export function pluginPackagePaths(manifest: PluginManifest): string[] {
  return [
    ...executableEntrypoints(manifest),
    ...(manifest.legal ?? []),
    manifest.documentation,
    manifest.icon,
    "plugin.json",
    "package.json",
  ];
}

/** Writes a reproducible archive: fixed modes, no timestamps, LF text, portable gzip. */
export async function writePluginArchive(
  directory: string,
  destination: string,
): Promise<PluginArchive> {
  const { root, manifest, packageJson } = readPluginProject(directory);
  const packageText = archivedPackageJson(packageJson, sdkVersion(resolveSdkRoot(root)));
  mkdirSync(dirname(destination), { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), "denote-plugin-archive-"));
  let bytes: Buffer;
  try {
    const inputs = join(staging, "inputs");
    mkdirSync(inputs);
    let expandedBytes = 0;
    for (const path of pluginPackagePaths(manifest)) {
      let source: Buffer;
      if (path === "package.json") {
        source = Buffer.from(packageText);
      } else {
        const sourcePath = join(root, path);
        const stat = lstatSync(sourcePath);
        if (!stat.isFile() || stat.size > MAX_PLUGIN_PACKAGE_BYTES) {
          throw new Error(`Plugin package input must be a bounded regular file: ${path}`);
        }
        source = readFileSync(sourcePath);
      }
      const target = join(inputs, path);
      mkdirSync(dirname(target), { recursive: true });
      const text = path !== manifest.icon || path.endsWith(".svg");
      const content = text ? Buffer.from(source.toString("utf8").replace(/\r\n/g, "\n")) : source;
      expandedBytes += content.length;
      if (expandedBytes > MAX_PLUGIN_PACKAGE_BYTES) {
        throw new Error(`${manifest.id}@${manifest.version} exceeds the 25 MB expanded package limit.`);
      }
      writeFileSync(target, content, { mode: 0o644 });
      chmodSync(target, 0o644);
    }
    const tarPath = join(staging, "package.tar");
    await create(
      { cwd: inputs, file: tarPath, portable: true, noMtime: true, follow: false },
      pluginPackagePaths(manifest),
    );
    bytes = gzipPluginArchive(readFileSync(tarPath));
    if (bytes.length > MAX_PLUGIN_PACKAGE_BYTES) {
      throw new Error(`${manifest.id}@${manifest.version} exceeds the 25 MB plugin package limit.`);
    }
    const verified = join(staging, "archive.tgz");
    writeFileSync(verified, bytes);
    await verifyArchiveEntries(verified, manifest);
    // Rename within the destination directory: the staging area may be on another volume.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, bytes, { flag: "wx" });
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
  };
}

export function gzipPluginArchive(bytes: Uint8Array): Buffer {
  // Keep the established DEFLATE bytes and portable gzip header across Pako releases.
  const compressor = new Deflate({
    gzip: true,
    level: 6,
    legacyHash: true,
    memLevel: 8,
    windowBits: 15,
    strategy: 0,
  });
  compressor.onStart = (stream) => {
    const header = new GZheader();
    header.os = 0xff;
    header.time = 0;
    const status = zlibDeflateSetHeader(stream, header);
    if (status !== Z_OK) throw new Error(`Plugin archive gzip header setup failed: ${status}`);
  };
  if (!compressor.push(bytes, true) || compressor.err !== 0) {
    throw new Error(`Plugin archive compression failed: ${compressor.msg}`);
  }
  return Buffer.from(compressor.result);
}

/** Rejects unexpected, duplicate, non-file, or oversized archive entries. */
export async function verifyArchiveEntries(path: string, manifest: PluginManifest): Promise<void> {
  const expected = new Set(pluginPackagePaths(manifest));
  const executables = new Set(executableEntrypoints(manifest));
  const seen = new Set<string>();
  let expanded = 0;
  let failure: Error | undefined;
  await list({
    file: path,
    strict: true,
    onReadEntry(entry) {
      if (entry.type !== "File" || !expected.has(entry.path) || seen.has(entry.path)) {
        failure ??= new Error(`Plugin archive has an unexpected, duplicate, or unsafe entry: ${entry.path}`);
      }
      seen.add(entry.path);
      expanded += entry.size;
      if (expanded > MAX_PLUGIN_PACKAGE_BYTES ||
        (executables.has(entry.path) && entry.size > MAX_PLUGIN_ENTRYPOINT_BYTES)) {
        failure ??= new Error("Plugin archive exceeds expanded size limits.");
      }
      entry.resume();
    },
  });
  if (failure) throw failure;
  for (const name of expected) {
    if (!seen.has(name)) throw new Error(`Plugin archive is missing ${name}.`);
  }
}
