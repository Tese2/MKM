import rateLimit from 'express-rate-limit';

export function createUserRateLimit({ limit = 20, windowMs = 15 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs,
    limit,
    keyGenerator: (request) => `user:${request.auth.userId}`,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests. Try again later.',
      code: 'RATE_LIMITED',
    },
  });
}
