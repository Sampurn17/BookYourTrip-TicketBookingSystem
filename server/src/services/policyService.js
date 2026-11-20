/**
 * Cancellation & reschedule policies (Strategy pattern - swap tables per provider or mode later).
 * Fees are a percentage of the fare paid and depend on how close to departure the change is made.
 */
const config = require('../config');

/** Ordered by `minHours` descending; first matching tier wins. */
const CANCELLATION_TIERS = [
  { minHours: 48, feePct: 10, label: '48+ hours before departure' },
  { minHours: 24, feePct: 25, label: '24-48 hours before departure' },
  { minHours: 6, feePct: 50, label: '6-24 hours before departure' },
  { minHours: 0, feePct: 100, label: 'Less than 6 hours before departure' },
];

const RESCHEDULE_TIERS = [
  { minHours: 48, feePct: 0, label: '48+ hours before departure' },
  { minHours: 24, feePct: 10, label: '24-48 hours before departure' },
  { minHours: 6, feePct: 20, label: '6-24 hours before departure' },
  { minHours: 0, feePct: 30, label: 'Less than 6 hours before departure' },
];

const tierFor = (tiers, hours) => tiers.find((t) => hours >= t.minHours) || tiers[tiers.length - 1];

/**
 * @param {number} farePaid amount the customer paid for the tickets (excluding earlier penalties)
 * @param {number} hoursToDeparture
 * @param {'customer'|'provider'|'admin'|'system'} actor provider/admin cancellations are always fully refunded
 */
function cancellationQuote(farePaid, hoursToDeparture, actor = 'customer') {
  if (hoursToDeparture <= 0 && actor === 'customer') {
    return { allowed: false, reason: 'This journey has already departed', fee: 0, refund: 0, feePct: 100 };
  }
  if (actor !== 'customer') {
    return { allowed: true, fee: 0, refund: farePaid, feePct: 0, tier: 'Cancelled by operator - full refund' };
  }
  const tier = tierFor(CANCELLATION_TIERS, hoursToDeparture);
  const fee = Math.round((farePaid * tier.feePct) / 100);
  return { allowed: true, fee, refund: farePaid - fee, feePct: tier.feePct, tier: tier.label };
}

function rescheduleFee(farePaid, hoursToDeparture) {
  const cutoff = config.business.rescheduleCutoffHours;
  if (hoursToDeparture < cutoff) {
    return {
      allowed: false,
      reason: `Rescheduling closes ${cutoff} hours before departure`,
      fee: 0,
      feePct: 0,
    };
  }
  const tier = tierFor(RESCHEDULE_TIERS, hoursToDeparture);
  return { allowed: true, fee: Math.round((farePaid * tier.feePct) / 100), feePct: tier.feePct, tier: tier.label };
}

function describePolicies() {
  return {
    cancellation: CANCELLATION_TIERS.map((t) => ({ window: t.label, feePercent: t.feePct })),
    reschedule: RESCHEDULE_TIERS.map((t) => ({ window: t.label, feePercent: t.feePct })),
    notes: [
      `Rescheduling is not possible within ${config.business.rescheduleCutoffHours} hours of departure.`,
      'If the new date is more expensive, the fare difference is charged. Cheaper dates are not refunded.',
      'Trips cancelled by the operator or platform are refunded in full.',
      `Booking closes ${config.business.bookingCutoffMinutes} minutes before departure.`,
    ],
  };
}

module.exports = { cancellationQuote, rescheduleFee, describePolicies, CANCELLATION_TIERS, RESCHEDULE_TIERS };
