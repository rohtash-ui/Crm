import pino from 'pino';

export const logger = pino({
  name: 'whatsapp-notifications',
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', '*.accessToken', '*.whatsappNumber'],
    censor: '[REDACTED]',
  },
});
