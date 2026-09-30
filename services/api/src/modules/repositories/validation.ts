export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,37}[a-z0-9])?$/;
export const REPOSITORY_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/;

export function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 2 && normalized.length <= 39 && USERNAME_PATTERN.test(normalized)
    ? normalized
    : null;
}

export function normalizeRepositorySlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < 1 ||
    normalized.length > 100 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.endsWith(".git") ||
    !REPOSITORY_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeRepositoryPath(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 512 || value.startsWith("/")) return null;
  if (/[\\\0\r\n]/.test(value)) return null;
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return value;
}

export function stringField(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : null;
}
