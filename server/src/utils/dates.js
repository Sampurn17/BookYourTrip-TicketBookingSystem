/**
 * Date helpers. Travel dates are stored as plain 'YYYY-MM-DD' strings so that
 * a booking never "moves" a day because the server runs in UTC and the user
 * in IST. Clock times are interpreted in the configured business offset.
 */
const config = require('../config');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

function offsetMinutes(offset = config.business.tzOffset) {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

function isValidDateStr(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isValidTimeStr(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

/** Today's calendar date in the business timezone. */
function todayStr(now = new Date()) {
  return new Date(now.getTime() + offsetMinutes() * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(fromStr, toStr) {
  return Math.round((new Date(`${toStr}T00:00:00Z`) - new Date(`${fromStr}T00:00:00Z`)) / MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday */
function dayOfWeek(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Absolute instant of departure for a trip running on `dateStr` at `timeStr`. */
function departureDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00${config.business.tzOffset}`);
}

function hoursUntil(instant, now = new Date()) {
  return (instant.getTime() - now.getTime()) / MS_PER_HOUR;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/** Duration in minutes; an arrival earlier than departure means the next day. */
function durationMinutes(departureTime, arrivalTime) {
  const diff = timeToMinutes(arrivalTime) - timeToMinutes(departureTime);
  return diff > 0 ? diff : diff + 24 * 60;
}

module.exports = {
  isValidDateStr,
  isValidTimeStr,
  todayStr,
  addDays,
  diffDays,
  dayOfWeek,
  departureDateTime,
  hoursUntil,
  timeToMinutes,
  durationMinutes,
  offsetMinutes,
};
