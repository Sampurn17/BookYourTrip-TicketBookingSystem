const request = require('supertest');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createProvider, createTrip, createCustomer, createAdmin, dateIn, bookingBody } = require('../helpers/factory');
const { Booking } = require('../../src/models');
const { registry } = require('../../src/agent/tools');
const { addDays } = require('../../src/utils/dates');

let app;
let provider;
let providerToken;
let trip;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
beforeEach(async () => {
  ({ provider, token: providerToken } = await createProvider());
  trip = await createTrip(provider, { totalSeats: 12 });
});
afterEach(clearDB);
afterAll(stopDB);

const chat = (content, token) => {
  const req = request(app).post('/api/agent/chat');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({ messages: [{ role: 'user', content }] });
};
const state = () => ({ cards: [], actions: [], toolCalls: [] });

describe('POST /api/agent/chat (offline mode, no API key)', () => {
  test('guests can search and get trip cards', async () => {
    const date = dateIn(4);
    const res = await chat(`buses from Delhi to Jaipur on ${date}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('offline');
    expect(res.body.reply).toMatch(/Found 1 option/);
    expect(res.body.cards[0]).toMatchObject({ type: 'trips', date });
    expect(res.body.cards[0].trips[0].tripId).toBe(String(trip._id));
  });

  test('guests are asked to log in for account actions', async () => {
    const res = await chat('cancel BYTABCDEF');
    expect(res.body.reply).toMatch(/log in/);
    expect(res.body.actions).toEqual([]);
  });

  test('customers manage bookings through confirmation actions (human in the loop)', async () => {
    const { token } = await createCustomer();
    const date = dateIn(5);
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingBody(trip, date, [2]));
    const { pnr, _id } = created.body.booking;

    const list = await chat('show my upcoming bookings', token);
    expect(list.body.cards[0].type).toBe('bookings');
    expect(list.body.reply).toContain(pnr);

    const cancel = await chat(`please cancel ${pnr}`, token);
    expect(cancel.body.actions[0]).toMatchObject({ type: 'cancel_booking', payload: { bookingId: _id, pnr } });
    expect((await Booking.findById(_id)).status).toBe('confirmed'); // nothing happened yet

    const move = await chat(`move ${pnr} to ${addDays(date, 3)}`, token);
    expect(move.body.actions[0]).toMatchObject({ type: 'reschedule_booking', payload: { newDate: addDays(date, 3) } });

    // the UI's Confirm button calls the regular REST endpoint
    const confirmed = await request(app).post(`/api/bookings/${_id}/cancel`).set('Authorization', `Bearer ${token}`).send({});
    expect(confirmed.status).toBe(200);
  });

  test('providers get fleet insights; admins get platform tools', async () => {
    const perf = await chat('give me pricing recommendations', providerToken);
    expect(perf.body.reply).toMatch(/Delhi → Jaipur/);
    expect(perf.body.cards[0].type).toBe('recommendations');

    const { token } = await createAdmin();
    expect((await chat('run integrity check', token)).body.reply).toMatch(/passed/);
  });

  test('validates the conversation payload', async () => {
    expect((await request(app).post('/api/agent/chat').send({ messages: [] })).status).toBe(422);
    const res = await request(app).post('/api/agent/chat').set('Authorization', 'Bearer stale').send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(200); // invalid tokens degrade to guest
    expect(res.body.reply).toMatch(/I can help with/);
  });
});

describe('Agent tools against the real services', () => {
  test('customer tools: start_booking, quotes and errors', async () => {
    const { user, token } = await createCustomer();
    const ctx = { user, role: 'customer', now: new Date() };
    const date = dateIn(6);

    const start = await registry.execute('start_booking', { tripId: String(trip._id), date, seats: 2 }, ctx, state());
    expect(start.action).toMatchObject({ type: 'open_checkout', payload: { tripId: String(trip._id), date, seats: 2 } });

    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingBody(trip, date, [1]));
    const { pnr } = created.body.booking;
    expect((await registry.execute('get_cancellation_quote', { pnr }, ctx, state())).refund).toBeGreaterThan(0);
    expect((await registry.execute('get_reschedule_quote', { pnr, newDate: addDays(date, 1) }, ctx, state())).toDate).toBe(addDays(date, 1));
    expect((await registry.execute('get_cancellation_quote', { pnr: 'BYTZZZZZZ' }, ctx, state())).error).toMatch(/not found/);
    expect((await registry.execute('get_cancellation_quote', {}, ctx, state())).error).toMatch(/PNR/);
    expect((await registry.execute('get_policies', {}, ctx, state())).cancellation.length).toBeGreaterThan(0);

    const other = await createCustomer();
    const otherCtx = { user: other.user, role: 'customer', now: new Date() };
    expect((await registry.execute('cancel_booking', { pnr }, otherCtx, state())).error).toMatch(/not found/); // cannot touch others' bookings
  });

  test('provider and admin tools', async () => {
    const date = dateIn(3);
    const { token } = await createCustomer();
    await request(app).post('/api/bookings').set('Authorization', `Bearer ${token}`).send(bookingBody(trip, date, [5]));
    const pctx = { user: { _id: provider.userId }, role: 'provider', provider, now: new Date() };

    const dash = await registry.execute('get_provider_dashboard', { days: 7 }, pctx, state());
    expect(dash.totals.bookings).toBe(1);
    const manifest = await registry.execute('get_trip_manifest', { tripId: String(trip._id), date }, pctx, state());
    expect(manifest.passengers[0]).toMatchObject({ seat: 5 });
    const inactive = { ...pctx, provider: { ...provider.toObject(), status: 'suspended' } };
    expect((await registry.execute('get_provider_dashboard', {}, inactive, state())).error).toMatch(/suspended/);
    expect((await registry.execute('get_provider_dashboard', {}, { ...pctx, provider: null }, state())).error).toMatch(/not found/);

    const actx = { user: { _id: 'a' }, role: 'admin', now: new Date() };
    await createProvider({ status: 'pending' });
    expect((await registry.execute('list_pending_providers', {}, actx, state())).count).toBe(1);
    expect((await registry.execute('get_platform_stats', {}, actx, state())).bookings.total).toBe(1);
  });
});
