const AppError = require('../utils/AppError');
const { User, Provider, Trip, Booking, DailyAvailability } = require('../models');
const { todayStr, addDays } = require('../utils/dates');
const config = require('../config');

async function listProviders(status) {
  const filter = status ? { status } : {};
  const providers = await Provider.find(filter).populate('userId', 'name email phone createdAt').sort({ createdAt: -1 }).lean();
  const tripCounts = await Trip.aggregate([
    { $match: { providerId: { $in: providers.map((p) => p._id) }, status: 'scheduled' } },
    { $group: { _id: '$providerId', trips: { $sum: 1 } } },
  ]);
  const countMap = new Map(tripCounts.map((c) => [String(c._id), c.trips]));
  return providers.map((p) => ({ ...p, user: p.userId, userId: p.userId?._id, activeTrips: countMap.get(String(p._id)) || 0 }));
}

/** Allowed lifecycle transitions (state machine). */
const TRANSITIONS = {
  approve: { from: ['pending'], to: 'active' },
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  discontinue: { from: ['pending', 'active', 'suspended'], to: 'discontinued' },
};

async function changeProviderStatus(providerId, action, reason) {
  const rule = TRANSITIONS[action];
  if (!rule) throw AppError.badRequest('Unknown action');
  const provider = await Provider.findById(providerId);
  if (!provider) throw AppError.notFound('Provider');
  if (!rule.from.includes(provider.status)) {
    throw AppError.conflict(`Cannot ${action} a provider that is ${provider.status}`, 'INVALID_TRANSITION');
  }

  provider.status = rule.to;
  provider.statusReason = reason;
  if (action === 'approve') provider.approvedAt = new Date();
  if (action === 'discontinue') provider.discontinuedAt = new Date();
  await provider.save();

  let impact = { tripsCancelled: 0, bookingsCancelled: 0, totalRefunded: 0 };
  if (action === 'discontinue') {
    const trips = await Trip.find({ providerId: provider._id, status: 'scheduled' }).select('_id');
    await Trip.updateMany({ providerId: provider._id, status: 'scheduled' }, { $set: { status: 'cancelled' } });
    // eslint-disable-next-line global-require
    const bookingService = require('./bookingService');
    const res = await bookingService.cancelFutureBookingsForTrips(
      trips.map((t) => t._id),
      'admin',
      reason || 'Operator discontinued from the platform',
    );
    impact = { tripsCancelled: trips.length, bookingsCancelled: res.count, totalRefunded: res.amount };
  }
  return { provider, impact };
}

async function platformStats(now = new Date()) {
  const today = todayStr(now);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [usersByRole, providersByStatus, activeTrips, bookingAgg, todayBookings, daily] = await Promise.all([
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Provider.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Trip.countDocuments({ status: 'scheduled' }),
    Booking.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          gross: { $sum: '$amountPaid' },
          refunds: { $sum: '$refundAmount' },
        },
      },
    ]),
    Booking.countDocuments({ createdAt: { $gte: new Date(`${today}T00:00:00${config.business.tzOffset}`) } }),
    Booking.aggregate([
      { $match: { createdAt: { $gte: weekAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: config.business.tzOffset } },
          bookings: { $sum: 1 },
          revenue: { $sum: { $subtract: ['$amountPaid', '$refundAmount'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const b = bookingAgg[0] || { total: 0, confirmed: 0, gross: 0, refunds: 0 };
  const toObj = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
  const dailyMap = new Map(daily.map((d) => [d._id, d]));
  return {
    users: toObj(usersByRole),
    providers: toObj(providersByStatus),
    activeTrips,
    bookings: { total: b.total, confirmed: b.confirmed, today: todayBookings },
    revenue: b.gross - b.refunds,
    daily: Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i - 6);
      const d = dailyMap.get(date);
      return { date, bookings: d ? d.bookings : 0, revenue: d ? d.revenue : 0 };
    }),
  };
}

/**
 * Verifies the no-overbooking / no-double-booking invariants across the
 * whole database. Used by the admin dashboard, the load test and the tests.
 */
async function integrityCheck() {
  const [inventories, seatGroups] = await Promise.all([
    DailyAvailability.find({}).lean(),
    Booking.aggregate([
      { $match: { status: 'confirmed' } },
      { $unwind: '$seatNumbers' },
      { $group: { _id: { tripId: '$tripId', date: '$travelDate' }, seats: { $push: '$seatNumbers' } } },
    ]),
  ]);
  const bookedByKey = new Map(seatGroups.map((g) => [`${g._id.tripId}|${g._id.date}`, g.seats]));
  const issues = [];

  for (const inv of inventories) {
    const key = `${inv.tripId}|${inv.date}`;
    const fromBookings = bookedByKey.get(key) || [];
    bookedByKey.delete(key);
    const label = { tripId: inv.tripId, date: inv.date };

    if (new Set(inv.bookedSeats).size !== inv.bookedSeats.length) issues.push({ ...label, type: 'DUPLICATE_SEAT_IN_INVENTORY' });
    if (inv.bookedCount !== inv.bookedSeats.length) issues.push({ ...label, type: 'COUNT_MISMATCH' });
    if (inv.bookedCount > inv.capacity) issues.push({ ...label, type: 'OVERBOOKED' });
    if (new Set(fromBookings).size !== fromBookings.length) issues.push({ ...label, type: 'SEAT_SOLD_TWICE' });

    const a = [...inv.bookedSeats].sort((x, y) => x - y).join(',');
    const b = [...fromBookings].sort((x, y) => x - y).join(',');
    if (a !== b) issues.push({ ...label, type: 'INVENTORY_BOOKING_MISMATCH', inventory: inv.bookedSeats.length, bookings: fromBookings.length });
  }
  for (const key of bookedByKey.keys()) {
    const [tripId, date] = key.split('|');
    issues.push({ tripId, date, type: 'BOOKING_WITHOUT_INVENTORY' });
  }

  const seatsSold = inventories.reduce((s, i) => s + i.bookedCount, 0);
  return { ok: issues.length === 0, inventoriesChecked: inventories.length, seatsSold, issues: issues.slice(0, 100) };
}

module.exports = { listProviders, changeProviderStatus, platformStats, integrityCheck, TRANSITIONS };
