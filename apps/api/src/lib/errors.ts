import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@cove/db';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };
export const route = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(handler(req, res)).catch(next);
};
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  if (error instanceof ZodError) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Please check your input.', fields: error.flatten().fieldErrors }, requestId: req.id });
  if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: req.id });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'This value is already in use.' }, requestId: req.id });
    if (error.code === 'P2025') return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' }, requestId: req.id });
  }
  req.log.error({ err: error }, 'unhandled request error');
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' }, requestId: req.id });
}
