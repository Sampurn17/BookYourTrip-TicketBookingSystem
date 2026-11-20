const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback = false) =>
  value === undefined || value === '' ? fallback : ['1', 'true', 'yes'].includes(String(value).toLowerCase());

if (env === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const corsRaw = process.env.CORS_ORIGIN || '*';

const config = Object.freeze({
  env,
  isTest: env === 'test',
  port: int(process.env.PORT, 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/bookyourtrip',
  /** 'auto' detects replica-set support at startup; 'false' forces the compensation path. */
  mongoTransactions: process.env.MONGO_TRANSACTIONS || 'auto',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-only-insecure-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  bcryptRounds: env === 'test' ? 4 : 12,
  corsOrigins: corsRaw === '*' ? '*' : corsRaw.split(',').map((s) => s.trim()),
  serveClient: bool(process.env.SERVE_CLIENT, env === 'production'),
  rateLimit: {
    disabled: bool(process.env.DISABLE_RATE_LIMIT, env === 'test'),
    windowMs: 60 * 1000,
    max: int(process.env.RATE_LIMIT_MAX, 600),
    authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 30),
    agentMax: int(process.env.RATE_LIMIT_AGENT_MAX, 30),
  },
  llm: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    maxSteps: int(process.env.AGENT_MAX_STEPS, 5),
  },
  business: {
    /** All schedule times are interpreted in this fixed offset (India Standard Time). */
    tzOffset: process.env.APP_TZ_OFFSET || '+05:30',
    bookingWindowDays: int(process.env.BOOKING_WINDOW_DAYS, 60),
    bookingCutoffMinutes: int(process.env.BOOKING_CUTOFF_MINUTES, 30),
    rescheduleCutoffHours: int(process.env.RESCHEDULE_CUTOFF_HOURS, 2),
    maxSeatsPerBooking: int(process.env.MAX_SEATS_PER_BOOKING, 6),
  },
});

module.exports = config;
