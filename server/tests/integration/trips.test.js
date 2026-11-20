const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createProvider, createTrip, createCustomer, dateIn, bookingBody } = require('../helpers/factory');
const tripService = require('../../src/services/tripService');
const { dayOfWeek, departureDateTime, addDays, todayStr } = require('../../src/utils/dates');

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
afterAll(stopDB);

describe('GET /api/trips/search', () => {
  test('finds trips by case-insensitive city prefix with live fare and seats', async () => {
    const trip = await createTrip(provider, { basePrice: 800, totalSeats: 20 });
    await createTrip(provider, { source: 'Mumbai', destination: 'Pune' });
    const date = dateIn(10);
    const res = await request(app).get(`/api/trips/search?source=del&destination=JAI&date=${date}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const t = res.body.trips[0];
    expect(t._id).toBe(String(trip._id));
    expect(t.availableSeats).toBe(20);
    expect(t.provider.companyName).toBe(provider.companyName);
    expect(t.fare.perSeat).toBeGreaterThanOrEqual(Math.round(800 * 0.8));
    expect(t.date).toBe(date);
  });

  test('applies mode, price, time and seat filters and sorting', async () => {
    await createTrip(provider, { mode: 'bus', basePrice: 400, departureTime: '06:00', arrivalTime: '11:00' });
    await createTrip(provider, { mode: 'train', basePrice: 900, departureTime: '14:00', arrivalTime: '19:00', totalSeats: 2 });
    await createTrip(provider, { mode: 'flight', basePrice: 4000, departureTime: '20:00', arrivalTime: '21:00' });
    const date = dateIn(10);
    const q = (s) => request(app).get(`/api/trips/search?source=Delhi&destination=Jaipur&date=${date}&${s}`);

    expect((await q('mode=train')).body.trips.map((t) => t.mode)).toEqual(['train']);
    expect((await q('maxPrice=1500')).body.count).toBe(2);
    expect((await q('minPrice=1500')).body.trips[0].mode).toBe('flight');
    expect((await q('departAfter=12:00&departBefore=18:00')).body.trips.map((t) => t.mode)).toEqual(['train']);
    expect((await q('seats=3')).body.trips.map((t) => t.mode)).not.toContain('train');
    expect((await q('sort=price_desc')).body.trips.map((t) => t.mode)).toEqual(['flight', 'train', 'bus']);
    expect((await q('sort=price_asc')).body.trips[0].mode).toBe('bus');
    expect((await q('sort=duration')).body.trips[0].mode).toBe('flight');
    expect((await q('sort=arrival')).body.trips[0].mode).toBe('bus');
    expect((await q('sort=seats')).body.trips.at(-1).mode).toBe('train');
    expect((await q('sort=bogus')).status).toBe(422);
  });

  test('hides cancelled trips, inactive providers and non-operating days', async () => {
    const date = dateIn(10);
    await createTrip(provider, { status: 'cancelled' });
    await createTrip(provider, { operatingDays: [(dayOfWeek(date) + 1) % 7] });
    const { provider: suspended } = await createProvider({ status: 'suspended' });
    await createTrip(suspended);
    const res = await request(app).get(`/api/trips/search?source=Delhi&date=${date}`);
    expect(res.body.count).toBe(0);
  });

  test('excludes departures whose booking window has closed', async () => {
    const date = dateIn(1);
    await createTrip(provider, { departureTime: '10:00', arrivalTime: '12:00' });
    const justAfter = new Date(departureDateTime(date, '10:00').getTime() - 10 * 60 * 1000);
    expect((await tripService.searchTrips({ date, sort: 'departure', seats: 1 }, justAfter)).count).toBe(0);
    const dayBefore = new Date(departureDateTime(date, '10:00').getTime() - 24 * 3600 * 1000);
    expect((await tripService.searchTrips({ date, sort: 'departure', seats: 1 }, dayBefore)).count).toBe(1);
  });

  test('lists served cities and policies', async () => {
    await createTrip(provider);
    await createTrip(provider, { source: 'Agra', destination: 'Delhi' });
    expect((await request(app).get('/api/trips/cities')).body.cities).toEqual(['Agra', 'Delhi', 'Jaipur']);
    expect((await request(app).get('/api/policies')).body.policies.cancellation.length).toBeGreaterThan(0);
  });
});

describe('GET /api/trips/:id and /seats', () => {
  test('returns trip details and a seat map reflecting bookings', async () => {
    const trip = await createTrip(provider, { totalSeats: 6 });
    const date = dateIn(4);
    const { token } = await createCustomer();
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingBody(trip, date, [4, 2]));

    expect((await request(app).get(`/api/trips/${trip._id}`)).body.trip.source).toBe('Delhi');
    const res = await request(app).get(`/api/trips/${trip._id}/seats?date=${date}`);
    expect(res.status).toBe(200);
    expect(res.body.capacity).toBe(6);
    expect(res.body.bookedSeats).toEqual([2, 4]);
    expect(res.body.trip.availableSeats).toBe(4);
  });

  test('validates dates against the schedule and booking window', async () => {
    const trip = await createTrip(provider);
    const get = (date) => request(app).get(`/api/trips/${trip._id}/seats?date=${date}`);
    expect((await get(addDays(todayStr(), -1))).body.code).toBe('INVALID_DATE');
    expect((await get(addDays(todayStr(), 400))).body.code).toBe('OUTSIDE_WINDOW');
    expect((await get('2025-13-01')).status).toBe(422);

    const weekdayOnly = await createTrip(provider, { operatingDays: [1] });
    let d = dateIn(2);
    while (dayOfWeek(d) === 1) d = addDays(d, 1);
    expect((await request(app).get(`/api/trips/${weekdayOnly._id}/seats?date=${d}`)).body.code).toBe('TRIP_NOT_OPERATING');

    expect((await request(app).get(`/api/trips/507f1f77bcf86cd799439011/seats?date=${dateIn(2)}`)).status).toBe(404);
    const cancelled = await createTrip(provider, { status: 'cancelled' });
    expect((await request(app).get(`/api/trips/${cancelled._id}/seats?date=${dateIn(2)}`)).body.code).toBe('TRIP_UNAVAILABLE');
  });

  test('assertBookableDate closes sales before departure', () => {
    const date = dateIn(1);
    const trip = { operatingDays: [0, 1, 2, 3, 4, 5, 6], departureTime: '09:00' };
    const tooLate = new Date(departureDateTime(date, '09:00').getTime() - 5 * 60 * 1000);
    expect(() => tripService.assertBookableDate(trip, date, tooLate)).toThrow('closed');
    expect(() => tripService.assertBookableDate(trip, 'garbage')).toThrow('Invalid travel date');
  });
});
