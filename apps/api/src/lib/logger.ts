import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: [
    'req.headers.cookie','req.headers.authorization','req.headers.x-csrf-token',
    'res.headers.set-cookie','password','token','secret','code','clientNonce'
  ], censor: '[redacted]' }
});
