/* Tiny zero-dependency HTTP + stats helpers for the load / race scripts (Node 18+ fetch). */
const BASE = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');

const samples = new Map(); // label -> number[]

async function call(label, method, path, { token, body, headers = {} } = {}) {
  const started = performance.now();
  let status = 0;
  let data = null;
  try {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch (err) {
    data = { message: err.message };
  }
  const ms = performance.now() - started;
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push(ms);
  return { status, data, ms };
}

/** Run async tasks with bounded concurrency. */
async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      // eslint-disable-next-line no-await-in-loop
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

function latencyTable() {
  const rows = [];
  for (const [label, arr] of samples) {
    const s = [...arr].sort((a, b) => a - b);
    rows.push({
      endpoint: label,
      requests: s.length,
      'p50 ms': Math.round(pct(s, 50)),
      'p95 ms': Math.round(pct(s, 95)),
      'p99 ms': Math.round(pct(s, 99)),
      'max ms': Math.round(s[s.length - 1] || 0),
    });
  }
  return rows;
}

const totalRequests = () => [...samples.values()].reduce((n, a) => n + a.length, 0);
const randomKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const shuffle = (arr) => arr.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

module.exports = { BASE, call, pool, latencyTable, totalRequests, randomKey, shuffle };
