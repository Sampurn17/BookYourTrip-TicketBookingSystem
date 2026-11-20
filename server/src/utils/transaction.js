/**
 * Unit-of-work helper.
 *
 * - On a replica set / Atlas cluster every booking mutation runs inside a
 *   MongoDB multi-document transaction (automatic retry on transient write
 *   conflicts, all-or-nothing commit).
 * - On a standalone mongod (no transactions) the same code runs without a
 *   session, and each step registers a compensating action. If a later step
 *   fails the compensations run in reverse order (saga-style rollback), so
 *   seats are never leaked.
 *
 * Seat safety itself never depends on transactions: seats are claimed with a
 * single atomic conditional update (see services/inventoryService.js).
 */
const mongoose = require('mongoose');

let transactionsSupported = false;

async function detectTransactionSupport(connection = mongoose.connection, mode = 'auto') {
  if (mode === 'false' || mode === false) {
    transactionsSupported = false;
    return false;
  }
  if (mode === 'true' || mode === true) {
    transactionsSupported = true;
    return true;
  }
  try {
    const hello = await connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

function setTransactionSupport(value) {
  transactionsSupported = Boolean(value);
}

function isTransactionSupported() {
  return transactionsSupported;
}

const NOOP_UNDO = Object.freeze({ push() {} });

/**
 * @param {(session: import('mongoose').ClientSession|null, undo: {push: Function}) => Promise<any>} work
 */
async function runInTransaction(work) {
  if (transactionsSupported) {
    let result;
    await mongoose.connection.transaction(async (session) => {
      result = await work(session, NOOP_UNDO);
    });
    return result;
  }

  const compensations = [];
  const undo = { push: (fn) => compensations.push(fn) };
  try {
    return await work(null, undo);
  } catch (err) {
    for (const compensate of compensations.reverse()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await compensate();
      } catch (compErr) {
        // eslint-disable-next-line no-console
        console.error('[transaction] compensation failed', compErr);
      }
    }
    throw err;
  }
}

module.exports = {
  detectTransactionSupport,
  setTransactionSupport,
  isTransactionSupported,
  runInTransaction,
};
