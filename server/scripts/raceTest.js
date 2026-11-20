/* eslint-disable no-console */
/**
 * Race test - fires N simultaneous requests for THE SAME SEAT from N different
 * customers, then N duplicate submissions of one checkout (same Idempotency-Key).
 * Expected: exactly one winner, everybody else gets 409 SEAT_UNAVAILABLE, and
 * the duplicate submissions produce a single booking.
 *
 *   BASE_URL=http://localhost:5000 RACERS=50 node scripts/raceTest.js
 */
const { BASE, call, pool, randomKey } = require('./lib/http');

const RACERS = Number(process.env.RACERS || 50);
const ymd = (offset) => new Date(Date.now() + 5.5 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);

async function login(i) {
  const email = `race.user${i}@example.com`;
  let r = await call('signup', 'POST', '/auth/signup', { body: { name: `Racer ${i}`, email, password: 'Password@123' } });
  if (r.status === 409) r = await call('login', 'POST', '/auth/login', { body: { email, password: 'Password@123' } });
  return r.data.token;
}

async function main() {
  console.log(`Race test against ${BASE} with ${RACERS} concurrent customers`);
  const tokens = await pool([...Array(RACERS).keys()], 20, login);

  const date = ymd(7);
  const search = await call('search', 'GET', `/trips/search?date=${date}`);
  const trip = (search.data.trips || []).find((t) => t.availableSeats > 5);
  if (!trip) throw new Error('No trip with free seats found - run `npm run seed` first');
  const map = await call('seats', 'GET', `/trips/${trip._id}/seats?date=${date}`);
  const booked = new Set(map.data.bookedSeats);
  let seat = 1;
  while (booked.has(seat)) seat += 1;
  console.log(`Target: ${trip.source} → ${trip.destination} ${trip.departureTime} on ${date}, seat ${seat}`);

  // --- Phase 1: N customers, same seat, same instant ---
  const results = await Promise.all(
    tokens.map((token, i) =>
      call('race', 'POST', '/bookings', {
        token,
        body: {
          tripId: trip._id,
          date,
          seatNumbers: [seat],
          passengers: [{ name: `Racer ${i}`, age: 30, gender: 'M' }],
          payment: { method: 'upi', upiId: 'race@okhdfc' },
        },
      }),
    ),
  );
  const winners = results.filter((r) => r.status === 201).length;
  const conflicts = results.filter((r) => r.data?.code === 'SEAT_UNAVAILABLE').length;
  const other = results.length - winners - conflicts;
  console.log(`\nPhase 1 - same seat: ${winners} success, ${conflicts} rejected with SEAT_UNAVAILABLE, ${other} other`);

  // --- Phase 2: one customer double/triple-clicks "Pay" ---
  let seat2 = seat + 1;
  while (booked.has(seat2)) seat2 += 1;
  const key = randomKey();
  const dupes = await Promise.all(
    Array.from({ length: 10 }, () =>
      call('dupe', 'POST', '/bookings', {
        token: tokens[0],
        headers: { 'Idempotency-Key': key },
        body: {
          tripId: trip._id,
          date,
          seatNumbers: [seat2],
          passengers: [{ name: 'Double Clicker', age: 28, gender: 'F' }],
          payment: { method: 'upi', upiId: 'race@okhdfc' },
        },
      }),
    ),
  );
  const pnrs = new Set(dupes.filter((r) => r.data?.booking).map((r) => r.data.booking.pnr));
  console.log(`Phase 2 - 10 duplicate submissions: ${pnrs.size} unique booking(s) [${[...pnrs].join(', ')}]`);

  const pass = winners === 1 && other === 0 && pnrs.size === 1;
  console.log(`\nResult: ${pass ? 'PASSED ✅ no double booking' : 'FAILED ❌'}`);
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
