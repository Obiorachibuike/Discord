import { ZodError } from 'zod';

/** Consistent API error with a machine-readable code and HTTP status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message = 'Bad request', details?: unknown) {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message = 'You do not have permission to do that') {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static notFound(message = 'Not found') {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message = 'Conflict', details?: unknown) {
    return new ApiError(409, 'CONFLICT', message, details);
  }
  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }
  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL', message);
  }
  static unavailable(message = 'Service unavailable') {
    return new ApiError(503, 'UNAVAILABLE', message);
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ZodError) {
    return ApiError.badRequest('Validation failed', err.flatten());
  }
  return ApiError.internal();
}
