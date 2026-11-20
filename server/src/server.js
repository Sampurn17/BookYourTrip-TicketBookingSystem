const config = require('./config');
const { connectDB, disconnectDB } = require('./config/db');
const { createApp } = require('./app');

async function main() {
  const { transactions } = await connectDB();
  // eslint-disable-next-line no-console
  console.log(`[db] connected (transactions: ${transactions ? 'enabled' : 'disabled - using compensating actions'})`);

  const server = createApp().listen(config.port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`[api] BookYourTrip listening on http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] failed to start', err);
  process.exit(1);
});
