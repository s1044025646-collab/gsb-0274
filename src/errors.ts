export type ErrorCode =
  | "EMPTY_INPUT"
  | "INVALID_POINT"
  | "INVALID_COORDINATE"
  | "INVALID_TOLERANCE"
  | "INVALID_FORCED_INDEX"
  | "INVALID_KEEP_INDEX"
  | "NOT_FOUND";

export class AppError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
