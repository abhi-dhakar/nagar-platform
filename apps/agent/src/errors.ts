import type { AgentErrorCode } from "@nagar/agent-protocol";

const STATUS_BY_CODE: Record<AgentErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  FORBIDDEN_HOST: 403,
  FORBIDDEN_PATH: 403,
  INVALID_REQUEST: 400,
  INVALID_PATH: 400,
  PATH_OUTSIDE_WORKSPACE: 403,
  WORKSPACE_NOT_FOUND: 404,
  SESSION_NOT_FOUND: 404,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  PERMISSION_DENIED: 403,
  NOT_A_DIRECTORY: 400,
  IS_A_DIRECTORY: 400,
  FILE_TOO_LARGE: 413,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  TOO_MANY_SESSIONS: 429,
  SHELL_UNAVAILABLE: 422,
  RUNTIME_UNAVAILABLE: 422,
  COMPILE_ERROR: 422,
  UNSUPPORTED_LANGUAGE: 415,
  GIT_ERROR: 422,
  GIT_CONFLICT: 409,
  GIT_NOT_REPO: 422,
  INTERNAL_ERROR: 500,
};

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly statusCode: number;
  readonly details: string[] | undefined;

  constructor(code: AgentErrorCode, message: string, details?: string[]) {
    super(message);
    this.name = "AgentError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/** Convert filesystem errors into stable, safe client-facing errors. */
export function mapFsError(error: unknown, pathForMessage?: string): AgentError {
  if (isAgentError(error)) return error;
  const err = error as NodeJS.ErrnoException;
  const suffix = pathForMessage ? ` (${pathForMessage})` : "";
  switch (err?.code) {
    case "ENOENT":
      return new AgentError("NOT_FOUND", `Path does not exist${suffix}`);
    case "EACCES":
    case "EPERM":
      return new AgentError("PERMISSION_DENIED", `Permission denied${suffix}`);
    case "EEXIST":
      return new AgentError("ALREADY_EXISTS", `Path already exists${suffix}`);
    case "ENOTDIR":
      return new AgentError("NOT_A_DIRECTORY", `Not a directory${suffix}`);
    case "EISDIR":
      return new AgentError("IS_A_DIRECTORY", `Path is a directory${suffix}`);
    case "ENOTEMPTY":
      return new AgentError("ALREADY_EXISTS", `Directory is not empty${suffix}`);
    case "ENAMETOOLONG":
    case "EINVAL":
      return new AgentError("INVALID_PATH", `Invalid path${suffix}`);
    case "ENOSPC":
      return new AgentError("INTERNAL_ERROR", `Not enough disk space${suffix}`);
    default:
      return new AgentError("INTERNAL_ERROR", `Filesystem operation failed${suffix}`);
  }
}

export function describeFsError(error: unknown): string {
  return mapFsError(error).message;
}
