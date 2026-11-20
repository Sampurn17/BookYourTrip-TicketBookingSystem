const { pickSeats, hasDuplicates, seatsInRange } = require('../../src/utils/seats');
const { generatePnr } = require('../../src/utils/pnr');

describe('utils/seats', () => {
  test('hasDuplicates / seatsInRange', () => {
    expect(hasDuplicates([1, 2, 2])).toBe(true);
    expect(hasDuplicates([1, 2, 3])).toBe(false);
    expect(seatsInRange([1, 10], 10)).toBe(true);
    expect(seatsInRange([0, 3], 10)).toBe(false);
    expect(seatsInRange([11], 10)).toBe(false);
    expect(seatsInRange([1.5], 10)).toBe(false);
  });

  test('keeps preferred seats when they are free', () => {
    expect(pickSeats(10, [1, 2], 2, [5, 6])).toEqual([5, 6]);
  });

  test('falls back to lowest free seats when preferred are taken', () => {
    expect(pickSeats(10, [1, 2, 5], 2, [5, 6])).toEqual([3, 4]);
  });

  test('ignores invalid preferred seats', () => {
    expect(pickSeats(4, [], 2, [4, 5])).toEqual([1, 2]);
    expect(pickSeats(4, [], 2, [3, 3])).toEqual([1, 2]);
  });

  test('returns null when there are not enough free seats', () => {
    expect(pickSeats(3, [1, 2], 2)).toBeNull();
  });
});

describe('utils/pnr', () => {
  test('generates unique, readable PNRs', () => {
    const set = new Set(Array.from({ length: 500 }, () => generatePnr()));
    expect(set.size).toBe(500);
    for (const p of set) expect(p).toMatch(/^BYT[2-9A-HJ-NP-Z]{6}$/);
  });
});
