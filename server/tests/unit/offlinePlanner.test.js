const { planOffline } = require('../../src/agent/offlinePlanner');

const NOW = new Date('2025-11-18T06:00:00Z'); // Tuesday in IST
const listCities = async () => ['Delhi', 'Jaipur', 'Mumbai', 'Goa'];

function harness(responses = {}) {
  const calls = [];
  const execute = async (name, args) => {
    calls.push({ name, args });
    const r = responses[name];
    return typeof r === 'function' ? r(args) : r;
  };
  return { calls, deps: { execute, listCities } };
}

const ctx = (role) => ({ role, now: NOW, user: role === 'guest' ? null : { _id: 'u' } });

const trip = { operator: 'Zing', mode: 'bus', departureTime: '06:00', arrivalTime: '11:30', durationMinutes: 330, pricePerSeat: 650, availableSeats: 30 };

describe('offline planner - customer intents', () => {
  test('searches trips with parsed route, date, mode, price cap and sort', async () => {
    const h = harness({ search_trips: { date: '2025-11-21', count: 1, trips: [trip] } });
    const reply = await planOffline('fastest bus from Delhi to Jaipur on friday under 900', ctx('customer'), h.deps);
    expect(h.calls[0]).toEqual({
      name: 'search_trips',
      args: { source: 'Delhi', destination: 'Jaipur', date: '2025-11-21', mode: 'bus', maxPrice: 900, sort: 'duration' },
    });
    expect(reply).toMatch(/Found 1 option/);
    expect(reply).toMatch(/₹650/);
  });

  test('reports empty search results and tool errors', async () => {
    let h = harness({ search_trips: { date: '2025-11-18', count: 0, trips: [] } });
    expect(await planOffline('earliest flight mumbai to goa', ctx('guest'), h.deps)).toMatch(/couldn't find any flight/);
    expect(h.calls[0].args.sort).toBe('departure');
    h = harness({ search_trips: { error: 'boom' } });
    expect(await planOffline('Delhi to Jaipur', ctx('guest'), h.deps)).toBe('Sorry - boom');
  });

  test('asks for the missing city', async () => {
    const h = harness();
    expect(await planOffline('anything to Goa?', ctx('guest'), h.deps)).toMatch(/Where from/);
  });

  test('lists bookings with the right scope', async () => {
    const h = harness({
      list_my_bookings: (args) => ({
        count: 1,
        bookings: [{ pnr: 'BYTAAAAAA', route: 'Delhi → Jaipur', travelDate: '2025-11-20', departureTime: '06:00', seats: [1, 2], status: args.scope }],
      }),
    });
    expect(await planOffline('show my past trips', ctx('customer'), h.deps)).toMatch(/BYTAAAAAA/);
    expect(h.calls[0].args.scope).toBe('past');
    await planOffline('show my cancelled bookings', ctx('customer'), h.deps);
    expect(h.calls[1].args.scope).toBe('cancelled');
    const empty = harness({ list_my_bookings: { count: 0, bookings: [] } });
    expect(await planOffline('my bookings', ctx('customer'), empty.deps)).toMatch(/don't have any/);
  });

  test('cancel proposes with refund info', async () => {
    const h = harness({ cancel_booking: { proposed: true, quote: { refund: 900, fee: 100, tier: '48+ hours' } } });
    const reply = await planOffline('please cancel BYTABCDEF', ctx('customer'), h.deps);
    expect(h.calls[0]).toEqual({ name: 'cancel_booking', args: { pnr: 'BYTABCDEF' } });
    expect(reply).toMatch(/refund ₹900/);
    const blocked = harness({ cancel_booking: { allowed: false, reason: 'departed' } });
    expect(await planOffline('cancel BYTABCDEF', ctx('customer'), blocked.deps)).toMatch(/departed/);
  });

  test('reschedule needs a date, then proposes', async () => {
    let h = harness();
    expect(await planOffline('reschedule BYTABCDEF', ctx('customer'), h.deps)).toMatch(/which date/);
    h = harness({
      reschedule_booking: { quote: { toDate: '2025-11-25', fee: 0, fareDifference: 120, amountDue: 120, seats: [3], keepsSeats: true } },
    });
    const reply = await planOffline('move BYTABCDEF to 25 nov', ctx('customer'), h.deps);
    expect(h.calls[0].args).toEqual({ pnr: 'BYTABCDEF', newDate: '2025-11-25' });
    expect(reply).toMatch(/₹120 due/);
    expect(reply).toMatch(/same seats/);
  });

  test('refund quote, policies, help and PNR prompts', async () => {
    const h = harness({ get_cancellation_quote: { refund: 500, fee: 500 }, get_policies: { cancellation: [{ window: 'w', feePercent: 10 }], reschedule: [{ window: 'w', feePercent: 0 }], notes: ['n'] } });
    expect(await planOffline('how much refund for BYTABCDEF', ctx('customer'), h.deps)).toMatch(/₹500 back/);
    expect(await planOffline('what is the cancellation policy?', ctx('guest'), h.deps)).toMatch(/Cancellation:/);
    expect(await planOffline('I want to cancel', ctx('customer'), h.deps)).toMatch(/PNR/);
    expect(await planOffline('hi', ctx('guest'), h.deps)).toMatch(/Log in to book/);
  });
});

describe('offline planner - provider & admin intents', () => {
  test('provider pricing recommendations and dashboard', async () => {
    const h = harness({
      get_pricing_recommendations: {
        trips: [{ route: 'Delhi → Jaipur', departureTime: '06:00', mode: 'bus', occupancyNext7: 90, recommendation: { action: 'increase', suggestedBasePrice: 715 } }],
      },
      get_provider_dashboard: {
        totals: { bookings: 12, seatsSold: 20, revenue: 15000, cancelled: 1, activeTrips: 3 },
        occupancyNext7: [{ occupancy: 40 }, { occupancy: 60 }],
      },
    });
    expect(await planOffline('any pricing suggestions?', ctx('provider'), h.deps)).toMatch(/INCREASE to ₹715/);
    expect(await planOffline('how is my fleet doing', ctx('provider'), h.deps)).toMatch(/average occupancy for the next week is 50%/i);
    const none = harness({ get_pricing_recommendations: { trips: [] } });
    expect(await planOffline('pricing', ctx('provider'), none.deps)).toMatch(/no active trips/);
  });

  test('admin integrity, pending providers and stats', async () => {
    const h = harness({
      run_integrity_check: { ok: true, inventoriesChecked: 5, seatsSold: 40, issues: [] },
      list_pending_providers: { count: 1, providers: [{ companyName: 'Nimbus', services: ['flight'], email: 'n@x.com' }] },
      get_platform_stats: { bookings: { total: 10, today: 2 }, revenue: 9999, activeTrips: 4, users: { customer: 7 }, providers: { active: 3 } },
    });
    expect(await planOffline('run integrity check', ctx('admin'), h.deps)).toMatch(/passed/);
    expect(await planOffline('pending approvals', ctx('admin'), h.deps)).toMatch(/Nimbus/);
    expect(await planOffline('platform stats', ctx('admin'), h.deps)).toMatch(/10 bookings \(2 today\)/);
    const bad = harness({ run_integrity_check: { ok: false, issues: [{ type: 'OVERBOOKED' }] }, list_pending_providers: { count: 0, providers: [] } });
    expect(await planOffline('integrity', ctx('admin'), bad.deps)).toMatch(/OVERBOOKED/);
    expect(await planOffline('pending', ctx('admin'), bad.deps)).toMatch(/No providers/);
  });
});
