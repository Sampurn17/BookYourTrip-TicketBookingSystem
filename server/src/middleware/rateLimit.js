const rateLimit = require('express-rate-limit');
const config = require('../config');

const passthrough = (_req, _res, next) => next();

function makeLimiter(max, message) {
  if (config.rateLimit.disabled) return passthrough;
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { status: 'error', code: 'RATE_LIMITED', message },
  });
}

module.exports = {
  apiLimiter: makeLimiter(config.rateLimit.max, 'Too many requests, please slow down.'),
  authLimiter: makeLimiter(config.rateLimit.authMax, 'Too many login attempts, try again in a minute.'),
  agentLimiter: makeLimiter(config.rateLimit.agentMax, 'The assistant is busy, try again in a minute.'),
};
