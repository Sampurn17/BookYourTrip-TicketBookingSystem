const mongoose = require('mongoose');

/**
 * Seat inventory for one trip on one calendar date.
 *
 * This document is the single source of truth for which seats are taken.
 * All writes go through atomic conditional updates
 *   filter: { bookedSeats: { $nin: requested }, bookedCount + n <= capacity }
 * so two concurrent buyers can never both win the same seat (no double
 * booking) and the trip can never be sold beyond capacity (no overbooking).
 */
const dailyAvailabilitySchema = new mongoose.Schema(
  {
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    capacity: { type: Number, required: true, min: 0 },
    bookedSeats: { type: [Number], default: [] },
    bookedCount: { type: Number, default: 0, min: 0 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

dailyAvailabilitySchema.index({ tripId: 1, date: 1 }, { unique: true });

const DailyAvailability = mongoose.model('DailyAvailability', dailyAvailabilitySchema);

module.exports = { DailyAvailability };
