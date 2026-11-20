const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createProvider, createTrip, createCustomer, dateIn, bookingBody } = require('../helpers/factory');
const { Booking, DailyAvailability, Trip } = require('../../src/models');
const { dayOfWeek } = require('../../src/utils/dates');

let app;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
afterEach(clearDB);
afterAll(stopDB);

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const newTrip = { mode: 'bus', source: 'Pune', destination: 'Mumbai', departureTime: '07:00', arrivalTime: '10:30', basePrice: 450, totalSeats: 30, amenities: ['AC'] };
async function bookSeats(trip, date, seats) {
  const c = await createCustomer();
  const res = await request(app).post('/api/bookings').set(auth(c.token)).send(bookingBody(trip, date, seats));
  return res.body.booking;
}

describe('Provider onboarding gate', () => {
  test('pending providers can see their profile but cannot list trips', async () => {
    const { token } = await createProvider({ status: 'pending' });
    const me = await request(app).get('/api/provider/me').set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body.user.provider.status).toBe('pending');

    const res = await request(app).post('/api/provider/trips').set(auth(token)).send(newTrip);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PROVIDER_INACTIVE');
  });

  test('provider details can be edited', async () => {
    const { token } = await createProvider();
    const res = await request(app).patch('/api/provider/me').set(auth(token)).send({ companyName: 'Zing Premium', contactPhone: '9123456789', description: 'Luxury coaches' });
    expect(res.status).toBe(200);
    expect(res.body.user.provider).toMatchObject({ companyName: 'Zing Premium', contactPhone: '9123456789' });
  });
});

describe('Trip management', () => {
  test('creates trips only for registered service modes', async () => {
    const { token } = await createProvider({ servicesOffered: ['bus'] });
    const ok = await request(app).post('/api/provider/trips').set(auth(token)).send(newTrip);
    expect(ok.status).toBe(201);
    expect(ok.body.trip).toMatchObject({ source: 'Pune', sourceNorm: 'pune', durationMinutes: 210 });

    const flight = await request(app).post('/api/provider/trips').set(auth(token)).send({ ...newTrip, mode: 'flight' });
    expect(flight.body.code).toBe('MODE_NOT_OFFERED');
    const invalid = await request(app).post('/api/provider/trips').set(auth(token)).send({ ...newTrip, destination: 'pune' });
    expect(invalid.status).toBe(422);
  });

  test('lists trips with occupancy for a date', async () => {
    const { token, provider } = await createProvider();
    const trip = await createTrip(provider, { totalSeats: 4 });
    const date = dateIn(3);
    await bookSeats(trip, date, [1]);
    const res = await request(app).get(`/api/provider/trips?date=${date}`).set(auth(token));
    expect(res.body.trips[0]).toMatchObject({ bookedSeats: 1, availableSeats: 3, occupancy: 25, runsOnDate: true });
  });

  test('updates price/schedule; blocks route changes while customers hold bookings', async () => {
    const { token, provider } = await createProvider();
    const trip = await createTrip(provider);
    const url = `/api/provider/trips/${trip._id}`;

    const upd = await request(app).patch(url).set(auth(token)).send({ basePrice: 650, departureTime: '21:00' });
    expect(upd.status).toBe(200);
    expect(upd.body.trip).toMatchObject({ basePrice: 650, departureTime: '21:00', durationMinutes: 420 });

    const free = await request(app).patch(url).set(auth(token)).send({ destination: 'Ajmer' });
    expect(free.body.trip.destinationNorm).toBe('ajmer');

    await bookSeats(trip, dateIn(3), [1]);
    const blocked = await request(app).patch(url).set(auth(token)).send({ destination: 'Jaipur' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('HAS_BOOKINGS');
    expect((await request(app).patch(url).set(auth(token)).send({ mode: 'flight' })).status).toBe(409);
  });

  test('capacity cannot drop below seats already sold', async () => {
    const { token, provider } = await createProvider();
    const trip = await createTrip(provider, { totalSeats: 10 });
    const date = dateIn(3);
    await bookSeats(trip, date, [8]);
    const url = `/api/provider/trips/${trip._id}`;

    const blocked = await request(app).patch(url).set(auth(token)).send({ totalSeats: 6 });
    expect(blocked.body.code).toBe('CAPACITY_BELOW_BOOKED');

    expect((await request(app).patch(url).set(auth(token)).send({ totalSeats: 8 })).status).toBe(200);
    expect((await DailyAvailability.findOne({ tripId: trip._id, date }).lean()).capacity).toBe(8);
  });

  test('providers cannot touch other providers\' trips', async () => {
    const { provider } = await createProvider();
    const trip = await createTrip(provider);
    const intruder = await createProvider();
    expect((await request(app).patch(`/api/provider/trips/${trip._id}`).set(auth(intruder.token)).send({ basePrice: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/provider/trips/${trip._id}`).set(auth(intruder.token))).status).toBe(403);
    expect((await request(app).delete('/api/provider/trips/507f1f77bcf86cd799439011').set(auth(intruder.token))).status).toBe(404);
  });

  test('cancelling a trip refunds every future booking in full', async () => {
    const { token, provider } = await createProvider();
    const trip = await createTrip(provider);
    const b1 = await bookSeats(trip, dateIn(3), [1, 2]);
    const b2 = await bookSeats(trip, dateIn(4), [5]);

    const res = await request(app).delete(`/api/provider/trips/${trip._id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingsCancelled: 2, totalRefunded: b1.amountPaid + b2.amountPaid });
    expect((await Trip.findById(trip._id)).status).toBe('cancelled');
    const bookings = await Booking.find({}).lean();
    expect(bookings.every((b) => b.status === 'cancelled' && b.cancelledBy === 'provider' && b.refundAmount === b.amountPaid)).toBe(true);

    expect((await request(app).delete(`/api/provider/trips/${trip._id}`).set(auth(token))).body.code).toBe('TRIP_CANCELLED');
    expect((await request(app).patch(`/api/provider/trips/${trip._id}`).set(auth(token)).send({ basePrice: 9 })).body.code).toBe('TRIP_CANCELLED');
  });
});

describe('Provider insights', () => {
  test('manifest lists passengers by seat with revenue', async () => {
    const { token, provider } = await createProvider();
    const trip = await createTrip(provider);
    const date = dateIn(3);
    await bookSeats(trip, date, [4]);
    const b = await bookSeats(trip, date, [2, 3]);
    const res = await request(app).get(`/api/provider/trips/${trip._id}/manifest?date=${date}`).set(auth(token));
    expect(res.status).toBe(200);
    const m = res.body.manifest;
    expect(m.passengers.map((p) => p.seatNumber)).toEqual([2, 3, 4]);
    expect(m.bookedSeats).toBe(3);
    expect(m.passengers.find((p) => p.seatNumber === 2).pnr).toBe(b.pnr);
    expect(m.revenue).toBeGreaterThan(0);
  });

  test('dashboard stats and pricing recommendations', async () => {
    const { token, provider } = await createProvider();
    const date = dateIn(2);
    const hot = await createTrip(provider, { totalSeats: 1, operatingDays: [dayOfWeek(date)] });
    const cold = await createTrip(provider, { totalSeats: 40 });
    const mid = await createTrip(provider, { totalSeats: 2, operatingDays: [dayOfWeek(date)] });
    await bookSeats(hot, date, [1]);
    await bookSeats(mid, date, [1]);

    const stats = await request(app).get('/api/provider/stats?days=7').set(auth(token));
    expect(stats.status).toBe(200);
    expect(stats.body.stats.totals).toMatchObject({ bookings: 2, seatsSold: 2, activeTrips: 3 });
    expect(stats.body.stats.daily).toHaveLength(7);
    expect(stats.body.stats.daily.at(-1).bookings).toBe(2);
    expect(stats.body.stats.occupancyNext7).toHaveLength(7);

    const perf = await request(app).get('/api/provider/performance').set(auth(token));
    const byId = Object.fromEntries(perf.body.trips.map((t) => [t.tripId, t]));
    expect(byId[hot._id].recommendation).toMatchObject({ action: 'increase', suggestedBasePrice: 550 });
    expect(byId[cold._id].recommendation.action).toBe('decrease');
    expect(byId[mid._id].recommendation.action).toBe('hold');
    expect(byId[hot._id].revenue30d).toBeGreaterThan(0);
  });
});
