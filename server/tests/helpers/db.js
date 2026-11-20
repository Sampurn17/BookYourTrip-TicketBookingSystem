const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../../src/config/db');

let counter = 0;

/** Connect this test file to its own database on the shared in-memory replica set. */
async function startDB() {
  const uri = process.env.MONGO_TEST_URI;
  if (!uri) throw new Error('MONGO_TEST_URI missing - run integration tests through jest (globalSetup)');
  counter += 1;
  const dbName = `byt_test_${process.pid}_${Date.now()}_${counter}`;
  await connectDB(uri, { dbName });
}

async function clearDB() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

async function stopDB() {
  if (mongoose.connection.readyState) {
    await mongoose.connection.dropDatabase();
    await disconnectDB();
  }
}

module.exports = { startDB, clearDB, stopDB };
