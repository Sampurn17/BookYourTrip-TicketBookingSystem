const { User, Provider, Trip } = require('../../src/models');
const { signToken } = require('../../src/middleware/auth');
const { todayStr, addDays } = require('../../src/utils/dates');

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function createUser(overrides = {}) {
  const user = await User.create({
    name: 'Test User',
    email: `user_${uniq()}@test.com`,
    password: 'Password@123',
    role: 'customer',
    ...overrides,
  });
  return { user, token: signToken(user._id) };
}

const createCustomer = (o) => createUser({ role: 'customer', ...o });
const createAdmin = (o) => createUser({ role: 'admin', name: 'Admin', ...o });

async function createProvider({ status = 'active', servicesOffered = ['bus', 'train', 'flight'], ...rest } = {}) {
  const { user, token } = await createUser({ role: 'provider', name: 'Operator' });
  const provider = await Provider.create({
    userId: user._id,
    companyName: `Operator ${uniq()}`,
    servicesOffered,
    status,
    ...rest,
  });
  return { user, token, provider };
}

async function createTrip(provider, overrides = {}) {
  return Trip.create({
    providerId: provider._id,
    mode: 'bus',
    source: 'Delhi',
    destination: 'Jaipur',
    departureTime: '22:00',
    arrivalTime: '04:00',
    basePrice: 500,
    totalSeats: 10,
    ...overrides,
  });
}

/** A date `days` ahead in the business timezone. */
const dateIn = (days = 5) => addDays(todayStr(), days);

const passengers = (n) => Array.from({ length: n }, (_, i) => ({ name: `Passenger ${i + 1}`, age: 25 + i, gender: i % 2 ? 'F' : 'M' }));

const upi = { method: 'upi', upiId: 'tester@okaxis' };

function bookingBody(trip, date, seatNumbers, extra = {}) {
  return { tripId: String(trip._id), date, seatNumbers, passengers: passengers(seatNumbers.length), payment: upi, ...extra };
}

module.exports = { createUser, createCustomer, createAdmin, createProvider, createTrip, dateIn, passengers, upi, bookingBody };
