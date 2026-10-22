// Exit codes and the one error type every layer throws. The codes are part of
// the public contract (docs/cli.md): scripts and agents branch on them.

export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  unavailable: 5,
  interrupted: 130,
} as const;

/**
 * Error codes in `{"error":{"code":…}}`. The tool codes come from the backend
 * (`structuredContent.error.code`); `usage`, `config`, `unavailable` and
 * `interrupted` are the CLI's own.
 */
export type ErrorCode =
  | "usage"
  | "config"
  | "invalid_argument"
  | "not_found"
  | "unauthenticated"
  | "unavailable"
  | "interrupted"
  | "internal";

const EXIT_BY_CODE: Record<ErrorCode, number> = {
  usage: EXIT.usage,
  config: EXIT.usage,
  invalid_argument: EXIT.usage,
  not_found: EXIT.notFound,
  unauthenticated: EXIT.auth,
  unavailable: EXIT.unavailable,
  interrupted: EXIT.interrupted,
  internal: EXIT.failed,
};

/** Backend codes this client knows; an unknown code is treated as `internal` (docs/mcp.md). */
export function toErrorCode(code: unknown): ErrorCode {
  return typeof code === "string" && code in EXIT_BY_CODE ? (code as ErrorCode) : "internal";
}

export type ErrorDetails = {
  /** The operation may have been applied; retrying with the same clientId is safe. */
  retryable?: boolean;
  clientId?: string;
  /** A follow-up command with placeholders; never echoes the user's arguments. */
  hint?: string;
  /** Accepted values, e.g. the valid flags or field names. */
  valid?: string[];
  /** The task reference that failed in a command acting on several tasks. */
  ref?: string;
};

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, message: string, details: ErrorDetails = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.details = details;
  }

  get exitCode(): number {
    return EXIT_BY_CODE[this.code];
  }

  with(details: ErrorDetails): CliError {
    return new CliError(this.code, this.message, { ...this.details, ...details }, { cause: this.cause });
  }
}

export const usageError = (message: string, details: ErrorDetails = {}) => new CliError("usage", message, details);

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  return new CliError("internal", `Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
}
