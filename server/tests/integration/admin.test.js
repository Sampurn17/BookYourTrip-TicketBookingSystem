const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createAdmin, createProvider, createTrip, createCustomer, dateIn, bookingBody } = require('../helpers/factory');
const { Booking, DailyAvailability, Trip } = require('../../src/models');

let app;
let admin;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
beforeEach(async () => {
  admin = await createAdmin();
});
afterEach(clearDB);
afterAll(stopDB);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const as = (method, url) => request(app)[method](url).set(auth(admin.token));

describe('Admin: provider lifecycle', () => {
  test('lists providers with filters', async () => {
    await createProvider({ status: 'pending' });
    await createProvider({ status: 'active' });
    expect((await as('get', '/api/admin/providers')).body.count).toBe(2);
    const pending = await as('get', '/api/admin/providers?status=pending');
    expect(pending.body.count).toBe(1);
    expect(pending.body.providers[0].user.email).toMatch(/@test.com$/);
  });

  test('approve -> suspend -> reactivate, with invalid transitions rejected', async () => {
    const { provider } = await createProvider({ status: 'pending' });
    const url = (a) => `/api/admin/providers/${provider._id}/${a}`;

    expect((await as('patch', url('approve'))).body.provider.status).toBe('active');
    expect((await as('patch', url('approve'))).body.code).toBe('INVALID_TRANSITION');

    const trip = await createTrip(provider);
    const search = () => request(app).get(`/api/trips/search?source=Delhi&date=${dateIn(3)}`);
    expect((await search()).body.count).toBe(1);

    expect((await as('patch', url('suspend')).send({ reason: 'Safety audit' })).body.provider).toMatchObject({ status: 'suspended', statusReason: 'Safety audit' });
    expect((await search()).body.count).toBe(0); // suspended operators disappear from search
    expect((await Trip.findById(trip._id)).status).toBe('scheduled');

    expect((await as('patch', url('reactivate'))).body.provider.status).toBe('active');
    expect((await search()).body.count).toBe(1);
  });

  test('discontinuing a provider cancels its trips and refunds customers', async () => {
    const { provider } = await createProvider();
    const trip = await createTrip(provider);
    const c = await createCustomer();
    await request(app).post('/api/bookings').set(auth(c.token)).send(bookingBody(trip, dateIn(3), [1, 2]));

    const res = await as('patch', `/api/admin/providers/${provider._id}/discontinue`).send({ reason: 'Licence revoked' });
    expect(res.status).toBe(200);
    expect(res.body.provider.status).toBe('discontinued');
    expect(res.body.impact).toMatchObject({ tripsCancelled: 1, bookingsCancelled: 1 });
    expect(res.body.impact.totalRefunded).toBeGreaterThan(0);
    const b = await Booking.findOne({}).lean();
    expect(b).toMatchObject({ status: 'cancelled', cancelledBy: 'admin', cancellationReason: 'Licence revoked' });
    expect((await as('patch', `/api/admin/providers/${provider._id}/reactivate`)).status).toBe(409);
  });

  test('unknown or malformed provider ids', async () => {
    expect((await as('patch', '/api/admin/providers/507f1f77bcf86cd799439011/approve')).status).toBe(404);
    expect((await as('patch', '/api/admin/providers/xyz/approve')).status).toBe(422);
  });
});

describe('Admin: platform health', () => {
  test('platform stats', async () => {
    const { provider } = await createProvider();
    const trip = await createTrip(provider);
    const c = await createCustomer();
    await request(app).post('/api/bookings').set(auth(c.token)).send(bookingBody(trip, dateIn(3), [1]));

    const res = await as('get', '/api/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ activeTrips: 1, bookings: { total: 1, confirmed: 1, today: 1 } });
    expect(res.body.stats.users).toMatchObject({ admin: 1, customer: 1, provider: 1 });
    expect(res.body.stats.daily).toHaveLength(7);
    expect(res.body.stats.revenue).toBeGreaterThan(0);
  });

  test('integrity check passes on healthy data and detects corruption', async () => {
    const { provider } = await createProvider();
    const trip = await createTrip(provider);
    const date = dateIn(3);
    const c = await createCustomer();
    await request(app).post('/api/bookings').set(auth(c.token)).send(bookingBody(trip, date, [1, 2]));

    const ok = await as('get', '/api/admin/integrity');
    expect(ok.body.integrity).toMatchObject({ ok: true, inventoriesChecked: 1, seatsSold: 2 });

    // Simulate the bugs the system is designed to prevent.
    await DailyAvailability.updateOne({ tripId: trip._id, date }, { $push: { bookedSeats: 2 }, $set: { capacity: 2 }, $inc: { bookedCount: 1 } });
    await Booking.create({ ...(await Booking.findOne({}).lean()), _id: undefined, pnr: 'BYTZZZZZZ', idempotencyKey: undefined });
    await DailyAvailability.create({ tripId: trip._id, date: dateIn(9), capacity: 5, bookedSeats: [], bookedCount: 1 });
    const orphan = await createTrip(provider);
    await Booking.create({ ...(await Booking.findOne({}).lean()), _id: undefined, pnr: 'BYTYYYYYY', tripId: orphan._id, idempotencyKey: undefined });

    const bad = await as('get', '/api/admin/integrity');
    const types = bad.body.integrity.issues.map((i) => i.type);
    expect(bad.body.integrity.ok).toBe(false);
    expect(types).toEqual(
      expect.arrayContaining(['DUPLICATE_SEAT_IN_INVENTORY', 'OVERBOOKED', 'SEAT_SOLD_TWICE', 'COUNT_MISMATCH', 'BOOKING_WITHOUT_INVENTORY']),
    );
  });
});
