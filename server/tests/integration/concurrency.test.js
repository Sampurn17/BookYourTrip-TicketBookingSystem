/**
 * System-level concurrency tests: many simultaneous HTTP requests against a
 * real MongoDB replica set. Every scenario runs twice - with multi-document
 * transactions and with the compensating-action fallback - and ends with the
 * global integrity check (no double booking, no overbooking).
 */
const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createProvider, createTrip, createCustomer, dateIn, bookingBody, upi } = require('../helpers/factory');
const { Booking, DailyAvailability, Payment } = require('../../src/models');
const { integrityCheck } = require('../../src/services/adminService');
const { setTransactionSupport } = require('../../src/utils/transaction');
const { addDays } = require('../../src/utils/dates');

let app;
let provider;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
beforeEach(async () => {
  ({ provider } = await createProvider());
});
afterEach(clearDB);
afterAll(async () => {
  setTransactionSupport(true);
  await stopDB();
});

const post = (token, url, body, headers = {}) =>
  request(app)
    .post(url)
    .set({ Authorization: `Bearer ${token}`, ...headers })
    .send(body);
const customers = (n) => Promise.all(Array.from({ length: n }, () => createCustomer()));

describe.each([
  ['with MongoDB transactions', true],
  ['without transactions (compensating actions)', false],
])('Concurrency %s', (_label, transactions) => {
  beforeAll(() => setTransactionSupport(transactions));

  test('20 customers racing for the same seat: exactly one wins', async () => {
    const trip = await createTrip(provider, { totalSeats: 5 });
    const date = dateIn(4);
    const users = await customers(20);

    const results = await Promise.all(users.map((u) => post(u.token, '/api/bookings', bookingBody(trip, date, [3]))));

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.body.code === 'SEAT_UNAVAILABLE')).toHaveLength(19);
    const inv = await DailyAvailability.findOne({ tripId: trip._id, date }).lean();
    expect(inv.bookedSeats).toEqual([3]);
    expect(inv.bookedCount).toBe(1);
    expect(await Booking.countDocuments({ tripId: trip._id })).toBe(1);
    expect((await integrityCheck()).ok).toBe(true);
  });

  test('30 overlapping multi-seat requests never exceed capacity', async () => {
    const capacity = 8;
    const trip = await createTrip(provider, { totalSeats: capacity });
    const date = dateIn(6);
    const users = await customers(30);
    const pickSeats = (i) => {
      const n = 1 + (i % 3);
      const start = 1 + ((i * 3) % capacity);
      return Array.from({ length: n }, (_, k) => ((start + k - 1) % capacity) + 1);
    };

    const results = await Promise.all(users.map((u, i) => post(u.token, '/api/bookings', bookingBody(trip, date, pickSeats(i)))));
    expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);

    const confirmed = await Booking.find({ tripId: trip._id, travelDate: date, status: 'confirmed' }).lean();
    const sold = confirmed.flatMap((b) => b.seatNumbers);
    const inv = await DailyAvailability.findOne({ tripId: trip._id, date }).lean();
    expect(new Set(sold).size).toBe(sold.length); // no seat sold twice
    expect(sold.length).toBeLessThanOrEqual(capacity); // no overbooking
    expect(inv.bookedCount).toBe(sold.length);
    expect(results.filter((r) => r.status === 201)).toHaveLength(confirmed.length);
    expect((await integrityCheck()).ok).toBe(true);
  });

  test('double-clicking "Pay" (same Idempotency-Key) creates a single booking', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    const { token } = await createCustomer();
    const headers = { 'Idempotency-Key': `dbl-${transactions}` };

    const results = await Promise.all(Array.from({ length: 8 }, () => post(token, '/api/bookings', bookingBody(trip, date, [4]), headers)));

    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(results.map((r) => r.body.booking.pnr)).size).toBe(1);
    expect(await Booking.countDocuments()).toBe(1);
    expect(await Payment.countDocuments({ kind: 'charge' })).toBe(1);
  });

  test('concurrent cancellations refund exactly once and release seats once', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    const { token } = await createCustomer();
    const { body } = await post(token, '/api/bookings', bookingBody(trip, date, [1, 2]));
    const url = `/api/bookings/${body.booking._id}/cancel`;

    const results = await Promise.all(Array.from({ length: 6 }, () => post(token, url, {})));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await Payment.countDocuments({ kind: 'refund' })).toBe(1);
    expect((await DailyAvailability.findOne({ tripId: trip._id, date }).lean()).bookedCount).toBe(0);
    expect((await integrityCheck()).ok).toBe(true);
  });

  test('cancel racing reschedule leaves inventory consistent', async () => {
    const trip = await createTrip(provider);
    const date = dateIn(5);
    const { token } = await createCustomer();
    const { body } = await post(token, '/api/bookings', bookingBody(trip, date, [6]));
    const id = body.booking._id;

    const [c, r] = await Promise.all([
      post(token, `/api/bookings/${id}/cancel`, {}),
      post(token, `/api/bookings/${id}/reschedule`, { newDate: addDays(date, 2), payment: upi }),
    ]);

    expect([c.status, r.status].filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    const ig = await integrityCheck();
    expect(ig.issues).toEqual([]);
    expect(ig.ok).toBe(true);
  });

  test('a declined payment never leaks seats, even under contention', async () => {
    const trip = await createTrip(provider, { totalSeats: 3 });
    const date = dateIn(5);
    const [good, bad] = await customers(2);
    const declined = { ...bookingBody(trip, date, [1]), payment: { method: 'card', cardNumber: '5555444433330000' } };

    const [r1, r2] = await Promise.all([post(bad.token, '/api/bookings', declined), post(good.token, '/api/bookings', bookingBody(trip, date, [2]))]);

    expect(r1.status).toBe(402);
    expect(r2.status).toBe(201);
    const inv = await DailyAvailability.findOne({ tripId: trip._id, date }).lean();
    expect(inv.bookedSeats).toEqual([2]);
    expect((await integrityCheck()).ok).toBe(true);
  });
});
