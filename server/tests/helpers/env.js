// Loaded before every test file - deterministic, offline configuration.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.OPENAI_API_KEY = ''; // agent runs in offline mode in tests
process.env.DISABLE_RATE_LIMIT = 'true';
