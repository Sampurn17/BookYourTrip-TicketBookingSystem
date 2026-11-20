/* eslint-disable no-console */
/**
 * Seeds demo data: admin, customers, providers (one pending), ~30 recurring
 * trips across Indian cities and a set of realistic bookings made through the
 * real booking service (so inventory, payments and history are consistent).
 *
 *   node scripts/seed.js --reset
 */
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../src/config/db');
const { User, Provider, Trip, DailyAvailability, Booking, Payment } = require('../src/models');
const bookingService = require('../src/services/bookingService');
const { todayStr, addDays, dayOfWeek } = require('../src/utils/dates');

const PASSWORD = 'Password@123';
const SEATS = { bus: 40, train: 72, flight: 60 };

const PROVIDERS = [
  { key: 'zing', name: 'Ravi Mehta', email: 'zing@bookyourtrip.com', companyName: 'Zing Travels', services: ['bus'], status: 'active', rating: 4.3 },
  { key: 'indrail', name: 'Sunita Rao', email: 'indrail@bookyourtrip.com', companyName: 'IndRail Express', services: ['train'], status: 'active', rating: 4.5 },
  { key: 'skyhop', name: 'Karan Malhotra', email: 'skyhop@bookyourtrip.com', companyName: 'SkyHop Airlines', services: ['flight'], status: 'active', rating: 4.1 },
  { key: 'royal', name: 'Meera Iyer', email: 'royal@bookyourtrip.com', companyName: 'Royal Coach Lines', services: ['bus', 'train'], status: 'active', rating: 4.6 },
  { key: 'nimbus', name: 'Arjun Shah', email: 'nimbus@bookyourtrip.com', companyName: 'Nimbus Air', services: ['flight'], status: 'pending', rating: 0 },
];

// [provider, mode, source, destination, departure, arrival, basePrice, amenities]
const TRIPS = [
  ['zing', 'bus', 'Delhi', 'Jaipur', '06:00', '11:30', 650, ['AC', 'Charging point']],
  ['zing', 'bus', 'Delhi', 'Jaipur', '22:30', '04:15', 780, ['AC', 'Sleeper', 'Blanket']],
  ['zing', 'bus', 'Jaipur', 'Delhi', '07:15', '12:45', 650, ['AC']],
  ['zing', 'bus', 'Delhi', 'Agra', '07:00', '11:00', 450, ['AC', 'Water bottle']],
  ['zing', 'bus', 'Kanpur', 'Lucknow', '08:00', '10:00', 220, ['Non-AC']],
  ['zing', 'bus', 'Mumbai', 'Pune', '09:00', '12:30', 400, ['AC', 'WiFi']],
  ['zing', 'bus', 'Bengaluru', 'Chennai', '21:00', '04:30', 900, ['AC', 'Sleeper']],
  ['royal', 'bus', 'Mumbai', 'Goa', '19:00', '07:00', 1400, ['AC', 'Sleeper', 'Snacks']],
  ['royal', 'bus', 'Bengaluru', 'Hyderabad', '22:00', '06:30', 1100, ['AC', 'Sleeper']],
  ['royal', 'bus', 'Kanpur', 'Delhi', '21:30', '05:30', 850, ['AC', 'Sleeper']],
  ['royal', 'train', 'Pune', 'Mumbai', '06:30', '09:45', 310, ['Pantry']],
  ['indrail', 'train', 'Delhi', 'Lucknow', '06:10', '12:40', 1150, ['Pantry', 'AC Chair car']],
  ['indrail', 'train', 'Lucknow', 'Delhi', '15:30', '22:00', 1150, ['Pantry', 'AC Chair car']],
  ['indrail', 'train', 'Kanpur', 'Delhi', '06:00', '11:00', 890, ['Pantry']],
  ['indrail', 'train', 'Delhi', 'Kanpur', '16:00', '21:05', 890, ['Pantry']],
  ['indrail', 'train', 'Delhi', 'Mumbai', '16:55', '08:35', 2450, ['Pantry', '2AC Sleeper']],
  ['indrail', 'train', 'Mumbai', 'Delhi', '17:00', '08:40', 2450, ['Pantry', '2AC Sleeper']],
  ['indrail', 'train', 'Bengaluru', 'Chennai', '06:00', '11:00', 720, ['AC Chair car']],
  ['indrail', 'train', 'Ahmedabad', 'Mumbai', '14:40', '21:00', 980, ['Pantry']],
  ['indrail', 'train', 'Delhi', 'Agra', '08:10', '09:50', 560, ['AC Chair car']],
  ['skyhop', 'flight', 'Delhi', 'Mumbai', '07:00', '09:10', 4800, ['Meal', '15kg baggage']],
  ['skyhop', 'flight', 'Mumbai', 'Delhi', '19:30', '21:40', 4900, ['Meal', '15kg baggage']],
  ['skyhop', 'flight', 'Delhi', 'Bengaluru', '06:15', '09:00', 5600, ['15kg baggage']],
  ['skyhop', 'flight', 'Bengaluru', 'Delhi', '20:00', '22:50', 5700, ['15kg baggage']],
  ['skyhop', 'flight', 'Mumbai', 'Goa', '11:00', '12:15', 3200, ['15kg baggage']],
  ['skyhop', 'flight', 'Bengaluru', 'Hyderabad', '08:30', '09:40', 2900, ['15kg baggage']],
  ['skyhop', 'flight', 'Kolkata', 'Delhi', '09:45', '12:05', 5200, ['Meal']],
  ['skyhop', 'flight', 'Delhi', 'Kolkata', '15:00', '17:20', 5100, ['Meal']],
  ['skyhop', 'flight', 'Delhi', 'Lucknow', '10:00', '11:10', 3100, ['15kg baggage']],
  ['skyhop', 'flight', 'Chennai', 'Bengaluru', '18:00', '19:00', 2600, ['15kg baggage']],
];

const NAMES = ['Aarav', 'Diya', 'Vihaan', 'Ananya', 'Kabir', 'Isha', 'Rohan', 'Saanvi', 'Arjun', 'Myra', 'Aditya', 'Kiara'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function seed() {
  const { transactions } = await connectDB();
  console.log(`Connected (transactions ${transactions ? 'on' : 'off'})`);

  if (process.argv.includes('--reset')) {
    await Promise.all([User, Provider, Trip, DailyAvailability, Booking, Payment].map((m) => m.deleteMany({})));
    console.log('Cleared existing data');
  }

  await User.create({ name: 'Platform Admin', email: 'admin@bookyourtrip.com', password: 'Admin@123', role: 'admin' });
  const customers = await Promise.all([
    User.create({ name: 'Aarav Sharma', email: 'aarav@example.com', password: PASSWORD, role: 'customer', phone: '9876543210' }),
    User.create({ name: 'Diya Verma', email: 'diya@example.com', password: PASSWORD, role: 'customer', phone: '9876501234' }),
  ]);

  const providers = {};
  for (const p of PROVIDERS) {
    // eslint-disable-next-line no-await-in-loop
    const user = await User.create({ name: p.name, email: p.email, password: PASSWORD, role: 'provider', phone: '9000000000' });
    // eslint-disable-next-line no-await-in-loop
    providers[p.key] = await Provider.create({
      userId: user._id,
      companyName: p.companyName,
      servicesOffered: p.services,
      contactEmail: p.email,
      status: p.status,
      rating: p.rating,
      approvedAt: p.status === 'active' ? new Date() : undefined,
      description: `${p.companyName} - trusted ${p.services.join(' & ')} operator.`,
    });
  }

  const trips = await Trip.create(
    TRIPS.map(([prov, mode, source, destination, departureTime, arrivalTime, basePrice, amenities], i) => ({
        providerId: providers[prov]._id,
        mode,
        serviceName: `${mode.toUpperCase().slice(0, 2)}-${101 + i}`,
        source,
        destination,
        departureTime,
        arrivalTime,
        basePrice,
        totalSeats: SEATS[mode],
        amenities,
    })),
  );
  console.log(`Created ${trips.length} trips`);

  // Realistic bookings through the real service (exercise pricing, inventory and payments).
  const today = todayStr();
  let made = 0;
  for (let i = 0; i < 60; i += 1) {
    const trip = pick(trips);
    const date = addDays(today, 1 + Math.floor(Math.random() * 10));
    if (!trip.operatingDays.includes(dayOfWeek(date))) continue;
    const count = 1 + Math.floor(Math.random() * 3);
    const start = 1 + Math.floor(Math.random() * (trip.totalSeats - count));
    const seatNumbers = Array.from({ length: count }, (_, k) => start + k);
    try {
      // eslint-disable-next-line no-await-in-loop
      await bookingService.createBooking(pick(customers), {
        tripId: trip._id,
        date,
        seatNumbers,
        passengers: seatNumbers.map(() => ({ name: `${pick(NAMES)} ${pick(['Sharma', 'Gupta', 'Nair', 'Khan', 'Das'])}`, age: 18 + Math.floor(Math.random() * 50), gender: pick(['M', 'F']) })),
        payment: { method: 'upi', upiId: 'demo@okaxis' },
      });
      made += 1;
    } catch (err) {
      if (err.code !== 'SEAT_UNAVAILABLE') throw err;
    }
  }
  console.log(`Created ${made} bookings`);

  console.log('\nDemo accounts (password Password@123 unless noted):');
  console.log('  admin     admin@bookyourtrip.com / Admin@123');
  console.log('  customer  aarav@example.com, diya@example.com');
  console.log('  provider  zing@, indrail@, skyhop@, royal@bookyourtrip.com  (nimbus@ is pending approval)');
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await disconnectDB();
  });
