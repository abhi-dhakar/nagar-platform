export type TrustProxySetting = boolean | string[] | ((address: string, hop: number) => boolean);

/**
 * Parses the `TRUST_PROXY` setting for Fastify.
 *
 * - unset / "false" / "0"  → do not trust forwarded headers (default, safest)
 * - "true"                 → trust every hop (only behind a proxy you control)
 * - a positive integer N   → trust the N proxies closest to the API
 * - anything else          → comma-separated proxy IPs/CIDRs
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === "false" || normalized === "0") return false;
  if (normalized.toLowerCase() === "true") return true;
  if (/^\d+$/.test(normalized)) {
    const hops = Number(normalized);
    return (_address, hop) => hop < hops;
  }
  return normalized
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
