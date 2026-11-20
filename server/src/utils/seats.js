/** Pure seat helpers (no DB access) so they are trivially unit-testable. */

function hasDuplicates(list) {
  return new Set(list).size !== list.length;
}

function seatsInRange(seats, capacity) {
  return seats.every((s) => Number.isInteger(s) && s >= 1 && s <= capacity);
}

/**
 * Choose `count` free seats. Keeps the `preferred` seats when they are all
 * free (used when rescheduling so passengers keep their seat numbers),
 * otherwise falls back to the lowest-numbered free seats.
 * @returns {number[]|null} null when there are not enough free seats
 */
function pickSeats(capacity, bookedSeats, count, preferred = []) {
  const booked = new Set(bookedSeats);
  if (
    preferred.length === count &&
    !hasDuplicates(preferred) &&
    seatsInRange(preferred, capacity) &&
    preferred.every((s) => !booked.has(s))
  ) {
    return [...preferred];
  }
  const out = [];
  for (let s = 1; s <= capacity && out.length < count; s += 1) {
    if (!booked.has(s)) out.push(s);
  }
  return out.length === count ? out : null;
}

module.exports = { hasDuplicates, seatsInRange, pickSeats };
