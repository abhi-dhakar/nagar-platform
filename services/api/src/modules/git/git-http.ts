import { spawn } from "node:child_process";
import { devNull } from "node:os";

const MAX_GIT_RESPONSE_BYTES = 128 * 1024 * 1024;
const GIT_TIMEOUT_MS = 120_000;

export interface GitBackendRequest {
  method: string;
  url: string;
  pathInfo: string;
  projectRoot: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Buffer;
  remoteAddress: string;
  remoteUser?: string;
}

export interface GitBackendResponse {
  statusCode: number;
  headers: Array<[string, string]>;
  body: Buffer;
}

export async function runGitHttpBackend(request: GitBackendRequest): Promise<GitBackendResponse> {
  const parsedUrl = new URL(request.url, "http://nagar.local");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: request.projectRoot,
    GIT_HTTP_EXPORT_ALL: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    PATH_INFO: request.pathInfo,
    REQUEST_METHOD: request.method,
    QUERY_STRING: parsedUrl.search.slice(1),
    REQUEST_URI: request.url,
    SERVER_PROTOCOL: "HTTP/1.1",
    REMOTE_ADDR: request.remoteAddress,
    CONTENT_TYPE: request.headers["content-type"]?.toString() ?? "",
    CONTENT_LENGTH: String(request.body?.length ?? 0),
    HTTP_HOST: request.headers.host?.toString() ?? "localhost",
    ...(request.remoteUser ? { REMOTE_USER: request.remoteUser } : {}),
  };

  const gitProtocol = request.headers["git-protocol"]?.toString();
  if (gitProtocol) env.HTTP_GIT_PROTOCOL = gitProtocol;
  for (const [key, value] of Object.entries(request.headers)) {
    if (
      !value ||
      ["authorization", "cookie", "host", "content-length", "content-type", "connection"].includes(
        key,
      )
    ) {
      continue;
    }
    const normalized = key.toUpperCase().replaceAll("-", "_");
    env[`HTTP_${normalized}`] = Array.isArray(value) ? value.join(", ") : value;
  }

  const raw = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", ["http-backend"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error("Git HTTP backend timed out."));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_GIT_RESPONSE_BYTES && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        reject(new Error("Git HTTP response exceeded the configured limit."));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(errors).length < 32 * 1024) errors.push(chunk.subarray(0, 32 * 1024));
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `git http-backend exited with ${code}: ${Buffer.concat(errors).toString("utf8")}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(request.body);
  });

  const crlfBoundary = raw.indexOf(Buffer.from("\r\n\r\n"));
  const lfBoundary = raw.indexOf(Buffer.from("\n\n"));
  const useCrlf = crlfBoundary >= 0 && (lfBoundary < 0 || crlfBoundary <= lfBoundary);
  const boundary = useCrlf ? crlfBoundary : lfBoundary;
  if (boundary < 0) throw new Error("Git HTTP backend returned malformed CGI headers.");
  const separatorLength = useCrlf ? 4 : 2;
  const headerText = raw.subarray(0, boundary).toString("latin1");
  const body = raw.subarray(boundary + separatorLength);
  const headers: Array<[string, string]> = [];
  let statusCode = 200;

  for (const line of headerText.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === "status") {
      const match = /^([1-5][0-9]{2})/.exec(value);
      if (match) statusCode = Number(match[1]);
      continue;
    }
    if (/^[a-z0-9-]+$/i.test(name) && name.toLowerCase() !== "content-length") {
      headers.push([name, value]);
    }
  }
  return { statusCode, headers, body };
}
