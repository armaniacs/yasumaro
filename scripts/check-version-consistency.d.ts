export const VERSION_FILES: string[];
export function extractVersion(content: string, filePath: string): string | null;
export function readVersions(rootDir: string): Record<string, string>;
export function checkVersionConsistency(rootDir: string): { consistent: boolean; versions: Record<string, string> };
