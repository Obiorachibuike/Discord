import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.isTest ? (process.env.LOG_LEVEL ?? 'silent') : config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'password',
      'passwordHash',
      '*.password',
      '*.token',
      '*.tokenHash',
      'accessToken',
      'refreshToken',
    ],
    censor: '[redacted]',
  },
  base: { service: 'aether-server' },
});
