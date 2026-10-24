export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "APPROVAL_REQUIRED"
  | "CONFLICT"
  | "UNKNOWN_OUTCOME"
  | "RATE_LIMITED"
  | "TRAFFIC_PAUSED"
  | "NETWORK"
  | "UPSTREAM"
  | "STATE_INVALID"
  | "STATE_BUSY"
  | "UNAVAILABLE";
export class KitError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KitError";
  }
}
export type Envelope<T> =
  | { version: 1; ok: true; data: T }
  | { version: 1; ok: false; error: { code: ErrorCode; message: string } };
export async function envelope<T>(fn: () => Promise<T>): Promise<Envelope<T>> {
  try {
    return { version: 1, ok: true, data: await fn() };
  } catch (error) {
    return {
      version: 1,
      ok: false,
      error:
        error instanceof KitError
          ? { code: error.code, message: error.message }
          : {
              code: "UNAVAILABLE",
              message: "Operation failed; inspect the trusted host configuration.",
            },
    };
  }
}
