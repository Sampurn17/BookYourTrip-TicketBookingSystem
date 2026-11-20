/**
 * Booking lifecycle: create -> (edit passengers) -> (reschedule)* -> cancel.
 *
 * Concurrency strategy
 * --------------------
 *  - Seats: atomic compare-and-set on DailyAvailability (inventoryService).
 *  - Multi-step consistency: runInTransaction (MongoDB transaction, or
 *    compensating actions on a standalone server).
 *  - Duplicate submissions: Idempotency-Key header + unique index.
 *  - Concurrent edits of the same booking (cancel vs reschedule, double
 *    clicks): optimistic locking on Booking.version.
 */
const AppError = require('../utils/AppError');
const { Booking, Payment, Trip } = require('../models');
const inventory = require('./inventoryService');
const { quoteFare } = require('./pricingService');
const policy = require('./policyService');
const { getGateway } = require('./payment');
const { assertBookableDate } = require('./tripService');
const { runInTransaction } = require('../utils/transaction');
const { generatePnr } = require('../utils/pnr');
const { seatsInRange, pickSeats } = require('../utils/seats');
const { departureDateTime, hoursUntil, todayStr } = require('../utils/dates');

const TRIP_FIELDS = 'mode serviceName source destination departureTime arrivalTime durationMinutes amenities status';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const concurrentModification = () =>
  AppError.conflict('This booking was just modified elsewhere. Please refresh and try again.', 'CONCURRENT_MODIFICATION');

function serializeBooking(b, now = new Date()) {
  const obj = typeof b.toObject === 'function' ? b.toObject() : b;
  const trip = obj.tripId && obj.tripId.departureTime ? obj.tripId : null;
  const provider = obj.providerId && obj.providerId.companyName ? obj.providerId : null;
  const departureAt = trip ? departureDateTime(obj.travelDate, trip.departureTime) : null;
  const { idempotencyKey, __v, ...rest } = obj;
  return {
    ...rest,
    tripId: trip ? trip._id : obj.tripId,
    providerId: provider ? provider._id : obj.providerId,
    trip,
    provider,
    departureAt,
    isUpcoming: obj.status === 'confirmed' && departureAt !== null && departureAt > now,
  };
}

async function findExistingByKey(customerId, idempotencyKey, attempts = 1) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Booking.findOne({ customerId, idempotencyKey });
    if (existing) return existing;
    // eslint-disable-next-line no-await-in-loop
    if (i < attempts - 1) await sleep(100);
  }
  return null;
}

/**
 * Book specific seats on a trip for a date and take a (dummy) payment.
 * @returns {{ booking, replayed: boolean }}
 */
async function createBooking(user, input, { idempotencyKey, now = new Date() } = {}) {
  if (idempotencyKey) {
    const existing = await findExistingByKey(user._id, idempotencyKey);
    if (existing) return { booking: existing, replayed: true };
  }

  const trip = await Trip.findById(input.tripId).populate('providerId', 'companyName status');
  if (!trip) throw AppError.notFound('Trip');
  if (trip.status !== 'scheduled' || trip.providerId?.status !== 'active') {
    throw AppError.badRequest('This trip is no longer available', 'TRIP_UNAVAILABLE');
  }
  assertBookableDate(trip, input.date, now);

  const seats = input.seatNumbers;
  await inventory.ensureInventory(trip, input.date);
  const snapshot = await inventory.getInventory(trip._id, input.date);
  if (!seatsInRange(seats, snapshot.capacity)) {
    throw AppError.badRequest(`Seat numbers must be between 1 and ${snapshot.capacity}`, 'INVALID_SEAT');
  }

  try {
    const booking = await runInTransaction(async (session, undo) => {
      const inv = await inventory.getInventory(trip._id, input.date, session);
      const fare = quoteFare({
        basePrice: trip.basePrice,
        capacity: inv.capacity,
        bookedCount: inv.bookedCount,
        date: input.date,
        departureTime: trip.departureTime,
        seats: seats.length,
        now,
      });
      if (input.quotedPerSeat && fare.perSeat > input.quotedPerSeat) {
        throw AppError.conflict(`The fare has changed to ₹${fare.perSeat} per seat`, 'PRICE_CHANGED', { fare });
      }

      // 1. Claim the seats (atomic compare-and-set).
      const reserved = await inventory.reserveSeats({ tripId: trip._id, date: input.date, seats, session });
      if (!reserved) {
        const taken = seats.filter((s) => inv.bookedSeats.includes(s));
        throw AppError.conflict('Sorry, one or more of the selected seats were just booked by someone else', 'SEAT_UNAVAILABLE', {
          seats: taken.length ? taken : seats,
        });
      }
      undo.push(() => inventory.releaseSeats({ tripId: trip._id, date: input.date, seats }));

      // 2. Take payment. A decline aborts the transaction and frees the seats.
      const charge = await getGateway().charge({ amount: fare.total, method: input.payment.method, details: input.payment });

      // 3. Persist booking + payment.
      const [created] = await Booking.create(
        [
          {
            pnr: generatePnr(),
            customerId: user._id,
            tripId: trip._id,
            providerId: trip.providerId._id,
            travelDate: input.date,
            originalTravelDate: input.date,
            seatNumbers: seats,
            passengers: input.passengers.map((p, i) => ({ name: p.name, age: p.age, gender: p.gender, seatNumber: seats[i] })),
            fare,
            amountPaid: fare.total,
            paymentMethod: input.payment.method,
            idempotencyKey,
            history: [{ action: 'booked', by: 'customer', toDate: input.date, amount: fare.total }],
          },
        ],
        { session },
      );
      undo.push(() => Booking.deleteOne({ _id: created._id }));

      await Payment.create(
        [
          {
            bookingId: created._id,
            customerId: user._id,
            kind: 'charge',
            purpose: 'booking',
            amount: fare.total,
            method: input.payment.method,
            transactionId: charge.transactionId,
            maskedInstrument: charge.maskedInstrument,
          },
        ],
        { session },
      );
      return created;
    });
    return { booking, replayed: false };
  } catch (err) {
    // Same checkout submitted twice concurrently: return the booking that won instead of an error.
    const keyClash = err.code === 11000 && err.keyPattern && err.keyPattern.idempotencyKey;
    if (idempotencyKey && (keyClash || err.code === 'SEAT_UNAVAILABLE')) {
      const existing = await findExistingByKey(user._id, idempotencyKey, keyClash ? 3 : 5);
      if (existing) return { booking: existing, replayed: true };
    }
    throw err;
  }
}

async function loadCustomerBooking(userId, bookingId) {
  const booking = await Booking.findById(bookingId).populate('tripId', TRIP_FIELDS).populate('providerId', 'companyName rating');
  // Not-found for other users' bookings so ids cannot be probed.
  if (!booking || String(booking.customerId) !== String(userId)) throw AppError.notFound('Booking');
  return booking;
}

function hoursToDeparture(booking, now) {
  return hoursUntil(departureDateTime(booking.travelDate, booking.tripId.departureTime), now);
}

async function listCustomerBookings(userId, scope = 'all', now = new Date()) {
  const today = todayStr(now);
  const filter = { customerId: userId };
  let sort = { createdAt: -1 };
  if (scope === 'upcoming') {
    Object.assign(filter, { status: 'confirmed', travelDate: { $gte: today } });
    sort = { travelDate: 1 };
  } else if (scope === 'past') {
    Object.assign(filter, { status: 'confirmed', travelDate: { $lt: today } });
    sort = { travelDate: -1 };
  } else if (scope === 'cancelled') {
    filter.status = 'cancelled';
    sort = { cancelledAt: -1 };
  }
  const rows = await Booking.find(filter)
    .populate('tripId', TRIP_FIELDS)
    .populate('providerId', 'companyName rating')
    .sort(sort)
    .limit(200)
    .lean();
  return rows.map((b) => serializeBooking(b, now));
}

async function getCustomerBooking(userId, bookingId, now = new Date()) {
  return serializeBooking(await loadCustomerBooking(userId, bookingId), now);
}

// ---------------- cancellation ----------------

async function cancellationQuote(userId, bookingId, now = new Date()) {
  const booking = await loadCustomerBooking(userId, bookingId);
  if (booking.status !== 'confirmed') throw AppError.badRequest('Booking is already cancelled', 'ALREADY_CANCELLED');
  const quote = policy.cancellationQuote(booking.fare.total, hoursToDeparture(booking, now), 'customer');
  return { pnr: booking.pnr, farePaid: booking.fare.total, ...quote };
}

/**
 * Cancel a booking, free its seats and refund according to policy.
 * actor = 'customer' enforces ownership + policy; provider/admin/system cancellations refund in full.
 */
async function cancelBooking({ bookingId, actor = 'customer', userId, reason, now = new Date() }) {
  const booking = await Booking.findById(bookingId).populate('tripId', 'departureTime');
  if (!booking || (actor === 'customer' && String(booking.customerId) !== String(userId))) {
    throw AppError.notFound('Booking');
  }
  if (booking.status === 'cancelled') throw AppError.conflict('Booking is already cancelled', 'ALREADY_CANCELLED');

  const quote = policy.cancellationQuote(booking.fare.total, hoursToDeparture(booking, now), actor);
  if (!quote.allowed) throw AppError.badRequest(quote.reason, 'CANCELLATION_NOT_ALLOWED');

  const before = booking.toObject({ depopulate: true });
  return runInTransaction(async (session, undo) => {
    const push = { history: { action: 'cancelled', by: actor, amount: quote.refund, note: reason } };
    if (quote.fee > 0) push.charges = { type: 'cancellation_fee', amount: quote.fee, note: quote.tier };

    // 1. Compare-and-set the status so two concurrent cancels cannot both refund.
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'confirmed', version: booking.version },
      {
        $set: { status: 'cancelled', cancelledBy: actor, cancelledAt: now, cancellationReason: reason, refundAmount: quote.refund },
        $inc: { version: 1, totalPenalty: quote.fee },
        $push: push,
      },
      { new: true, session },
    );
    if (!updated) throw concurrentModification();
    undo.push(() =>
      Booking.updateOne(
        { _id: booking._id },
        {
          $set: {
            status: 'confirmed',
            refundAmount: before.refundAmount,
            totalPenalty: before.totalPenalty,
            history: before.history,
            charges: before.charges,
            version: before.version,
          },
          $unset: { cancelledBy: 1, cancelledAt: 1, cancellationReason: 1 },
        },
      ),
    );

    // 2. Return the seats to inventory.
    await inventory.releaseSeats({ tripId: booking.tripId._id, date: booking.travelDate, seats: booking.seatNumbers, session });
    undo.push(() => inventory.reserveSeats({ tripId: booking.tripId._id, date: booking.travelDate, seats: booking.seatNumbers }));

    // 3. Refund.
    if (quote.refund > 0) {
      const refund = await getGateway().refund({ amount: quote.refund, reference: booking.pnr });
      await Payment.create(
        [
          {
            bookingId: booking._id,
            customerId: booking.customerId,
            kind: 'refund',
            purpose: 'cancellation',
            amount: quote.refund,
            method: booking.paymentMethod,
            transactionId: refund.transactionId,
          },
        ],
        { session },
      );
    }
    return { booking: updated, refund: quote.refund, fee: quote.fee };
  });
}

/** Used when a provider cancels a trip or an admin discontinues a provider. */
async function cancelFutureBookingsForTrips(tripIds, actor, reason, now = new Date()) {
  const bookings = await Booking.find({
    tripId: { $in: tripIds },
    status: 'confirmed',
    travelDate: { $gte: todayStr(now) },
  }).select('_id');
  let count = 0;
  let amount = 0;
  for (const b of bookings) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await cancelBooking({ bookingId: b._id, actor, reason, now });
      count += 1;
      amount += res.refund;
    } catch (err) {
      if (err.code !== 'ALREADY_CANCELLED' && err.code !== 'CONCURRENT_MODIFICATION') throw err;
    }
  }
  return { count, amount };
}

// ---------------- reschedule ----------------

async function prepareReschedule(userId, bookingId, newDate, now) {
  const booking = await loadCustomerBooking(userId, bookingId);
  if (booking.status !== 'confirmed') throw AppError.badRequest('Cancelled bookings cannot be rescheduled', 'ALREADY_CANCELLED');
  if (newDate === booking.travelDate) throw AppError.badRequest('Pick a different date', 'SAME_DATE');

  const trip = await Trip.findById(booking.tripId._id).populate('providerId', 'status');
  if (!trip || trip.status !== 'scheduled' || trip.providerId?.status !== 'active') {
    throw AppError.badRequest('This service is no longer operating', 'TRIP_UNAVAILABLE');
  }
  assertBookableDate(trip, newDate, now);

  const fee = policy.rescheduleFee(booking.fare.total, hoursToDeparture(booking, now));
  if (!fee.allowed) throw AppError.badRequest(fee.reason, 'RESCHEDULE_NOT_ALLOWED');
  await inventory.ensureInventory(trip, newDate);
  return { booking, trip, fee };
}

function planReschedule({ booking, trip, fee, inv, newDate, now }) {
  const n = booking.seatNumbers.length;
  const seats = pickSeats(inv.capacity, inv.bookedSeats, n, booking.seatNumbers);
  if (!seats) throw AppError.conflict('Not enough seats left on the new date', 'SOLD_OUT');
  const newFare = quoteFare({
    basePrice: trip.basePrice,
    capacity: inv.capacity,
    bookedCount: inv.bookedCount,
    date: newDate,
    departureTime: trip.departureTime,
    seats: n,
    now,
  });
  const fareDifference = Math.max(0, newFare.total - booking.fare.total);
  return {
    seats,
    newFare,
    fareDifference,
    fee: fee.fee,
    feePct: fee.feePct,
    tier: fee.tier,
    amountDue: fee.fee + fareDifference,
    keepsSeats: seats.join(',') === booking.seatNumbers.join(','),
  };
}

async function rescheduleQuote(userId, bookingId, newDate, now = new Date()) {
  const ctx = await prepareReschedule(userId, bookingId, newDate, now);
  const inv = await inventory.getInventory(ctx.trip._id, newDate);
  const plan = planReschedule({ ...ctx, inv, newDate, now });
  return { pnr: ctx.booking.pnr, fromDate: ctx.booking.travelDate, toDate: newDate, ...plan };
}

async function rescheduleBooking(userId, bookingId, newDate, payment, now = new Date()) {
  const ctx = await prepareReschedule(userId, bookingId, newDate, now);
  const { booking, trip } = ctx;

  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await runInTransaction(async (session, undo) => {
        const inv = await inventory.getInventory(trip._id, newDate, session);
        const plan = planReschedule({ ...ctx, inv, newDate, now });

        const reserved = await inventory.reserveSeats({ tripId: trip._id, date: newDate, seats: plan.seats, session });
        if (!reserved) throw AppError.conflict('Seats were taken while rescheduling', 'SEAT_UNAVAILABLE');
        undo.push(() => inventory.releaseSeats({ tripId: trip._id, date: newDate, seats: plan.seats }));

        let charge = null;
        if (plan.amountDue > 0) {
          if (!payment) {
            throw new AppError(`Payment of ₹${plan.amountDue} is required to reschedule`, 402, 'PAYMENT_REQUIRED', {
              amountDue: plan.amountDue,
            });
          }
          charge = await getGateway().charge({ amount: plan.amountDue, method: payment.method, details: payment });
        }

        const charges = [];
        if (plan.fee > 0) charges.push({ type: 'reschedule_fee', amount: plan.fee, note: plan.tier });
        if (plan.fareDifference > 0) charges.push({ type: 'fare_difference', amount: plan.fareDifference });

        const set = {
          travelDate: newDate,
          seatNumbers: plan.seats,
          passengers: booking.passengers.map((p, i) => ({ name: p.name, age: p.age, gender: p.gender, seatNumber: plan.seats[i] })),
        };
        if (plan.fareDifference > 0) set.fare = plan.newFare;

        const updated = await Booking.findOneAndUpdate(
          { _id: booking._id, status: 'confirmed', version: booking.version },
          {
            $set: set,
            $inc: { version: 1, amountPaid: plan.amountDue, totalPenalty: plan.fee },
            $push: {
              charges: { $each: charges },
              history: { action: 'rescheduled', by: 'customer', fromDate: booking.travelDate, toDate: newDate, amount: plan.amountDue },
            },
          },
          { new: true, session },
        )
          .populate('tripId', TRIP_FIELDS)
          .populate('providerId', 'companyName rating');
        if (!updated) throw concurrentModification();

        await inventory.releaseSeats({ tripId: trip._id, date: booking.travelDate, seats: booking.seatNumbers, session });

        if (charge) {
          await Payment.create(
            [
              {
                bookingId: booking._id,
                customerId: booking.customerId,
                kind: 'charge',
                purpose: 'reschedule',
                amount: plan.amountDue,
                method: payment.method,
                transactionId: charge.transactionId,
                maskedInstrument: charge.maskedInstrument,
              },
            ],
            { session },
          );
        }
        return {
          booking: serializeBooking(updated, now),
          fee: plan.fee,
          fareDifference: plan.fareDifference,
          amountCharged: plan.amountDue,
          keptSameSeats: plan.keepsSeats,
        };
      });
    } catch (err) {
      // Another buyer grabbed our chosen seats between read and write: re-plan with fresh inventory.
      if (err.code === 'SEAT_UNAVAILABLE' && attempt < 3) continue;
      throw err;
    }
  }
}

// ---------------- passengers ----------------

async function updatePassengers(userId, bookingId, passengers, now = new Date()) {
  const booking = await loadCustomerBooking(userId, bookingId);
  if (booking.status !== 'confirmed') throw AppError.badRequest('Cancelled bookings cannot be edited', 'ALREADY_CANCELLED');
  if (hoursToDeparture(booking, now) <= 0) throw AppError.badRequest('This journey has already departed', 'DEPARTED');
  if (passengers.length !== booking.seatNumbers.length) {
    throw AppError.badRequest(`Exactly ${booking.seatNumbers.length} passenger(s) are required`, 'PASSENGER_COUNT');
  }
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'confirmed', version: booking.version },
    {
      $set: {
        passengers: passengers.map((p, i) => ({ name: p.name, age: p.age, gender: p.gender, seatNumber: booking.seatNumbers[i] })),
      },
      $inc: { version: 1 },
      $push: { history: { action: 'passengers_updated', by: 'customer' } },
    },
    { new: true },
  )
    .populate('tripId', TRIP_FIELDS)
    .populate('providerId', 'companyName rating');
  if (!updated) throw concurrentModification();
  return serializeBooking(updated, now);
}

module.exports = {
  createBooking,
  listCustomerBookings,
  getCustomerBooking,
  cancellationQuote,
  cancelBooking,
  cancelFutureBookingsForTrips,
  rescheduleQuote,
  rescheduleBooking,
  updatePassengers,
  serializeBooking,
};
