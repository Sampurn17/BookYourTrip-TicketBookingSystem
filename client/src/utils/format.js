export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

export const duration = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};

const pad = (n) => String(n).padStart(2, '0');

/** Today's date in IST as YYYY-MM-DD (matches the server's business timezone). */
export function todayIST() {
  const d = new Date(Date.now() + 330 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function prettyDate(dateStr, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', ...opts });
}

export function relativeDay(dateStr) {
  const today = todayIST();
  if (dateStr === today) return 'Today';
  if (dateStr === addDays(today, 1)) return 'Tomorrow';
  return prettyDate(dateStr, { weekday: 'short' });
}

export const isOvernight = (dep, arr) => arr <= dep;

export const MODE_LABEL = { bus: 'Bus', train: 'Train', flight: 'Flight' };
export const GENDER_LABEL = { M: 'Male', F: 'Female', O: 'Other' };
