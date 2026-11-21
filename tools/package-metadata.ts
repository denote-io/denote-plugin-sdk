// Kept free of build dependencies so plugin tests can import it.
const SDK_PACKAGE_NAME = "@denote/plugin-sdk";
const ARCHIVED_PACKAGE_FIELDS = ["name", "version", "private", "type", "main", "files", "dependencies"];

/**
 * The package metadata shipped in an archive. Development-only fields such as
 * scripts and devDependencies stay in the repository, and the SDK dependency
 * records the exact SDK version the bundle was built against.
 */
export function archivedPackageJson(packageJson: Readonly<Record<string, unknown>>, sdk: string): string {
  const archived: Record<string, unknown> = {};
  for (const field of ARCHIVED_PACKAGE_FIELDS) {
    if (packageJson[field] === undefined) continue;
    archived[field] = field === "dependencies" && isRecord(packageJson.dependencies)
      ? Object.fromEntries(Object.entries(packageJson.dependencies)
        .map(([name, spec]) => [name, name === SDK_PACKAGE_NAME ? sdk : spec]))
      : packageJson[field];
  }
  return `${JSON.stringify(archived, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
