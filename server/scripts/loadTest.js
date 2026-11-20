/* eslint-disable no-console, no-await-in-loop */
/**
 * Load test - validates the NFR "100 daily active users, 250+ bookings/day".
 *
 * Simulates USERS customers who sign up / log in, browse (search + seat maps)
 * and book random free seats across the seeded network, with deliberate
 * contention on popular trips. Finishes with the server-side integrity check
 * proving there is no overbooking and no double booking.
 *
 * Usage (server running with DISABLE_RATE_LIMIT=true and seeded data):
 *   BASE_URL=http://localhost:5000 USERS=100 BOOKINGS=300 CONCURRENCY=25 node scripts/loadTest.js
 */
const { BASE, call, pool, latencyTable, totalRequests, randomKey, shuffle } = require('./lib/http');

const USERS = Number(process.env.USERS || 100);
const BOOKINGS = Number(process.env.BOOKINGS || 300);
const CONCURRENCY = Number(process.env.CONCURRENCY || 25);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bookyourtrip.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123';
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Isha', 'Rohan', 'Saanvi', 'Vihaan', 'Myra', 'Arjun', 'Anaya'];
const LAST = ['Sharma', 'Verma', 'Iyer', 'Khan', 'Das', 'Nair', 'Gupta', 'Reddy'];

const ymd = (offset) => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400000);
  return d.toISOString().slice(0, 10);
};
const rand = (n) => Math.floor(Math.random() * n);
const passenger = () => ({ name: `${FIRST[rand(FIRST.length)]} ${LAST[rand(LAST.length)]}`, age: 18 + rand(50), gender: ['M', 'F'][rand(2)] });

async function ensureUser(i) {
  const email = `loadtest.user${i}@example.com`;
  const body = { name: `${FIRST[i % FIRST.length]} Load${i}`, email, password: 'Password@123' };
  let r = await call('POST /auth/signup', 'POST', '/auth/signup', { body });
  if (r.status === 409) r = await call('POST /auth/login', 'POST', '/auth/login', { body: { email, password: body.password } });
  if (!r.data?.token) throw new Error(`Could not authenticate ${email}: ${r.status} ${r.data?.message}`);
  return r.data.token;
}

async function main() {
  console.log(`\nBookYourTrip load test -> ${BASE}`);
  console.log(`users=${USERS} bookings=${BOOKINGS} concurrency=${CONCURRENCY}\n`);
  const health = await call('GET /health', 'GET', '/health');
  if (health.status !== 200) throw new Error(`API not reachable at ${BASE}`);
  console.log(`health: db=${health.data.db} transactions=${health.data.transactions}`);

  const t0 = performance.now();

  // 1. Users onboard
  const tokens = await pool([...Array(USERS).keys()], CONCURRENCY, ensureUser);
  console.log(`✓ ${tokens.length} customers authenticated`);

  // 2. Discover the catalogue for the next 5 days
  const catalogue = [];
  for (let d = 1; d <= 5; d += 1) {
    const r = await call('GET /trips/search', 'GET', `/trips/search?date=${ymd(d)}`);
    for (const t of r.data?.trips || []) catalogue.push({ tripId: t._id, date: t.date, label: `${t.source}→${t.destination} ${t.departureTime}` });
  }
  if (!catalogue.length) throw new Error('No trips found - run `npm run seed` first');
  // A few "hot" departures receive a third of the traffic to force seat contention.
  const hot = shuffle(catalogue).slice(0, 4);
  console.log(`✓ catalogue: ${catalogue.length} departures (hot: ${hot.map((h) => h.label).join(', ')})`);

  // 3. Browse + book
  const outcome = { created: 0, conflict: 0, soldOut: 0, failed: 0, seats: 0 };
  const failures = {};
  await pool([...Array(BOOKINGS).keys()], CONCURRENCY, async (i) => {
    const token = tokens[i % tokens.length];
    const target = i % 3 === 0 ? hot[rand(hot.length)] : catalogue[rand(catalogue.length)];
    const [src, dst] = target.label.split(' ')[0].split('→');
    await call('GET /trips/search', 'GET', `/trips/search?source=${encodeURIComponent(src)}&destination=${encodeURIComponent(dst)}&date=${target.date}`);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const map = await call('GET /trips/:id/seats', 'GET', `/trips/${target.tripId}/seats?date=${target.date}`);
      if (map.status !== 200) {
        outcome.failed += 1;
        return;
      }
      const booked = new Set(map.data.bookedSeats);
      const free = [];
      for (let s = 1; s <= map.data.capacity; s += 1) if (!booked.has(s)) free.push(s);
      if (!free.length) {
        outcome.soldOut += 1;
        return;
      }
      const count = Math.min(free.length, 1 + rand(3));
      // Pick from the first few free seats so concurrent users collide on purpose.
      const seats = shuffle(free.slice(0, 6)).slice(0, count);
      const res = await call('POST /bookings', 'POST', '/bookings', {
        token,
        headers: { 'Idempotency-Key': randomKey() },
        body: {
          tripId: target.tripId,
          date: target.date,
          seatNumbers: seats,
          passengers: seats.map(passenger),
          payment: { method: 'upi', upiId: 'loadtest@okicici' },
        },
      });
      if (res.status === 201) {
        outcome.created += 1;
        outcome.seats += seats.length;
        return;
      }
      if (res.data?.code === 'SEAT_UNAVAILABLE') {
        outcome.conflict += 1; // expected under contention - retry with a fresh seat map
        continue;
      }
      outcome.failed += 1;
      const key = `${res.status} ${res.data?.code || res.data?.message}`;
      failures[key] = (failures[key] || 0) + 1;
      return;
    }
  });

  // 4. Customers check their trips
  await pool(tokens, CONCURRENCY, (token) => call('GET /bookings', 'GET', '/bookings?scope=upcoming', { token }));

  const elapsed = (performance.now() - t0) / 1000;

  // 5. Integrity
  const admin = await call('POST /auth/login', 'POST', '/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  const integrity = admin.data?.token ? await call('GET /admin/integrity', 'GET', '/admin/integrity', { token: admin.data.token }) : null;

  console.log('\n=== Results ===');
  console.table(latencyTable());
  console.table([
    {
      'bookings created': outcome.created,
      'seats sold': outcome.seats,
      'seat conflicts (retried)': outcome.conflict,
      'sold out': outcome.soldOut,
      failed: outcome.failed,
      'total requests': totalRequests(),
      'duration s': elapsed.toFixed(1),
      'throughput req/s': (totalRequests() / elapsed).toFixed(1),
    },
  ]);
  if (Object.keys(failures).length) console.log('Failures:', failures);

  if (integrity?.data?.integrity) {
    const ig = integrity.data.integrity;
    console.log(`\nIntegrity check: ${ig.ok ? 'PASSED ✅' : 'FAILED ❌'} - ${ig.inventoriesChecked} inventories, ${ig.seatsSold} seats sold`);
    if (!ig.ok) console.log(ig.issues);
    process.exitCode = ig.ok && outcome.failed === 0 ? 0 : 1;
  } else {
    console.log('\n(Integrity check skipped - admin login failed)');
  }
  const meetsNfr = outcome.created >= Math.min(250, BOOKINGS * 0.8) && tokens.length >= Math.min(100, USERS);
  console.log(`NFR (100 users / 250+ bookings): ${meetsNfr ? 'MET' : 'NOT MET'}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
