import pino from 'pino';

export const logger = pino({
  name: 'whatsapp-notifications',
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    // Redact secrets but not phone numbers — agents need to know which number failed
    paths: ['req.headers.authorization', '*.accessToken', '*.webhookVerifyToken', '*.password'],
    censor: '[REDACTED]',
  },
});
