import { describe, expect, it } from "vitest";
import { isPluginSensitiveToolRegistration, parsePluginManifest } from "./index";
import speech from "./test-fixtures/speech.plugin.json";
import credentials from "./test-fixtures/credential-store.plugin.json";
import sync from "./test-fixtures/sync.plugin.json";

describe("sensitive tool boundaries", () => {
  it("accepts only closed declarative registrations without sensitive payloads or functions", () => {
    const tool = { id: "denote.speech.local", title: "Speech", feature: "speech" };
    expect(isPluginSensitiveToolRegistration(tool)).toBe(true);
    for (const extra of [{ source: "invented text" }, { secret: "invented secret" }, { run: () => {} }, { type: "log" }]) {
      expect(isPluginSensitiveToolRegistration({ ...tool, ...extra })).toBe(false);
    }
    expect(isPluginSensitiveToolRegistration({ ...tool, title: "Untrusted\nlabel" })).toBe(false);
    expect(isPluginSensitiveToolRegistration({ ...tool, feature: "microphone" })).toBe(false);
    expect(isPluginSensitiveToolRegistration({ id: "denote.sync.host", title: "Sync", feature: "sync" })).toBe(true);
  });

  it.each([speech, credentials, sync])("keeps $id isolated from unrelated data and network capabilities", (manifest) => {
    expect(parsePluginManifest(manifest).permissions).toHaveLength(1);
    for (const capability of ["network", "process", "workspace-read", "workspace-write", "clocks", "secure-storage", "commands", "speech"]) {
      const permission = capability === "network" ? { capability, hosts: ["synthetic.invalid"] } :
        capability === "process" ? { capability, executables: { linux: ["synthetic"] } } : { capability };
      expect(() => parsePluginManifest({ ...manifest, permissions: [...manifest.permissions, permission] })).toThrow(/sensitive/i);
    }
  });
});
