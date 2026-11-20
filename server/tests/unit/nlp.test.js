const { parseDate, parseMode, parsePnr, parseMaxPrice, parseRoute } = require('../../src/agent/nlp');

const TODAY = '2025-11-18'; // Tuesday
const CITIES = ['Delhi', 'Jaipur', 'Mumbai', 'Goa', 'New Delhi', 'Kanpur', 'Bengaluru'];

describe('agent/nlp.parseDate', () => {
  test.each([
    ['book for today', '2025-11-18'],
    ['tomorrow morning', '2025-11-19'],
    ['day after tomorrow', '2025-11-20'],
    ['in 5 days', '2025-11-23'],
    ['next week', '2025-11-25'],
    ['on friday', '2025-11-21'],
    ['this tuesday', '2025-11-18'],
    ['next tuesday', '2025-11-25'],
    ['on 2025-12-01', '2025-12-01'],
    ['25 nov', '2025-11-25'],
    ['25th of December', '2025-12-25'],
    ['Dec 3rd', '2025-12-03'],
    ['on 5 jan', '2026-01-05'],
    ['10/12', '2025-12-10'],
    ['10-12-2025', '2025-12-10'],
  ])('"%s" -> %s', (text, expected) => {
    expect(parseDate(text, TODAY)).toBe(expected);
  });

  test('returns null when no date is mentioned or the date is impossible', () => {
    expect(parseDate('buses to goa', TODAY)).toBeNull();
    expect(parseDate('31/02/2025', TODAY)).toBeNull();
    expect(parseDate('31 feb', TODAY)).toBeNull();
  });
});

describe('agent/nlp other parsers', () => {
  test('parseMode', () => {
    expect(parseMode('cheapest flight please')).toBe('flight');
    expect(parseMode('any trains?')).toBe('train');
    expect(parseMode('overnight bus')).toBe('bus');
    expect(parseMode('how do I get there')).toBeUndefined();
  });

  test('parsePnr normalises case', () => {
    expect(parsePnr('cancel bytab23cd please')).toBe('BYTAB23CD');
    expect(parsePnr('no pnr here')).toBeNull();
  });

  test('parseMaxPrice', () => {
    expect(parseMaxPrice('under 1500')).toBe(1500);
    expect(parseMaxPrice('below ₹900')).toBe(900);
    expect(parseMaxPrice('max rs 2000')).toBe(2000);
    expect(parseMaxPrice('cheap')).toBeUndefined();
  });

  test('parseRoute honours from/to cues in any order', () => {
    expect(parseRoute('buses from Delhi to Jaipur', CITIES)).toEqual({ source: 'Delhi', destination: 'Jaipur' });
    expect(parseRoute('to goa from mumbai tomorrow', CITIES)).toEqual({ source: 'Mumbai', destination: 'Goa' });
    expect(parseRoute('kanpur delhi train', CITIES)).toEqual({ source: 'Kanpur', destination: 'Delhi' });
  });

  test('parseRoute returns partial results', () => {
    expect(parseRoute('anything to Bengaluru?', CITIES)).toEqual({ source: undefined, destination: 'Bengaluru' });
    expect(parseRoute('hello', CITIES)).toEqual({ source: undefined, destination: undefined });
  });
});
