/**
 * Dynamic pricing engine (Strategy + Composite pattern).
 *
 * Each rule is an independent strategy that returns a multiplicative factor
 * and a human-readable label. The engine multiplies the factors, clamps the
 * result and returns a full breakdown so the UI (and the AI agent) can
 * explain *why* a fare is what it is.
 */
const { dayOfWeek, departureDateTime, hoursUntil } = require('../utils/dates');

const MIN_MULTIPLIER = 0.8;
const MAX_MULTIPLIER = 2.5;

/** Demand: the fuller the vehicle, the higher the price. */
const occupancyRule = {
  name: 'occupancy',
  apply({ capacity, bookedCount }) {
    const occupancy = capacity > 0 ? bookedCount / capacity : 1;
    if (occupancy >= 0.9) return { factor: 1.5, label: 'Last few seats (90%+ booked)' };
    if (occupancy >= 0.75) return { factor: 1.3, label: 'High demand (75%+ booked)' };
    if (occupancy >= 0.5) return { factor: 1.15, label: 'Filling fast (50%+ booked)' };
    return null;
  },
};

/** Lead time: last-minute purchases cost more, early birds get a discount. */
const leadTimeRule = {
  name: 'lead_time',
  apply({ hoursToDeparture }) {
    if (hoursToDeparture < 6) return { factor: 1.35, label: 'Departs within 6 hours' };
    if (hoursToDeparture < 24) return { factor: 1.25, label: 'Departs within 24 hours' };
    if (hoursToDeparture < 72) return { factor: 1.1, label: 'Departs within 3 days' };
    if (hoursToDeparture > 24 * 21) return { factor: 0.9, label: 'Early-bird discount (3+ weeks ahead)' };
    return null;
  },
};

/** Weekend travel (Fri/Sat/Sun departures) carries a small premium. */
const weekendRule = {
  name: 'weekend',
  apply({ date }) {
    const dow = dayOfWeek(date);
    return dow === 0 || dow === 5 || dow === 6 ? { factor: 1.1, label: 'Weekend travel' } : null;
  },
};

const DEFAULT_RULES = [occupancyRule, leadTimeRule, weekendRule];

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} p
 * @param {number} p.basePrice
 * @param {number} p.capacity
 * @param {number} p.bookedCount   seats already sold before this purchase
 * @param {string} p.date          'YYYY-MM-DD'
 * @param {string} p.departureTime 'HH:mm'
 * @param {number} [p.seats=1]
 * @param {Date}   [p.now]
 */
function quoteFare({ basePrice, capacity, bookedCount, date, departureTime, seats = 1, now = new Date() }, rules = DEFAULT_RULES) {
  const hoursToDeparture = hoursUntil(departureDateTime(date, departureTime), now);
  const ctx = { capacity, bookedCount, date, hoursToDeparture };

  const breakdown = [];
  let multiplier = 1;
  for (const rule of rules) {
    const r = rule.apply(ctx);
    if (r) {
      breakdown.push({ rule: rule.name, label: r.label, factor: r.factor });
      multiplier *= r.factor;
    }
  }
  multiplier = round2(Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, multiplier)));
  const perSeat = Math.round(basePrice * multiplier);

  return { basePrice, multiplier, perSeat, total: perSeat * seats, breakdown };
}

module.exports = {
  quoteFare,
  rules: { occupancyRule, leadTimeRule, weekendRule },
  DEFAULT_RULES,
  MIN_MULTIPLIER,
  MAX_MULTIPLIER,
};
