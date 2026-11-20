/**
 * Starts ONE in-memory MongoDB replica set for the whole run (transactions need
 * a replica set). Each integration test file uses its own database on it.
 * `jest tests/unit` skips it so unit tests stay fast and offline.
 */
const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async (globalConfig) => {
  const pattern = globalConfig.testPathPattern || '';
  if (pattern && /unit/.test(pattern) && !/integration/.test(pattern)) return;
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.MONGO_TEST_URI = replSet.getUri();
};
