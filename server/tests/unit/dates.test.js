const d = require('../../src/utils/dates');

describe('utils/dates', () => {
  test('validates YYYY-MM-DD strings including impossible dates', () => {
    expect(d.isValidDateStr('2025-11-20')).toBe(true);
    expect(d.isValidDateStr('2025-02-30')).toBe(false);
    expect(d.isValidDateStr('20-11-2025')).toBe(false);
    expect(d.isValidDateStr(20251120)).toBe(false);
  });

  test('validates HH:mm times', () => {
    expect(d.isValidTimeStr('23:59')).toBe(true);
    expect(d.isValidTimeStr('24:00')).toBe(false);
    expect(d.isValidTimeStr('7:00')).toBe(false);
  });

  test('todayStr uses the business timezone (IST), not UTC', () => {
    // 20:00 UTC on the 17th is 01:30 IST on the 18th
    expect(d.todayStr(new Date('2025-11-17T20:00:00Z'))).toBe('2025-11-18');
    expect(d.todayStr(new Date('2025-11-17T10:00:00Z'))).toBe('2025-11-17');
  });

  test('addDays / diffDays / dayOfWeek handle month and year boundaries', () => {
    expect(d.addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(d.addDays('2025-03-01', -1)).toBe('2025-02-28');
    expect(d.diffDays('2025-11-18', '2025-11-25')).toBe(7);
    expect(d.dayOfWeek('2025-11-23')).toBe(0);
  });

  test('departureDateTime is an absolute instant in IST', () => {
    expect(d.departureDateTime('2025-11-20', '10:00').toISOString()).toBe('2025-11-20T04:30:00.000Z');
  });

  test('hoursUntil and durationMinutes (overnight trips)', () => {
    const now = new Date('2025-11-20T00:00:00Z');
    expect(d.hoursUntil(new Date('2025-11-20T06:00:00Z'), now)).toBe(6);
    expect(d.durationMinutes('06:00', '11:30')).toBe(330);
    expect(d.durationMinutes('22:30', '04:15')).toBe(345);
    expect(d.timeToMinutes('01:05')).toBe(65);
  });

  test('offsetMinutes parses signed offsets', () => {
    expect(d.offsetMinutes('+05:30')).toBe(330);
    expect(d.offsetMinutes('-04:00')).toBe(-240);
    expect(d.offsetMinutes('bad')).toBe(0);
  });
});
