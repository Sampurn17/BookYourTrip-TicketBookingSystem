/**
 * Lightweight, dependency-free language helpers used by the offline planner
 * (and unit tested on their own): relative dates, cities, modes, PNRs, prices.
 */
const { addDays, dayOfWeek, isValidDateStr } = require('../utils/dates');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PNR_RE = /\bBYT[2-9A-HJ-NP-Z]{6}\b/i;

const pad = (n) => String(n).padStart(2, '0');

function nextDateFor(today, month, day) {
  const year = Number(today.slice(0, 4));
  let candidate = `${year}-${pad(month)}-${pad(day)}`;
  if (!isValidDateStr(candidate)) return null;
  if (candidate < today) candidate = `${year + 1}-${pad(month)}-${pad(day)}`;
  return isValidDateStr(candidate) ? candidate : null;
}

/** Resolve a date mentioned in free text relative to `today` ('YYYY-MM-DD'). */
function parseDate(text, today) {
  const t = text.toLowerCase();

  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isValidDateStr(iso[1])) return iso[1];

  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\b(today|tonight)\b/.test(t)) return today;
  if (/\btomorrow\b|\btmrw\b|\btmr\b/.test(t)) return addDays(today, 1);

  const inDays = t.match(/\bin (\d{1,2}) days?\b/);
  if (inDays) return addDays(today, Number(inDays[1]));
  if (/\bnext week\b/.test(t)) return addDays(today, 7);

  const wd = t.match(/\b(next |this |coming )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|urday|sday)?\b/);
  if (wd) {
    const target = WEEKDAYS.findIndex((d) => d.startsWith(wd[2].slice(0, 3)));
    let delta = (target - dayOfWeek(today) + 7) % 7;
    if (delta === 0 && wd[1] && wd[1].trim() === 'next') delta = 7;
    return addDays(today, delta);
  }

  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (dm) return nextDateFor(today, MONTHS.indexOf(dm[2]) + 1, Number(dm[1]));
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (md) return nextDateFor(today, MONTHS.indexOf(md[1]) + 1, Number(md[2]));

  const slash = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?\b/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    if (slash[3]) {
      const c = `${slash[3]}-${pad(month)}-${pad(day)}`;
      return isValidDateStr(c) ? c : null;
    }
    return nextDateFor(today, month, day);
  }
  return null;
}

function parseMode(text) {
  const t = text.toLowerCase();
  if (/\b(flight|flights|fly|plane|air)\b/.test(t)) return 'flight';
  if (/\b(train|trains|rail)\b/.test(t)) return 'train';
  if (/\b(bus|buses|coach)\b/.test(t)) return 'bus';
  return undefined;
}

function parsePnr(text) {
  const m = text.match(PNR_RE);
  return m ? m[0].toUpperCase() : null;
}

function parseMaxPrice(text) {
  const m = text.toLowerCase().match(/\b(?:under|below|less than|within|max(?:imum)?|upto|up to)\s*(?:rs\.?|inr|₹)?\s*(\d{2,6})\b/);
  return m ? Number(m[1]) : undefined;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extract source/destination using the list of cities the platform serves.
 * Honors "from X" / "to Y" cues; otherwise the first city mentioned is the source.
 */
function parseRoute(text, cities) {
  const t = text.toLowerCase();
  const found = [];
  for (const city of cities) {
    const re = new RegExp(`\\b${escapeRe(city.toLowerCase())}\\b`, 'g');
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(t))) found.push({ city, index: m.index });
  }
  found.sort((a, b) => a.index - b.index);
  const unique = found.filter((f, i) => found.findIndex((g) => g.city === f.city) === i);

  const cue = (word) =>
    unique.find((f) => {
      const before = t.slice(Math.max(0, f.index - word.length - 2), f.index);
      return new RegExp(`\\b${word}\\s+$`).test(before);
    });
  let source = cue('from')?.city;
  let destination = cue('to')?.city;
  const rest = unique.map((f) => f.city).filter((c) => c !== source && c !== destination);
  if (!source) source = rest.shift();
  if (!destination) destination = rest.shift();
  return { source, destination };
}

module.exports = { parseDate, parseMode, parsePnr, parseMaxPrice, parseRoute, PNR_RE };
