import rateLimit from 'express-rate-limit';

export const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.currentUser.id}`,
  handler: (_req, res) => res.status(429).json({
    error: 'Too many password change attempts. Please wait a few minutes before trying again.',
    code: 'rate_limited',
  }),
});

export const learnerCommentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.currentUser.id}`,
  handler: (_req, res) => res.status(429).json({
    error: 'You are posting comments too quickly. Please wait a few minutes and try again.',
    code: 'rate_limited',
  }),
});

export const learnerReactionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.currentUser.id}`,
  handler: (_req, res) => res.status(429).json({
    error: 'You are changing reactions too quickly. Please wait a few minutes and try again.',
    code: 'rate_limited',
  }),
});

export const quizAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.currentUser.id}`,
  handler: (_req, res) => res.status(429).json({
    error: 'You have submitted too many quiz attempts. Please wait before trying again.',
    code: 'rate_limited',
  }),
});
