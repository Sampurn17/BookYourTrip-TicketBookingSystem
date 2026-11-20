const mongoose = require('mongoose');
const config = require('./index');
const { detectTransactionSupport } = require('../utils/transaction');

mongoose.set('strictQuery', true);

async function connectDB(uri = config.mongoUri, options = {}) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, ...options });
  const tx = await detectTransactionSupport(mongoose.connection, config.mongoTransactions);
  // Make sure unique indexes (seat inventory, PNR, idempotency keys) exist before serving traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  return { connection: mongoose.connection, transactions: tx };
}

async function disconnectDB() {
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB };
