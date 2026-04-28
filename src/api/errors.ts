export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, "BAD_REQUEST", message);
}

export function unauthorized(message = "Missing or invalid JWT."): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "Cross-tenant access denied."): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function notFound(code: string, message: string): ApiError {
  return new ApiError(404, code, message);
}
