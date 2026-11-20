/**
 * Concrete agent tools. Each one is a thin adapter over an existing service,
 * so the agent obeys exactly the same business rules and concurrency
 * guarantees as the REST API.
 */
const { Booking } = require('../models');
const AppError = require('../utils/AppError');
const tripService = require('../services/tripService');
const bookingService = require('../services/bookingService');
const providerService = require('../services/providerService');
const adminService = require('../services/adminService');
const policy = require('../services/policyService');
const { todayStr } = require('../utils/dates');
const { createRegistry } = require('./registry');

const ALL = ['guest', 'customer', 'provider', 'admin'];
const MODES = ['bus', 'train', 'flight'];

const compactTrip = (t) => ({
  tripId: String(t._id),
  mode: t.mode,
  operator: t.provider?.companyName,
  route: `${t.source} → ${t.destination}`,
  source: t.source,
  destination: t.destination,
  date: t.date,
  departureTime: t.departureTime,
  arrivalTime: t.arrivalTime,
  durationMinutes: t.durationMinutes,
  pricePerSeat: t.fare.perSeat,
  basePrice: t.basePrice,
  priceFactors: t.fare.breakdown.map((b) => b.label),
  availableSeats: t.availableSeats,
  totalSeats: t.totalSeats,
});

const compactBooking = (b) => ({
  bookingId: String(b._id),
  pnr: b.pnr,
  status: b.status,
  route: b.trip ? `${b.trip.source} → ${b.trip.destination}` : undefined,
  mode: b.trip?.mode,
  operator: b.provider?.companyName,
  travelDate: b.travelDate,
  departureTime: b.trip?.departureTime,
  seats: b.seatNumbers,
  passengers: b.passengers.map((p) => p.name),
  amountPaid: b.amountPaid,
  refundAmount: b.refundAmount,
});

async function bookingByPnr(ctx, pnr) {
  if (!pnr) throw AppError.badRequest('Please provide the PNR (looks like BYTXXXXXX)');
  const booking = await Booking.findOne({ pnr: String(pnr).toUpperCase().trim(), customerId: ctx.user._id }).select('_id');
  if (!booking) throw AppError.notFound(`Booking with PNR ${pnr}`);
  return booking._id;
}

function requireActiveProvider(ctx) {
  if (!ctx.provider) throw AppError.forbidden('Provider profile not found');
  if (ctx.provider.status !== 'active') throw AppError.forbidden(`Your provider account is ${ctx.provider.status}`);
  return ctx.provider;
}

const tools = [
  {
    name: 'search_trips',
    description:
      'Search buses, trains and flights between two cities on a date. Returns live per-seat fares (dynamic pricing) and seat availability. Use this before recommending any trip.',
    roles: ALL,
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Departure city, e.g. "Delhi"' },
        destination: { type: 'string', description: 'Arrival city, e.g. "Jaipur"' },
        date: { type: 'string', description: 'Travel date YYYY-MM-DD (defaults to today)' },
        mode: { type: 'string', enum: MODES },
        maxPrice: { type: 'number', description: 'Maximum price per seat in INR' },
        seats: { type: 'integer', minimum: 1, maximum: 6 },
        sort: { type: 'string', enum: ['price_asc', 'departure', 'duration', 'seats'] },
      },
      required: ['source', 'destination'],
    },
    card: (res) => ({ type: 'trips', date: res.date, trips: res.trips }),
    async handler(args, ctx) {
      const res = await tripService.searchTrips(
        {
          source: args.source,
          destination: args.destination,
          date: args.date || todayStr(ctx.now),
          mode: MODES.includes(args.mode) ? args.mode : undefined,
          maxPrice: typeof args.maxPrice === 'number' ? args.maxPrice : undefined,
          seats: Number.isInteger(args.seats) ? args.seats : 1,
          sort: args.sort || 'price_asc',
        },
        ctx.now,
      );
      return { date: res.date, count: res.count, trips: res.trips.slice(0, 6).map(compactTrip) };
    },
  },
  {
    name: 'start_booking',
    description:
      'Open the checkout for a trip found via search_trips. The user then picks seats, enters passenger details and pays in the app. Use when the user wants to book.',
    roles: ['customer'],
    parameters: {
      type: 'object',
      properties: {
        tripId: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        seats: { type: 'integer', minimum: 1, maximum: 6 },
      },
      required: ['tripId', 'date'],
    },
    async handler(args, ctx) {
      const map = await tripService.getSeatMap(args.tripId, args.date, ctx.now);
      const seats = Math.min(Math.max(Number(args.seats) || 1, 1), 6);
      if (map.capacity - map.bookedSeats.length < seats) throw AppError.conflict('Not enough seats left on this trip');
      const t = map.trip;
      return {
        ok: true,
        message: 'Checkout is ready - the user can press "Continue to checkout".',
        trip: compactTrip(t),
        action: {
          type: 'open_checkout',
          label: `Choose seats · ${t.source} → ${t.destination} · ${t.date} ${t.departureTime}`,
          payload: { tripId: String(t._id), date: t.date, seats },
        },
      };
    },
  },
  {
    name: 'list_my_bookings',
    description: "List the logged-in customer's bookings with PNRs.",
    roles: ['customer'],
    parameters: {
      type: 'object',
      properties: { scope: { type: 'string', enum: ['upcoming', 'past', 'cancelled', 'all'] } },
    },
    card: (res) => ({ type: 'bookings', bookings: res.bookings }),
    async handler(args, ctx) {
      const list = await bookingService.listCustomerBookings(ctx.user._id, args.scope || 'upcoming', ctx.now);
      return { count: list.length, bookings: list.slice(0, 10).map(compactBooking) };
    },
  },
  {
    name: 'get_cancellation_quote',
    description: 'Get the refund amount and cancellation fee for a booking by PNR, without cancelling it.',
    roles: ['customer'],
    parameters: { type: 'object', properties: { pnr: { type: 'string' } }, required: ['pnr'] },
    async handler(args, ctx) {
      return bookingService.cancellationQuote(ctx.user._id, await bookingByPnr(ctx, args.pnr), ctx.now);
    },
  },
  {
    name: 'cancel_booking',
    description:
      'Propose cancelling a booking. Does NOT cancel immediately: it returns a confirmation button the user must press. Always state the refund first.',
    roles: ['customer'],
    parameters: {
      type: 'object',
      properties: { pnr: { type: 'string' }, reason: { type: 'string' } },
      required: ['pnr'],
    },
    async handler(args, ctx) {
      const bookingId = await bookingByPnr(ctx, args.pnr);
      const quote = await bookingService.cancellationQuote(ctx.user._id, bookingId, ctx.now);
      if (!quote.allowed) return { allowed: false, reason: quote.reason };
      return {
        proposed: true,
        requiresUserConfirmation: true,
        quote,
        action: {
          type: 'cancel_booking',
          label: `Cancel ${quote.pnr} · refund ₹${quote.refund}`,
          payload: { bookingId: String(bookingId), pnr: quote.pnr, refund: quote.refund, fee: quote.fee, reason: args.reason },
        },
      };
    },
  },
  {
    name: 'get_reschedule_quote',
    description: 'Get the fee, fare difference and new seats for moving a booking (by PNR) to another date, without changing it.',
    roles: ['customer'],
    parameters: {
      type: 'object',
      properties: { pnr: { type: 'string' }, newDate: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['pnr', 'newDate'],
    },
    async handler(args, ctx) {
      return bookingService.rescheduleQuote(ctx.user._id, await bookingByPnr(ctx, args.pnr), args.newDate, ctx.now);
    },
  },
  {
    name: 'reschedule_booking',
    description:
      'Propose moving a booking to a new date. Does NOT change it immediately: it returns a confirmation button. Always state the amount due first.',
    roles: ['customer'],
    parameters: {
      type: 'object',
      properties: { pnr: { type: 'string' }, newDate: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['pnr', 'newDate'],
    },
    async handler(args, ctx) {
      const bookingId = await bookingByPnr(ctx, args.pnr);
      const quote = await bookingService.rescheduleQuote(ctx.user._id, bookingId, args.newDate, ctx.now);
      return {
        proposed: true,
        requiresUserConfirmation: true,
        quote,
        action: {
          type: 'reschedule_booking',
          label: `Move ${quote.pnr} to ${quote.toDate} · pay ₹${quote.amountDue}`,
          payload: { bookingId: String(bookingId), pnr: quote.pnr, newDate: quote.toDate, amountDue: quote.amountDue },
        },
      };
    },
  },
  {
    name: 'get_policies',
    description: 'Cancellation, refund and reschedule rules of the platform.',
    roles: ALL,
    parameters: { type: 'object', properties: {} },
    async handler() {
      return policy.describePolicies();
    },
  },
  {
    name: 'get_provider_dashboard',
    description: "Operator KPIs: bookings, revenue, seats sold and next-7-day occupancy for the logged-in provider's fleet.",
    roles: ['provider'],
    parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } },
    card: (res) => ({ type: 'stats', stats: res }),
    async handler(args, ctx) {
      return providerService.dashboardStats(requireActiveProvider(ctx), args.days || 7, ctx.now);
    },
  },
  {
    name: 'get_pricing_recommendations',
    description:
      'Per-route occupancy for the next 7 days, 30-day revenue and a recommended base-fare change for each of the provider\'s trips.',
    roles: ['provider'],
    parameters: { type: 'object', properties: {} },
    card: (res) => ({ type: 'recommendations', items: res.trips }),
    async handler(_args, ctx) {
      const trips = await providerService.tripPerformance(requireActiveProvider(ctx), ctx.now);
      return { trips };
    },
  },
  {
    name: 'get_trip_manifest',
    description: 'Passenger manifest (names, seats, PNRs) for one of the provider\'s trips on a date.',
    roles: ['provider'],
    parameters: {
      type: 'object',
      properties: { tripId: { type: 'string' }, date: { type: 'string' } },
      required: ['tripId', 'date'],
    },
    async handler(args, ctx) {
      const m = await providerService.tripManifest(requireActiveProvider(ctx), args.tripId, args.date);
      return {
        route: `${m.trip.source} → ${m.trip.destination}`,
        date: m.date,
        occupancy: m.occupancy,
        bookedSeats: m.bookedSeats,
        capacity: m.capacity,
        revenue: m.revenue,
        passengers: m.passengers.slice(0, 50).map((p) => ({ seat: p.seatNumber, name: p.name, pnr: p.pnr })),
      };
    },
  },
  {
    name: 'get_platform_stats',
    description: 'Platform-wide KPIs for administrators.',
    roles: ['admin'],
    parameters: { type: 'object', properties: {} },
    async handler(_args, ctx) {
      return adminService.platformStats(ctx.now);
    },
  },
  {
    name: 'list_pending_providers',
    description: 'Providers waiting for onboarding approval.',
    roles: ['admin'],
    parameters: { type: 'object', properties: {} },
    async handler() {
      const list = await adminService.listProviders('pending');
      return {
        count: list.length,
        providers: list.map((p) => ({ id: String(p._id), companyName: p.companyName, services: p.servicesOffered, email: p.user?.email })),
      };
    },
  },
  {
    name: 'run_integrity_check',
    description: 'Verify that no seat is double booked and no trip is overbooked across the whole database.',
    roles: ['admin'],
    parameters: { type: 'object', properties: {} },
    async handler() {
      return adminService.integrityCheck();
    },
  },
];

const registry = createRegistry(tools);

module.exports = { registry, tools, compactTrip, compactBooking, listCities: tripService.listCities };
