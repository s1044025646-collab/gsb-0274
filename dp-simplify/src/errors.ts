/**
 * 统一的参数/业务错误。errCode 为稳定的机器可读错误码（见 README）。
 */
export class ApiError extends Error {
  constructor(
    public readonly errCode: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function errorStatusCode(errCode: string): number {
  if (errCode === 'POLYLINE_NOT_FOUND' || errCode === 'VERSION_NOT_FOUND') {
    return 404;
  }
  return 400;
}
