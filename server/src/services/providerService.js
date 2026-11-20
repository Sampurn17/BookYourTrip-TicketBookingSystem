const { Booking, Trip, DailyAvailability } = require('../models');
const inventory = require('./inventoryService');
const tripService = require('./tripService');
const { todayStr, addDays, dayOfWeek, offsetMinutes } = require('../utils/dates');
const config = require('../config');

const PROVIDER_EDITABLE = ['companyName', 'servicesOffered', 'contactEmail', 'contactPhone', 'description'];

async function updateProfile(provider, updates) {
  for (const key of PROVIDER_EDITABLE) if (updates[key] !== undefined) provider[key] = updates[key];
  await provider.save();
  return provider;
}

/** Passenger manifest for one departure. */
async function tripManifest(provider, tripId, date) {
  const trip = await tripService.getOwnedTrip(provider, tripId);
  const [bookings, inv] = await Promise.all([
    Booking.find({ tripId: trip._id, travelDate: date }).populate('customerId', 'name email phone').sort({ createdAt: 1 }).lean(),
    inventory.getInventory(trip._id, date),
  ]);
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const passengers = confirmed
    .flatMap((b) =>
      b.passengers.map((p) => ({
        ...p,
        pnr: b.pnr,
        bookedBy: b.customerId?.name,
        contactEmail: b.customerId?.email,
        contactPhone: b.customerId?.phone,
      })),
    )
    .sort((a, b) => a.seatNumber - b.seatNumber);
  const capacity = inv ? inv.capacity : trip.totalSeats;
  const revenue = confirmed.reduce((s, b) => s + b.amountPaid, 0) + bookings.filter((b) => b.status === 'cancelled').reduce((s, b) => s + b.totalPenalty, 0);
  return {
    trip,
    date,
    capacity,
    bookedSeats: inv ? inv.bookedCount : 0,
    occupancy: capacity ? Math.round(((inv ? inv.bookedCount : 0) / capacity) * 100) : 0,
    revenue,
    passengers,
    bookings: bookings.map((b) => ({
      _id: b._id,
      pnr: b.pnr,
      status: b.status,
      seatNumbers: b.seatNumbers,
      amountPaid: b.amountPaid,
      refundAmount: b.refundAmount,
      customer: b.customerId && { name: b.customerId.name, email: b.customerId.email },
      createdAt: b.createdAt,
    })),
  };
}

async function upcomingOccupancy(providerId, days = 7, now = new Date()) {
  const today = todayStr(now);
  const dates = Array.from({ length: days }, (_, i) => addDays(today, i));
  const trips = await Trip.find({ providerId, status: 'scheduled' }).lean();
  const invs = await DailyAvailability.find({
    tripId: { $in: trips.map((t) => t._id) },
    date: { $gte: dates[0], $lte: dates[dates.length - 1] },
  }).lean();
  const invByKey = new Map(invs.map((i) => [`${i.tripId}|${i.date}`, i]));

  return {
    trips,
    invByKey,
    series: dates.map((date) => {
      let capacity = 0;
      let booked = 0;
      for (const t of trips) {
        if (!t.operatingDays.includes(dayOfWeek(date))) continue;
        const inv = invByKey.get(`${t._id}|${date}`);
        capacity += inv ? inv.capacity : t.totalSeats;
        booked += inv ? inv.bookedCount : 0;
      }
      return { date, capacity, booked, occupancy: capacity ? Math.round((booked / capacity) * 100) : 0 };
    }),
  };
}

async function dashboardStats(provider, days = 7, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tz = config.business.tzOffset;
  const [totalsAgg, dailyAgg, occ] = await Promise.all([
    Booking.aggregate([
      { $match: { providerId: provider._id, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          bookings: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          seatsSold: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, { $size: '$seatNumbers' }, 0] } },
          gross: { $sum: '$amountPaid' },
          refunds: { $sum: '$refundAmount' },
        },
      },
    ]),
    Booking.aggregate([
      { $match: { providerId: provider._id, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
          bookings: { $sum: 1 },
          revenue: { $sum: { $subtract: ['$amountPaid', '$refundAmount'] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    upcomingOccupancy(provider._id, 7, now),
  ]);

  const t = totalsAgg[0] || { bookings: 0, cancelled: 0, seatsSold: 0, gross: 0, refunds: 0 };
  const dailyMap = new Map(dailyAgg.map((d) => [d._id, d]));
  const today = todayStr(now);
  const daily = Array.from({ length: days }, (_, i) => {
    const date = addDays(today, i - days + 1);
    const d = dailyMap.get(date);
    return { date, bookings: d ? d.bookings : 0, revenue: d ? d.revenue : 0 };
  });

  return {
    days,
    totals: {
      bookings: t.bookings,
      cancelled: t.cancelled,
      seatsSold: t.seatsSold,
      revenue: t.gross - t.refunds,
      activeTrips: occ.trips.length,
    },
    daily,
    occupancyNext7: occ.series,
    tzOffsetMinutes: offsetMinutes(),
  };
}

/**
 * Per-trip performance + rule-based pricing recommendation.
 * Consumed by the provider dashboard and by the AI agent's insight tool.
 */
async function tripPerformance(provider, now = new Date()) {
  const { trips, invByKey } = await upcomingOccupancy(provider._id, 7, now);
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const revenueAgg = await Booking.aggregate([
    { $match: { providerId: provider._id, createdAt: { $gte: since } } },
    {
      $group: {
        _id: '$tripId',
        revenue: { $sum: { $subtract: ['$amountPaid', '$refundAmount'] } },
        bookings: { $sum: 1 },
        cancellations: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      },
    },
  ]);
  const revByTrip = new Map(revenueAgg.map((r) => [String(r._id), r]));
  const today = todayStr(now);

  return trips.map((t) => {
    let cap = 0;
    let booked = 0;
    for (let i = 0; i < 7; i += 1) {
      const date = addDays(today, i);
      if (!t.operatingDays.includes(dayOfWeek(date))) continue;
      const inv = invByKey.get(`${t._id}|${date}`);
      cap += inv ? inv.capacity : t.totalSeats;
      booked += inv ? inv.bookedCount : 0;
    }
    const occupancy = cap ? Math.round((booked / cap) * 100) : 0;
    const rev = revByTrip.get(String(t._id)) || { revenue: 0, bookings: 0, cancellations: 0 };
    let recommendation = { action: 'hold', changePct: 0, reason: 'Demand is healthy; keep the current base fare.' };
    if (occupancy >= 80) {
      recommendation = {
        action: 'increase',
        changePct: 10,
        suggestedBasePrice: Math.round(t.basePrice * 1.1),
        reason: `Next-7-day occupancy is ${occupancy}%. Raising the base fare ~10% should lift revenue without hurting demand.`,
      };
    } else if (occupancy <= 25) {
      recommendation = {
        action: 'decrease',
        changePct: 10,
        suggestedBasePrice: Math.round(t.basePrice * 0.9),
        reason: `Only ${occupancy}% of seats are sold for the next week. A ~10% lower base fare could stimulate demand.`,
      };
    }
    return {
      tripId: t._id,
      route: `${t.source} → ${t.destination}`,
      mode: t.mode,
      departureTime: t.departureTime,
      basePrice: t.basePrice,
      occupancyNext7: occupancy,
      seatsBookedNext7: booked,
      revenue30d: rev.revenue,
      bookings30d: rev.bookings,
      cancellations30d: rev.cancellations,
      recommendation,
    };
  });
}

module.exports = { updateProfile, tripManifest, dashboardStats, tripPerformance, upcomingOccupancy };
