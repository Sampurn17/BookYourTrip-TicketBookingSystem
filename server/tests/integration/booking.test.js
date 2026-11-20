const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createProvider, createTrip, createCustomer, dateIn, bookingBody, passengers, upi } = require('../helpers/factory');
const { Booking, DailyAvailability, Payment } = require('../../src/models');
const bookingService = require('../../src/services/bookingService');
const { departureDateTime, dayOfWeek, addDays } = require('../../src/utils/dates');

let app;
let provider;
let customer;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
beforeEach(async () => {
  ({ provider } = await createProvider());
  customer = await createCustomer();
});
afterEach(clearDB);
afterAll(stopDB);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const book = (token, body, headers = {}) => request(app).post('/api/bookings').set({ ...auth(token), ...headers }).send(body);
const inventory = (trip, date) => DailyAvailability.findOne({ tripId: trip._id, date }).lean();
/** A weekday at least `min` days ahead so fares are not affected by the weekend rule. */
function weekdayIn(min) {
  let d = dateIn(min);
  while ([0, 5, 6].includes(dayOfWeek(d))) d = addDays(d, 1);
  return d;
}

describe('POST /api/bookings', () => {
  test('books specific seats, charges the dynamic fare and records the payment', async () => {
    const trip = await createTrip(provider, { basePrice: 500, totalSeats: 10 });
    const date = weekdayIn(5);
    const res = await book(customer.token, bookingBody(trip, date, [7, 3]));

    expect(res.status).toBe(201);
    const b = res.body.booking;
    expect(b.pnr).toMatch(/^BYT/);
    expect(b.seatNumbers).toEqual([7, 3]);
    expect(b.passengers.map((p) => p.seatNumber)).toEqual([7, 3]);
    expect(b.fare).toMatchObject({ basePrice: 500, perSeat: 500, total: 1000 });
    expect(b.amountPaid).toBe(1000);
    expect(b.trip.source).toBe('Delhi');
    expect(b.isUpcoming).toBe(true);
    expect(b.idempotencyKey).toBeUndefined();

    const inv = await inventory(trip, date);
    expect(inv).toMatchObject({ bookedCount: 2, capacity: 10 });
    expect(inv.bookedSeats.sort()).toEqual([3, 7]);
    const pay = await Payment.findOne({ bookingId: b._id });
    expect(pay).toMatchObject({ kind: 'charge', purpose: 'booking', amount: 1000, method: 'upi', status: 'success' });
  });

  test('the fare rises as the trip fills up (dynamic pricing)', async () => {
    const trip = await createTrip(provider, { basePrice: 1000, totalSeats: 4 });
    const date = weekdayIn(5);
    const first = await book(customer.token, bookingBody(trip, date, [1, 2]));
    const second = await book(customer.token, bookingBody(trip, date, [3]));
    expect(first.body.booking.fare.perSeat).toBe(1000);
    expect(second.body.booking.fare.perSeat).toBe(1150); // 50% booked -> x1.15
  });

  test('rejects seats that are already taken with 409 SEAT_UNAVAILABLE', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    await book(customer.token, bookingBody(trip, date, [5]));
    const other = await createCustomer();
    const res = await book(other.token, bookingBody(trip, date, [4, 5]));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SEAT_UNAVAILABLE');
    expect(res.body.details.seats).toEqual([5]);
    expect((await inventory(trip, date)).bookedSeats).toEqual([5]);
  });

  test('validates seat numbers, passenger count and trip availability', async () => {
    const trip = await createTrip(provider, { totalSeats: 4 });
    const date = dateIn(5);
    expect((await book(customer.token, bookingBody(trip, date, [5]))).body.code).toBe('INVALID_SEAT');
    expect((await book(customer.token, { ...bookingBody(trip, date, [1, 2]), passengers: passengers(1) })).status).toBe(422);
    expect((await book(customer.token, bookingBody({ _id: '507f1f77bcf86cd799439011' }, date, [1]))).status).toBe(404);

    const { provider: pending } = await createProvider({ status: 'pending' });
    const hidden = await createTrip(pending);
    expect((await book(customer.token, bookingBody(hidden, date, [1]))).body.code).toBe('TRIP_UNAVAILABLE');
  });

  test('only logged-in customers can book', async () => {
    const trip = await createTrip(provider);
    expect((await request(app).post('/api/bookings').send(bookingBody(trip, dateIn(3), [1]))).status).toBe(401);
    const { token } = await createProvider();
    expect((await book(token, bookingBody(trip, dateIn(3), [1]))).status).toBe(403);
  });

  test('Idempotency-Key replays return the original booking instead of double booking', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    const headers = { 'Idempotency-Key': 'checkout-123' };
    const first = await book(customer.token, bookingBody(trip, date, [1]), headers);
    const replay = await book(customer.token, bookingBody(trip, date, [1]), headers);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.booking.pnr).toBe(first.body.booking.pnr);
    expect(await Booking.countDocuments()).toBe(1);
  });

  test('a declined payment rolls back the seat reservation', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    const res = await book(customer.token, { ...bookingBody(trip, date, [2]), payment: { method: 'card', cardNumber: '4111111111110000' } });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PAYMENT_DECLINED');
    expect((await inventory(trip, date)).bookedSeats).toEqual([]);
    expect(await Booking.countDocuments()).toBe(0);
  });

  test('refuses to charge more than the quoted fare (price lock)', async () => {
    const trip = await createTrip(provider, { basePrice: 1000 });
    const res = await book(customer.token, { ...bookingBody(trip, dateIn(5), [1]), quotedPerSeat: 500 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details.fare.perSeat).toBeGreaterThan(500);
  });
});

describe('Viewing and managing bookings', () => {
  async function setup(seats = [1, 2], opts = {}) {
    const trip = await createTrip(provider, { totalSeats: 6, ...opts });
    const date = weekdayIn(5);
    const res = await book(customer.token, bookingBody(trip, date, seats));
    return { trip, date, booking: res.body.booking };
  }

  test('lists bookings by scope and hides other users\' bookings', async () => {
    const { booking } = await setup();
    const list = (scope) => request(app).get(`/api/bookings?scope=${scope}`).set(auth(customer.token));
    expect((await list('upcoming')).body.count).toBe(1);
    expect((await list('past')).body.count).toBe(0);
    expect((await list('all')).body.bookings[0].pnr).toBe(booking.pnr);
    expect((await request(app).get(`/api/bookings/${booking._id}`).set(auth(customer.token))).body.booking.pnr).toBe(booking.pnr);

    const stranger = await createCustomer();
    expect((await request(app).get(`/api/bookings/${booking._id}`).set(auth(stranger.token))).status).toBe(404);
    expect((await request(app).post(`/api/bookings/${booking._id}/cancel`).set(auth(stranger.token))).status).toBe(404);
  });

  test('cancel: quote, refund per policy, seats released, double cancel rejected', async () => {
    const { trip, date, booking } = await setup();
    const quote = await request(app).get(`/api/bookings/${booking._id}/cancel-quote`).set(auth(customer.token));
    expect(quote.body.quote).toMatchObject({ allowed: true, feePct: 10, fee: 100, refund: 900 });

    const res = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(auth(customer.token)).send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refund: 900, fee: 100 });
    expect(res.body.booking).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', refundAmount: 900, totalPenalty: 100 });
    expect((await inventory(trip, date)).bookedCount).toBe(0);
    expect(await Payment.countDocuments({ kind: 'refund', amount: 900 })).toBe(1);

    const again = await request(app).post(`/api/bookings/${booking._id}/cancel`).set(auth(customer.token));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_CANCELLED');
    expect((await request(app).get('/api/bookings?scope=cancelled').set(auth(customer.token))).body.count).toBe(1);
    expect((await request(app).get(`/api/bookings/${booking._id}/cancel-quote`).set(auth(customer.token))).status).toBe(400);
  });

  test('reschedule moves the seats to the new date and keeps seat numbers when free', async () => {
    const { trip, date, booking } = await setup([3, 4]);
    const newDate = addDays(date, 7);
    const quote = await request(app).post(`/api/bookings/${booking._id}/reschedule-quote`).set(auth(customer.token)).send({ newDate });
    expect(quote.body.quote).toMatchObject({ fee: 0, keepsSeats: true, seats: [3, 4], toDate: newDate });

    const res = await request(app).post(`/api/bookings/${booking._id}/reschedule`).set(auth(customer.token)).send({ newDate, payment: upi });
    expect(res.status).toBe(200);
    expect(res.body.keptSameSeats).toBe(true);
    expect(res.body.booking).toMatchObject({ travelDate: newDate, seatNumbers: [3, 4], originalTravelDate: date });
    expect(res.body.booking.history.map((h) => h.action)).toEqual(['booked', 'rescheduled']);
    expect((await inventory(trip, date)).bookedSeats).toEqual([]);
    expect((await inventory(trip, newDate)).bookedSeats.sort()).toEqual([3, 4]);
  });

  test('reschedule picks other seats when the original ones are taken on the new date', async () => {
    const { trip, date, booking } = await setup([1]);
    const newDate = addDays(date, 7);
    const other = await createCustomer();
    await book(other.token, bookingBody(trip, newDate, [1]));
    const res = await request(app).post(`/api/bookings/${booking._id}/reschedule`).set(auth(customer.token)).send({ newDate, payment: upi });
    expect(res.status).toBe(200);
    expect(res.body.keptSameSeats).toBe(false);
    expect(res.body.booking.seatNumbers).toEqual([2]);
    expect(res.body.booking.passengers[0].seatNumber).toBe(2);
  });

  test('reschedule errors: same date, sold out, cancelled booking', async () => {
    const { trip, date, booking } = await setup([1, 2], { totalSeats: 2 });
    const r = (body) => request(app).post(`/api/bookings/${booking._id}/reschedule`).set(auth(customer.token)).send(body);
    expect((await r({ newDate: date })).body.code).toBe('SAME_DATE');

    const newDate = addDays(date, 7);
    const other = await createCustomer();
    await book(other.token, bookingBody(trip, newDate, [1]));
    expect((await r({ newDate, payment: upi })).body.code).toBe('SOLD_OUT');

    await request(app).post(`/api/bookings/${booking._id}/cancel`).set(auth(customer.token));
    expect((await r({ newDate: addDays(date, 8) })).body.code).toBe('ALREADY_CANCELLED');
  });

  test('passenger details can be edited before departure', async () => {
    const { booking } = await setup([5, 6]);
    const url = `/api/bookings/${booking._id}/passengers`;
    const res = await request(app)
      .patch(url)
      .set(auth(customer.token))
      .send({ passengers: [{ name: 'Meera Nair', age: 41, gender: 'F' }, { name: 'Kabir Nair', age: 12, gender: 'M' }] });
    expect(res.status).toBe(200);
    expect(res.body.booking.passengers).toEqual([
      { name: 'Meera Nair', age: 41, gender: 'F', seatNumber: 5 },
      { name: 'Kabir Nair', age: 12, gender: 'M', seatNumber: 6 },
    ]);
    const wrong = await request(app).patch(url).set(auth(customer.token)).send({ passengers: passengers(1) });
    expect(wrong.body.code).toBe('PASSENGER_COUNT');
  });
});

describe('Time-dependent rules (service level with an injected clock)', () => {
  async function bookAt(departureTime = '10:00', seats = [1]) {
    const trip = await createTrip(provider, { departureTime, arrivalTime: '14:00', basePrice: 1000 });
    const date = weekdayIn(5);
    const { booking } = await bookingService.createBooking(customer.user, bookingBody(trip, date, seats));
    return { trip, date, booking, departure: departureDateTime(date, departureTime) };
  }
  const hoursBefore = (d, h) => new Date(d.getTime() - h * 3600 * 1000);

  test('last-minute cancellation forfeits the fare; after departure it is blocked', async () => {
    const { booking, departure } = await bookAt();
    const late = await bookingService.cancellationQuote(customer.user._id, booking._id, hoursBefore(departure, 3));
    expect(late).toMatchObject({ feePct: 100, refund: 0 });
    await expect(
      bookingService.cancelBooking({ bookingId: booking._id, userId: customer.user._id, now: hoursBefore(departure, -1) }),
    ).rejects.toMatchObject({ code: 'CANCELLATION_NOT_ALLOWED' });
    const res = await bookingService.cancelBooking({ bookingId: booking._id, userId: customer.user._id, now: hoursBefore(departure, 3) });
    expect(res.refund).toBe(0);
    expect(await Payment.countDocuments({ kind: 'refund' })).toBe(0);
  });

  test('reschedule penalty grows near departure and closes 2h before', async () => {
    const { booking, date, departure } = await bookAt();
    const newDate = addDays(date, 7);
    const q30 = await bookingService.rescheduleQuote(customer.user._id, booking._id, newDate, hoursBefore(departure, 30));
    expect(q30).toMatchObject({ feePct: 10, fee: 100 });
    await expect(bookingService.rescheduleQuote(customer.user._id, booking._id, newDate, hoursBefore(departure, 1))).rejects.toMatchObject({
      code: 'RESCHEDULE_NOT_ALLOWED',
    });
    await expect(bookingService.rescheduleBooking(customer.user._id, booking._id, newDate, undefined, hoursBefore(departure, 30))).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      statusCode: 402,
    });
    const done = await bookingService.rescheduleBooking(customer.user._id, booking._id, newDate, upi, hoursBefore(departure, 30));
    expect(done.fee).toBe(100);
    expect(done.booking.totalPenalty).toBe(100);
    expect(done.booking.amountPaid).toBe(1000 + done.amountCharged);
    expect(await Payment.countDocuments({ purpose: 'reschedule' })).toBe(1);
  });

  test('booking closes 30 minutes before departure and edits stop after departure', async () => {
    const { trip, date, booking, departure } = await bookAt('18:00', [2]);
    await expect(
      bookingService.createBooking(customer.user, bookingBody(trip, date, [3]), { now: hoursBefore(departure, 0.25) }),
    ).rejects.toMatchObject({ code: 'BOOKING_CLOSED' });
    await expect(bookingService.updatePassengers(customer.user._id, booking._id, passengers(1), hoursBefore(departure, -1))).rejects.toMatchObject({
      code: 'DEPARTED',
    });
    const past = await bookingService.listCustomerBookings(customer.user._id, 'past', new Date(departure.getTime() + 3 * 86400000));
    expect(past).toHaveLength(1);
    expect(past[0].isUpcoming).toBe(false);
  });
});
