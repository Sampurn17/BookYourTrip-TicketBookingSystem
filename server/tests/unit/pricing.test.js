const { quoteFare, rules, MAX_MULTIPLIER, MIN_MULTIPLIER } = require('../../src/services/pricingService');

// Thursday 2025-11-20 10:00 IST = 04:30Z. "now" 10 days earlier -> no lead-time rule.
const base = { basePrice: 1000, capacity: 100, bookedCount: 0, date: '2025-11-20', departureTime: '10:00' };
const daysBefore = (days) => new Date(Date.parse('2025-11-20T04:30:00Z') - days * 24 * 3600 * 1000);

describe('pricingService.quoteFare', () => {
  test('base fare when demand is low, departure is mid-range and on a weekday', () => {
    const q = quoteFare({ ...base, now: daysBefore(10) });
    expect(q.multiplier).toBe(1);
    expect(q.perSeat).toBe(1000);
    expect(q.total).toBe(1000);
    expect(q.breakdown).toEqual([]);
  });

  test('multiplies total by seat count', () => {
    expect(quoteFare({ ...base, seats: 3, now: daysBefore(10) }).total).toBe(3000);
  });

  test.each([
    [50, 1.15],
    [75, 1.3],
    [90, 1.5],
  ])('occupancy %i%% applies factor %d', (booked, factor) => {
    const q = quoteFare({ ...base, bookedCount: booked, now: daysBefore(10) });
    expect(q.multiplier).toBe(factor);
    expect(q.breakdown[0].rule).toBe('occupancy');
  });

  test.each([
    [0.2, 1.35],
    [0.5, 1.25],
    [2, 1.1],
    [30, 0.9],
  ])('lead time of %d days applies factor %d', (days, factor) => {
    expect(quoteFare({ ...base, now: daysBefore(days) }).multiplier).toBe(factor);
  });

  test('weekend premium on Friday/Saturday/Sunday', () => {
    const q = quoteFare({ ...base, date: '2025-11-22', now: new Date('2025-11-10T00:00:00Z') });
    expect(q.breakdown.map((b) => b.rule)).toContain('weekend');
    expect(q.multiplier).toBe(1.1);
  });

  test('factors compound and are clamped to the maximum', () => {
    const q = quoteFare({ ...base, date: '2025-11-22', bookedCount: 95, now: new Date('2025-11-22T02:00:00Z') });
    expect(q.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
    expect(q.breakdown.length).toBe(3);
  });

  test('clamps to the minimum with a custom aggressive discount rule', () => {
    const cheap = { name: 'promo', apply: () => ({ factor: 0.1, label: 'promo' }) };
    expect(quoteFare({ ...base, now: daysBefore(10) }, [cheap]).multiplier).toBe(MIN_MULTIPLIER);
  });

  test('a sold-out (capacity 0) vehicle is treated as full', () => {
    expect(rules.occupancyRule.apply({ capacity: 0, bookedCount: 0 }).factor).toBe(1.5);
  });
});
