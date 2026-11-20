const policy = require('../../src/services/policyService');

describe('policyService.cancellationQuote', () => {
  test.each([
    [72, 10, 900],
    [30, 25, 750],
    [10, 50, 500],
    [3, 100, 0],
  ])('%dh before departure -> %i%% fee, refund %i', (hours, pct, refund) => {
    const q = policy.cancellationQuote(1000, hours);
    expect(q.allowed).toBe(true);
    expect(q.feePct).toBe(pct);
    expect(q.refund).toBe(refund);
    expect(q.fee + q.refund).toBe(1000);
  });

  test('customers cannot cancel after departure', () => {
    expect(policy.cancellationQuote(1000, -1).allowed).toBe(false);
  });

  test('operator/admin cancellations are always a full refund', () => {
    expect(policy.cancellationQuote(1000, 2, 'provider')).toMatchObject({ allowed: true, refund: 1000, fee: 0 });
    expect(policy.cancellationQuote(1000, -5, 'admin').refund).toBe(1000);
  });
});

describe('policyService.rescheduleFee', () => {
  test.each([
    [100, 0],
    [36, 10],
    [12, 20],
    [4, 30],
  ])('%dh before departure -> %i%% fee', (hours, pct) => {
    const q = policy.rescheduleFee(2000, hours);
    expect(q.allowed).toBe(true);
    expect(q.feePct).toBe(pct);
    expect(q.fee).toBe((2000 * pct) / 100);
  });

  test('rescheduling closes 2 hours before departure', () => {
    const q = policy.rescheduleFee(2000, 1.5);
    expect(q.allowed).toBe(false);
    expect(q.reason).toMatch(/2 hours/);
  });

  test('describePolicies lists every tier', () => {
    const p = policy.describePolicies();
    expect(p.cancellation).toHaveLength(policy.CANCELLATION_TIERS.length);
    expect(p.reschedule).toHaveLength(policy.RESCHEDULE_TIERS.length);
    expect(p.notes.length).toBeGreaterThan(0);
  });
});
