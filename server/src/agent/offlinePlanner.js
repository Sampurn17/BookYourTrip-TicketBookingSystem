/**
 * Offline planner: a deterministic intent router that drives the SAME tools
 * as the LLM agent. It runs when no API key is configured or the LLM is
 * unreachable / out of quota, so the assistant never goes dark in a demo.
 */
const { todayStr } = require('../utils/dates');
const { parseDate, parseMode, parsePnr, parseMaxPrice, parseRoute } = require('./nlp');

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const hm = (mins) => `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;

const HELP = {
  guest: [
    'Find trips - "buses from Delhi to Jaipur tomorrow"',
    'Compare fares - "cheapest flight Mumbai to Goa on Friday"',
    'Explain rules - "what is the cancellation policy?"',
    'Log in to book, cancel or reschedule tickets.',
  ],
  customer: [
    'Find & book - "trains from Kanpur to Delhi next Monday under 900"',
    'Your trips - "show my upcoming bookings"',
    'Cancel - "cancel BYTXXXXXX" (I will show the refund first)',
    'Reschedule - "move BYTXXXXXX to 25 Nov"',
  ],
  provider: [
    'Performance - "how is my fleet doing this week?"',
    'Pricing - "give me pricing recommendations"',
    'Search the market - "flights from Delhi to Mumbai tomorrow"',
  ],
  admin: ['"platform stats"', '"pending providers"', '"run integrity check"'],
};

function errorReply(result) {
  return result && result.error ? `Sorry - ${result.error}` : null;
}

function formatTrips(res, args) {
  if (res.error) return errorReply(res);
  if (!res.count) {
    return `I couldn't find any ${args.mode || ''} trips from ${args.source} to ${args.destination} on ${res.date}. Try another date or mode.`.replace(/\s+/g, ' ');
  }
  const lines = res.trips
    .slice(0, 5)
    .map(
      (t) =>
        `• ${t.operator} (${t.mode}) ${t.departureTime}→${t.arrivalTime}, ${hm(t.durationMinutes)} - ${inr(t.pricePerSeat)}/seat, ${t.availableSeats} seats left`,
    );
  return `Found ${res.count} option(s) from ${args.source} to ${args.destination} on ${res.date}:\n${lines.join('\n')}\nTap a trip card to pick seats.`;
}

function formatBookings(res) {
  if (res.error) return errorReply(res);
  if (!res.count) return "You don't have any bookings here yet.";
  const lines = res.bookings.map((b) => `• ${b.pnr} - ${b.route} on ${b.travelDate} ${b.departureTime || ''} · seats ${b.seats.join(', ')} · ${b.status}`);
  return `Here are your bookings:\n${lines.join('\n')}`;
}

function formatPolicies(p) {
  const c = p.cancellation.map((t) => `• ${t.window}: ${t.feePercent}% fee`).join('\n');
  const r = p.reschedule.map((t) => `• ${t.window}: ${t.feePercent}% fee`).join('\n');
  return `Cancellation:\n${c}\n\nReschedule:\n${r}\n\n${p.notes.join(' ')}`;
}

async function planOffline(text, ctx, { execute, listCities }) {
  const t = text.toLowerCase().trim();
  const today = todayStr(ctx.now);
  const pnr = parsePnr(text);
  const date = parseDate(text, today);
  const { role } = ctx;

  if (role === 'admin') {
    if (/integrity|double|overbook|consisten/.test(t)) {
      const r = await execute('run_integrity_check', {});
      return r.ok
        ? `Integrity check passed ✅ - ${r.inventoriesChecked} seat inventories verified, ${r.seatsSold} seats sold, no double bookings or overbooking.`
        : `Integrity check found ${r.issues.length} issue(s): ${r.issues.map((i) => i.type).join(', ')}`;
    }
    if (/pending|approv|onboard/.test(t)) {
      const r = await execute('list_pending_providers', {});
      return r.count
        ? `${r.count} provider(s) awaiting approval:\n${r.providers.map((p) => `• ${p.companyName} (${p.services.join(', ')}) - ${p.email}`).join('\n')}`
        : 'No providers are waiting for approval.';
    }
    if (/stat|overview|revenue|dashboard|kpi|summary/.test(t)) {
      const s = await execute('get_platform_stats', {});
      return `Platform overview: ${s.bookings.total} bookings (${s.bookings.today} today), revenue ${inr(s.revenue)}, ${s.activeTrips} active trips, ${s.users.customer || 0} customers, ${s.providers.active || 0} active providers.`;
    }
  }

  if (role === 'provider') {
    if (/pric|recommend|insight|suggest|optimi/.test(t)) {
      const r = await execute('get_pricing_recommendations', {});
      if (r.error) return errorReply(r);
      if (!r.trips.length) return 'You have no active trips yet. Add a trip to get recommendations.';
      return `Pricing recommendations (next 7 days):\n${r.trips
        .map((x) => `• ${x.route} ${x.departureTime} (${x.mode}) - ${x.occupancyNext7}% booked → ${x.recommendation.action.toUpperCase()}${x.recommendation.suggestedBasePrice ? ` to ${inr(x.recommendation.suggestedBasePrice)}` : ''}`)
        .join('\n')}`;
    }
    if (/stat|dashboard|revenue|occupan|perform|kpi|sales|doing/.test(t)) {
      const s = await execute('get_provider_dashboard', { days: 7 });
      if (s.error) return errorReply(s);
      const avg = Math.round(s.occupancyNext7.reduce((a, d) => a + d.occupancy, 0) / (s.occupancyNext7.length || 1));
      return `Last 7 days: ${s.totals.bookings} bookings, ${s.totals.seatsSold} seats sold, net revenue ${inr(s.totals.revenue)}, ${s.totals.cancelled} cancellations. Average occupancy for the next week is ${avg}% across ${s.totals.activeTrips} active trips.`;
    }
  }

  if (!pnr && /polic|rules|penalt|\bfees?\b|charges|refund rule/.test(t)) {
    return formatPolicies(await execute('get_policies', {}));
  }

  if (pnr && /cancel/.test(t)) {
    const r = await execute('cancel_booking', { pnr });
    if (r.error) return errorReply(r);
    if (r.allowed === false) return `This booking can't be cancelled: ${r.reason}`;
    return `Cancelling ${pnr} now would refund ${inr(r.quote.refund)} (fee ${inr(r.quote.fee)}, ${r.quote.tier}). Press "Confirm" below to go ahead.`;
  }

  if (pnr && /reschedul|change|move|shift|postpone|prepone|date/.test(t)) {
    if (!date) return `Sure - which date should I move ${pnr} to?`;
    const r = await execute('reschedule_booking', { pnr, newDate: date });
    if (r.error) return errorReply(r);
    const q = r.quote;
    return `Moving ${pnr} to ${q.toDate}: reschedule fee ${inr(q.fee)}${q.fareDifference ? ` + fare difference ${inr(q.fareDifference)}` : ''} = ${inr(q.amountDue)} due. Seats: ${q.seats.join(', ')}${q.keepsSeats ? ' (same seats)' : ''}. Press "Confirm" to proceed.`;
  }

  if (pnr && /refund|quote|how much/.test(t)) {
    const q = await execute('get_cancellation_quote', { pnr });
    return q.error ? errorReply(q) : `If you cancel ${pnr} now you get ${inr(q.refund)} back (fee ${inr(q.fee)}).`;
  }

  if (/\b(my|upcoming|show|list|view)\b.*\b(booking|trip|ticket|journey|pnr)/.test(t) || /^(bookings?|my trips)$/.test(t)) {
    const scope = /cancel/.test(t) ? 'cancelled' : /past|previous|old|history/.test(t) ? 'past' : 'upcoming';
    return formatBookings(await execute('list_my_bookings', { scope }));
  }

  const cities = await listCities();
  const { source, destination } = parseRoute(text, cities);
  if (source && destination) {
    let sort = 'price_asc';
    if (/fast|quick|short/.test(t)) sort = 'duration';
    else if (/earl|morning|first/.test(t)) sort = 'departure';
    const args = { source, destination, date: date || today, mode: parseMode(text), maxPrice: parseMaxPrice(text), sort };
    return formatTrips(await execute('search_trips', args), args);
  }
  if (source || destination) {
    return `Got it - ${source ? `from ${source}` : `to ${destination}`}. Where ${source ? 'to' : 'from'}? We currently serve: ${cities.slice(0, 12).join(', ')}.`;
  }
  if (/cancel|reschedul/.test(t)) return 'Please share the PNR of the booking (it looks like BYTXXXXXX).';

  return `I can help with:\n${(HELP[role] || HELP.guest).map((l) => `• ${l}`).join('\n')}`;
}

module.exports = { planOffline, formatTrips, formatBookings, formatPolicies };
