const { z } = require('zod');
const config = require('../config');
const { isValidDateStr } = require('../utils/dates');

const MODES = ['bus', 'train', 'flight'];
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const dateStr = z.string().refine(isValidDateStr, 'Date must be in YYYY-MM-DD format');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm (24h)');
const phone = z.string().regex(/^[0-9]{10}$/, 'Phone must be 10 digits');
const city = z.string().trim().min(2, 'City name is too short').max(50);
const maxSeats = config.business.maxSeatsPerBooking;

const idParam = z.object({ id: objectId });

// ---------- auth & profile ----------
const signup = z
  .object({
    name: z.string().trim().min(2, 'Name is too short').max(60),
    email: z.string().trim().toLowerCase().email('Invalid email'),
    password: z.string().min(6, 'Password must be at least 6 characters').max(100),
    phone: phone.optional(),
    role: z.enum(['customer', 'provider']).default('customer'),
    companyName: z.string().trim().min(2).max(80).optional(),
    servicesOffered: z.array(z.enum(MODES)).min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'provider') {
      if (!v.companyName) ctx.addIssue({ code: 'custom', path: ['companyName'], message: 'Company name is required' });
      if (!v.servicesOffered?.length) {
        ctx.addIssue({ code: 'custom', path: ['servicesOffered'], message: 'Select at least one service' });
      }
    }
  });

const login = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
});

const updateProfile = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    phone: phone.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6, 'Password must be at least 6 characters').max(100),
});

const updateProvider = z
  .object({
    companyName: z.string().trim().min(2).max(80).optional(),
    servicesOffered: z.array(z.enum(MODES)).min(1).optional(),
    contactEmail: z.string().trim().toLowerCase().email().optional(),
    contactPhone: phone.optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

// ---------- trips ----------
const tripBase = {
  mode: z.enum(MODES),
  serviceName: z.string().trim().max(60).optional(),
  source: city,
  destination: city,
  departureTime: timeStr,
  arrivalTime: timeStr,
  basePrice: z.coerce.number().min(1).max(100000),
  totalSeats: z.coerce.number().int().min(1).max(300),
  operatingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  amenities: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
};

const createTrip = z
  .object(tripBase)
  .refine((v) => v.source.toLowerCase() !== v.destination.toLowerCase(), {
    message: 'Source and destination must differ',
    path: ['destination'],
  });

const updateTrip = z
  .object(tripBase)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => !v.source || !v.destination || v.source.toLowerCase() !== v.destination.toLowerCase(), {
    message: 'Source and destination must differ',
    path: ['destination'],
  });

const SORTS = ['price_asc', 'price_desc', 'departure', 'arrival', 'duration', 'seats'];
const searchTrips = z.object({
  source: z.string().trim().max(50).optional(),
  destination: z.string().trim().max(50).optional(),
  date: dateStr.optional(),
  mode: z.enum(MODES).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  departAfter: timeStr.optional(),
  departBefore: timeStr.optional(),
  seats: z.coerce.number().int().min(1).max(maxSeats).default(1),
  sort: z.enum(SORTS).default('departure'),
});

const dateQuery = z.object({ date: dateStr });

// ---------- bookings ----------
const passenger = z.object({
  name: z.string().trim().min(2, 'Passenger name is too short').max(60),
  age: z.coerce.number().int().min(0).max(120),
  gender: z.enum(['M', 'F', 'O']),
});

const payment = z.object({
  method: z.enum(['card', 'upi', 'netbanking', 'wallet']),
  cardNumber: z
    .string()
    .regex(/^\d{12,19}$/, 'Card number must be 12-19 digits')
    .optional(),
  upiId: z
    .string()
    .regex(/^[\w.-]{2,}@[a-z]{2,}$/i, 'Invalid UPI id')
    .optional(),
});

const createBooking = z
  .object({
    tripId: objectId,
    date: dateStr,
    seatNumbers: z.array(z.number().int().min(1)).min(1).max(maxSeats),
    passengers: z.array(passenger).min(1).max(maxSeats),
    payment,
    quotedPerSeat: z.number().positive().optional(),
  })
  .refine((v) => v.seatNumbers.length === v.passengers.length, {
    message: 'One passenger is required per seat',
    path: ['passengers'],
  })
  .refine((v) => new Set(v.seatNumbers).size === v.seatNumbers.length, {
    message: 'Duplicate seat numbers',
    path: ['seatNumbers'],
  });

const listBookings = z.object({
  scope: z.enum(['upcoming', 'past', 'cancelled', 'all']).default('all'),
});

const reschedule = z.object({
  newDate: dateStr,
  payment: payment.optional(),
});

const cancel = z.object({ reason: z.string().trim().max(300).optional() });

const updatePassengers = z.object({ passengers: z.array(passenger).min(1).max(maxSeats) });

const statsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });

const adminProviderQuery = z.object({
  status: z.enum(['pending', 'active', 'suspended', 'discontinued']).optional(),
});
const adminReason = z.object({ reason: z.string().trim().max(300).optional() });

module.exports = {
  objectId,
  idParam,
  signup,
  login,
  updateProfile,
  changePassword,
  updateProvider,
  createTrip,
  updateTrip,
  searchTrips,
  dateQuery,
  createBooking,
  listBookings,
  reschedule,
  cancel,
  updatePassengers,
  statsQuery,
  adminProviderQuery,
  adminReason,
};
