/**
 * Seat inventory - the concurrency-critical part of the system.
 *
 * Invariants (verified by adminService.integrityCheck and the race tests):
 *   1. bookedSeats contains no duplicates                 -> no double booking
 *   2. bookedCount === bookedSeats.length <= capacity     -> no overbooking
 *   3. bookedSeats equals the union of seats of confirmed bookings
 *
 * MongoDB guarantees single-document atomicity, so a conditional
 * findOneAndUpdate is a lock-free compare-and-set: of N concurrent
 * requests for seat 7 exactly one matches the filter, the rest get null.
 */
const { DailyAvailability } = require('../models');

/** Create the inventory row for (trip, date) if it does not exist yet. Safe under concurrency. */
async function ensureInventory(trip, date) {
  try {
    await DailyAvailability.updateOne(
      { tripId: trip._id, date },
      { $setOnInsert: { capacity: trip.totalSeats, bookedSeats: [], bookedCount: 0, version: 0 } },
      { upsert: true },
    );
  } catch (err) {
    // Two requests raced to create the same row; the unique index kept one. That's fine.
    if (err.code !== 11000) throw err;
  }
}

function getInventory(tripId, date, session = null) {
  return DailyAvailability.findOne({ tripId, date }).session(session).lean();
}

/**
 * Atomically claim specific seats.
 * @returns the updated inventory, or null if any seat is taken / capacity would be exceeded.
 */
function reserveSeats({ tripId, date, seats, session = null }) {
  return DailyAvailability.findOneAndUpdate(
    {
      tripId,
      date,
      bookedSeats: { $nin: seats },
      $expr: { $lte: [{ $add: ['$bookedCount', seats.length] }, '$capacity'] },
    },
    { $push: { bookedSeats: { $each: seats } }, $inc: { bookedCount: seats.length, version: 1 } },
    { new: true, session },
  ).lean();
}

/**
 * Release seats. The `$all` guard makes this idempotent: releasing twice
 * (e.g. a retried cancel) cannot drive bookedCount below the real value.
 */
async function releaseSeats({ tripId, date, seats, session = null }) {
  if (!seats.length) return false;
  const res = await DailyAvailability.updateOne(
    { tripId, date, bookedSeats: { $all: seats } },
    { $pull: { bookedSeats: { $in: seats } }, $inc: { bookedCount: -seats.length, version: 1 } },
    { session },
  );
  return res.modifiedCount === 1;
}

/** Inventories for many trips on one date, keyed by tripId. Avoids the N+1 query pattern. */
async function inventoryMap(tripIds, date) {
  const rows = await DailyAvailability.find({ tripId: { $in: tripIds }, date }).lean();
  return new Map(rows.map((r) => [String(r.tripId), r]));
}

module.exports = { ensureInventory, getInventory, reserveSeats, releaseSeats, inventoryMap };
