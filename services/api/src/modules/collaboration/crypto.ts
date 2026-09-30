import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

function encryptionKey(): Buffer {
  const value = process.env.NAGAR_WEBHOOK_ENCRYPTION_KEY?.trim();
  if (!value)
    throw new Error("NAGAR_WEBHOOK_ENCRYPTION_KEY must be configured to manage webhooks.");
  const key = /^[a-f\d]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32)
    throw new Error("NAGAR_WEBHOOK_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

export function encryptWebhookSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    secretCiphertext: ciphertext.toString("base64url"),
    secretIv: iv.toString("base64url"),
    secretTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptWebhookSecret(input: {
  secretCiphertext: string;
  secretIv: string;
  secretTag: string;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(input.secretIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(input.secretTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(input.secretCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function webhookSignature(secret: string, payload: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  const expected = Buffer.from(webhookSignature(secret, payload));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function ipv6Number(address: string): bigint | null {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const result: number[] = [];
    for (const part of side.split(":")) {
      if (part.includes(".")) {
        const octets = part.split(".").map(Number);
        if (octets.length !== 4 || octets.some((value) => value < 0 || value > 255)) return null;
        result.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else {
        const value = Number.parseInt(part, 16);
        if (!part || !Number.isFinite(value) || value < 0 || value > 0xffff) return null;
        result.push(value);
      }
    }
    return result;
  };
  const left = parseSide(halves[0] ?? "");
  const right = parseSide(halves[1] ?? "");
  if (!left || !right) return null;
  const gap = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (gap < 0 || (halves.length === 1 && left.length !== 8)) return null;
  const groups = [...left, ...Array.from({ length: gap }, () => 0), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6Prefix(address: string, network: string, bits: number): boolean {
  const value = ipv6Number(address);
  const base = ipv6Number(network);
  if (value === null || base === null) return false;
  const shift = 128n - BigInt(bits);
  return value >> shift === base >> shift;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || (b === 88 && c === 99) || b === 168 || (b === 2 && c === 0))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (version === 6) {
    const value = ipv6Number(address);
    if (value === null) return true;
    if (ipv6Prefix(address, "::ffff:0:0", 96)) {
      const mapped = Number(value & 0xffffffffn);
      return isPrivateAddress(
        `${mapped >>> 24}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`,
      );
    }
    return (
      value === 0n ||
      value === 1n ||
      ipv6Prefix(address, "::", 96) ||
      ipv6Prefix(address, "fc00::", 7) ||
      ipv6Prefix(address, "fe80::", 10) ||
      ipv6Prefix(address, "fec0::", 10) ||
      ipv6Prefix(address, "ff00::", 8) ||
      ipv6Prefix(address, "2001:db8::", 32) ||
      ipv6Prefix(address, "2001:10::", 28) ||
      ipv6Prefix(address, "2001:2::", 48) ||
      ipv6Prefix(address, "2002::", 16) ||
      ipv6Prefix(address, "64:ff9b::", 96) ||
      ipv6Prefix(address, "64:ff9b:1::", 48)
    );
  }
  return true;
}

export async function lookupPublicWebhook(
  input: string,
): Promise<{ address: string; family: 4 | 6 } | null> {
  const url = new URL(input);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  if (family)
    return isPrivateAddress(hostname) ? null : { address: hostname, family: family === 6 ? 6 : 4 };
  try {
    const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) return null;
    const chosen = addresses[0];
    return chosen ? { address: chosen.address, family: chosen.family === 6 ? 6 : 4 } : null;
  } catch {
    return null;
  }
}

export async function validateWebhookUrl(input: unknown): Promise<string | null> {
  if (typeof input !== "string" || input.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return null;
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
    return null;
  return (await lookupPublicWebhook(url.toString())) ? url.toString() : null;
}
