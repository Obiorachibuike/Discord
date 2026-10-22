import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, toApiError } from '../errors.js';
import { logger } from '../logger.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Route not found' },
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const apiError = toApiError(err);
  const logPayload = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status: apiError.status,
    code: apiError.code,
  };
  if (apiError.status >= 500) {
    logger.error({ ...logPayload, err }, 'request failed');
  } else {
    logger.debug({ ...logPayload, message: apiError.message, details: apiError.details }, 'request rejected');
  }
  // Mask unexpected internal errors (never leak stack traces or internals),
  // but keep deliberate 5xx messages like 503 UNAVAILABLE (e.g. "voice is not
  // configured") which are safe and actionable for the user.
  if (apiError.status >= 500 && apiError.code === 'INTERNAL') {
    res.status(apiError.status).json({
      error: {
        code: 'INTERNAL',
        message: 'Something went wrong on our side.',
        requestId: req.requestId,
      },
    });
    return;
  }
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      requestId: req.requestId,
    },
  });
}

export { ApiError, ZodError };
