const config = require('../config');
const AppError = require('../utils/AppError');
const { Trip, Provider, Booking, DailyAvailability } = require('../models');
const { quoteFare } = require('./pricingService');
const inventory = require('./inventoryService');
const { todayStr, dayOfWeek, departureDateTime, diffDays, isValidDateStr } = require('../utils/dates');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Validates that a trip can be sold on `date`.
 * @returns {{ departureAt: Date }}
 */
function assertBookableDate(trip, date, now = new Date()) {
  if (!isValidDateStr(date)) throw AppError.badRequest('Invalid travel date', 'INVALID_DATE');
  const today = todayStr(now);
  const ahead = diffDays(today, date);
  if (ahead < 0) throw AppError.badRequest('Travel date is in the past', 'INVALID_DATE');
  if (ahead > config.business.bookingWindowDays) {
    throw AppError.badRequest(`Bookings open ${config.business.bookingWindowDays} days in advance`, 'OUTSIDE_WINDOW');
  }
  if (!trip.operatingDays.includes(dayOfWeek(date))) {
    throw AppError.badRequest('This service does not run on the selected day', 'TRIP_NOT_OPERATING');
  }
  const departureAt = departureDateTime(date, trip.departureTime);
  const cutoff = departureAt.getTime() - config.business.bookingCutoffMinutes * 60 * 1000;
  if (now.getTime() > cutoff) {
    throw AppError.badRequest('Booking for this departure has closed', 'BOOKING_CLOSED');
  }
  return { departureAt };
}

function serializeTrip(trip, inv, date, now = new Date()) {
  const capacity = inv ? inv.capacity : trip.totalSeats;
  const bookedCount = inv ? inv.bookedCount : 0;
  const provider = trip.providerId && trip.providerId.companyName ? trip.providerId : null;
  return {
    _id: trip._id,
    mode: trip.mode,
    serviceName: trip.serviceName,
    source: trip.source,
    destination: trip.destination,
    departureTime: trip.departureTime,
    arrivalTime: trip.arrivalTime,
    durationMinutes: trip.durationMinutes,
    amenities: trip.amenities || [],
    operatingDays: trip.operatingDays,
    basePrice: trip.basePrice,
    totalSeats: capacity,
    availableSeats: Math.max(0, capacity - bookedCount),
    provider: provider && { _id: provider._id, companyName: provider.companyName, rating: provider.rating },
    date,
    departureAt: departureDateTime(date, trip.departureTime),
    fare: quoteFare({ basePrice: trip.basePrice, capacity, bookedCount, date, departureTime: trip.departureTime, now }),
  };
}

const SORTERS = {
  price_asc: (a, b) => a.fare.perSeat - b.fare.perSeat,
  price_desc: (a, b) => b.fare.perSeat - a.fare.perSeat,
  departure: (a, b) => a.departureTime.localeCompare(b.departureTime),
  arrival: (a, b) => a.arrivalTime.localeCompare(b.arrivalTime),
  duration: (a, b) => a.durationMinutes - b.durationMinutes,
  seats: (a, b) => b.availableSeats - a.availableSeats,
};

/** Customer search: route + date + filters, priced with live availability. */
async function searchTrips(q, now = new Date()) {
  const date = q.date || todayStr(now);
  const activeProviderIds = await Provider.find({ status: 'active' }).distinct('_id');

  const filter = {
    status: 'scheduled',
    providerId: { $in: activeProviderIds },
    operatingDays: dayOfWeek(date),
  };
  if (q.source) filter.sourceNorm = { $regex: `^${escapeRegex(q.source.toLowerCase())}` };
  if (q.destination) filter.destinationNorm = { $regex: `^${escapeRegex(q.destination.toLowerCase())}` };
  if (q.mode) filter.mode = q.mode;
  if (q.departAfter || q.departBefore) {
    filter.departureTime = {};
    if (q.departAfter) filter.departureTime.$gte = q.departAfter;
    if (q.departBefore) filter.departureTime.$lte = q.departBefore;
  }

  const trips = await Trip.find(filter).populate('providerId', 'companyName rating').limit(200).lean();
  const invMap = await inventory.inventoryMap(
    trips.map((t) => t._id),
    date,
  );
  const cutoffMs = config.business.bookingCutoffMinutes * 60 * 1000;
  const seatsNeeded = q.seats || 1;

  const results = trips
    .map((t) => serializeTrip(t, invMap.get(String(t._id)), date, now))
    .filter((t) => t.departureAt.getTime() - cutoffMs > now.getTime())
    .filter((t) => t.availableSeats >= seatsNeeded)
    .filter((t) => (q.minPrice === undefined || t.fare.perSeat >= q.minPrice) && (q.maxPrice === undefined || t.fare.perSeat <= q.maxPrice));

  results.sort(SORTERS[q.sort] || SORTERS.departure);
  return { date, count: results.length, trips: results };
}

async function listCities() {
  const [sources, destinations] = await Promise.all([
    Trip.distinct('source', { status: 'scheduled' }),
    Trip.distinct('destination', { status: 'scheduled' }),
  ]);
  return [...new Set([...sources, ...destinations])].sort((a, b) => a.localeCompare(b));
}

async function getTripOrThrow(id) {
  const trip = await Trip.findById(id).populate('providerId', 'companyName rating status');
  if (!trip) throw AppError.notFound('Trip');
  return trip;
}

/** Seat map + live quote for the checkout page. */
async function getSeatMap(tripId, date, now = new Date()) {
  const trip = await getTripOrThrow(tripId);
  if (trip.status !== 'scheduled' || trip.providerId?.status !== 'active') {
    throw AppError.badRequest('This trip is no longer available', 'TRIP_UNAVAILABLE');
  }
  assertBookableDate(trip, date, now);
  const inv = await inventory.getInventory(trip._id, date);
  return {
    trip: serializeTrip(trip.toObject(), inv, date, now),
    bookedSeats: inv ? [...inv.bookedSeats].sort((a, b) => a - b) : [],
    capacity: inv ? inv.capacity : trip.totalSeats,
  };
}

// ---------------- provider operations ----------------

async function listProviderTrips(providerId, date = todayStr()) {
  const trips = await Trip.find({ providerId }).sort({ status: -1, departureTime: 1 }).lean();
  const invMap = await inventory.inventoryMap(
    trips.map((t) => t._id),
    date,
  );
  return trips.map((t) => {
    const inv = invMap.get(String(t._id));
    const capacity = inv ? inv.capacity : t.totalSeats;
    const booked = inv ? inv.bookedCount : 0;
    return {
      ...t,
      date,
      runsOnDate: t.operatingDays.includes(dayOfWeek(date)),
      bookedSeats: booked,
      availableSeats: capacity - booked,
      occupancy: capacity ? Math.round((booked / capacity) * 100) : 0,
      fare: quoteFare({ basePrice: t.basePrice, capacity, bookedCount: booked, date, departureTime: t.departureTime }),
    };
  });
}

async function createTrip(provider, data) {
  if (!provider.servicesOffered.includes(data.mode)) {
    throw AppError.badRequest(`Your company is not registered for ${data.mode} services`, 'MODE_NOT_OFFERED');
  }
  return Trip.create({ ...data, providerId: provider._id });
}

async function getOwnedTrip(provider, tripId) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw AppError.notFound('Trip');
  if (String(trip.providerId) !== String(provider._id)) throw AppError.forbidden('This trip belongs to another provider');
  return trip;
}

async function futureBookingCount(tripId) {
  return Booking.countDocuments({ tripId, status: 'confirmed', travelDate: { $gte: todayStr() } });
}

async function updateTrip(provider, tripId, updates) {
  const trip = await getOwnedTrip(provider, tripId);
  if (trip.status === 'cancelled') throw AppError.badRequest('Cancelled trips cannot be edited', 'TRIP_CANCELLED');
  if (updates.mode && !provider.servicesOffered.includes(updates.mode)) {
    throw AppError.badRequest(`Your company is not registered for ${updates.mode} services`, 'MODE_NOT_OFFERED');
  }

  const routeChange = ['source', 'destination', 'mode'].some(
    (k) => updates[k] !== undefined && String(updates[k]).toLowerCase() !== String(trip[k]).toLowerCase(),
  );
  if (routeChange && (await futureBookingCount(trip._id)) > 0) {
    throw AppError.conflict('Route or mode cannot change while customers hold future bookings', 'HAS_BOOKINGS');
  }

  if (updates.totalSeats !== undefined && updates.totalSeats !== trip.totalSeats) {
    const today = todayStr();
    // Reject if any future date already sold a seat number beyond the new capacity.
    const blocking = await DailyAvailability.findOne({
      tripId: trip._id,
      date: { $gte: today },
      $or: [{ bookedCount: { $gt: updates.totalSeats } }, { bookedSeats: { $gt: updates.totalSeats } }],
    }).lean();
    if (blocking) {
      throw AppError.conflict(
        `Seats beyond ${updates.totalSeats} are already sold on ${blocking.date}`,
        'CAPACITY_BELOW_BOOKED',
        { date: blocking.date },
      );
    }
    await DailyAvailability.updateMany({ tripId: trip._id, date: { $gte: today } }, { $set: { capacity: updates.totalSeats } });
  }

  Object.assign(trip, updates);
  await trip.save();
  return trip;
}

/** Trips are never hard-deleted: they are cancelled and every future booking is refunded. */
async function cancelTrip(provider, tripId, { actor = 'provider', reason } = {}) {
  const trip = provider ? await getOwnedTrip(provider, tripId) : await Trip.findById(tripId);
  if (!trip) throw AppError.notFound('Trip');
  if (trip.status === 'cancelled') throw AppError.badRequest('Trip is already cancelled', 'TRIP_CANCELLED');
  trip.status = 'cancelled';
  await trip.save();

  // Lazy require to avoid a circular import (bookingService -> tripService).
  // eslint-disable-next-line global-require
  const bookingService = require('./bookingService');
  const refunded = await bookingService.cancelFutureBookingsForTrips([trip._id], actor, reason || 'Trip cancelled by operator');
  return { trip, bookingsCancelled: refunded.count, totalRefunded: refunded.amount };
}

module.exports = {
  assertBookableDate,
  searchTrips,
  listCities,
  getTripOrThrow,
  getSeatMap,
  listProviderTrips,
  createTrip,
  getOwnedTrip,
  updateTrip,
  cancelTrip,
  serializeTrip,
};
