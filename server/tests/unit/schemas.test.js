const s = require('../../src/validators/schemas');
const { validate } = require('../../src/middleware/validate');

const id = 'a'.repeat(24);
const passenger = { name: 'Asha', age: 30, gender: 'F' };

describe('request schemas', () => {
  test('signup requires company details for providers only', () => {
    expect(s.signup.safeParse({ name: 'Asha', email: 'A@X.COM', password: 'secret1' }).data).toMatchObject({ email: 'a@x.com', role: 'customer' });
    const bad = s.signup.safeParse({ name: 'Op', email: 'o@x.com', password: 'secret1', role: 'provider' });
    expect(bad.success).toBe(false);
    expect(bad.error.issues.map((i) => i.path[0])).toEqual(['companyName', 'servicesOffered']);
    expect(s.signup.safeParse({ name: 'Op', email: 'o@x.com', password: 'secret1', role: 'provider', companyName: 'Zing', servicesOffered: ['bus'] }).success).toBe(true);
    expect(s.signup.safeParse({ name: 'Op', email: 'o@x.com', password: 'secret1', role: 'admin' }).success).toBe(false);
  });

  test('createBooking enforces one passenger per seat and unique seats', () => {
    const base = { tripId: id, date: '2030-01-10', seatNumbers: [1, 2], passengers: [passenger, passenger], payment: { method: 'upi', upiId: 'a@okaxis' } };
    expect(s.createBooking.safeParse(base).success).toBe(true);
    expect(s.createBooking.safeParse({ ...base, passengers: [passenger] }).success).toBe(false);
    expect(s.createBooking.safeParse({ ...base, seatNumbers: [3, 3] }).success).toBe(false);
    expect(s.createBooking.safeParse({ ...base, date: '2030-02-31' }).success).toBe(false);
    expect(s.createBooking.safeParse({ ...base, tripId: 'nope' }).success).toBe(false);
    expect(s.createBooking.safeParse({ ...base, seatNumbers: [1, 2, 3, 4, 5, 6, 7], passengers: Array(7).fill(passenger) }).success).toBe(false);
  });

  test('createTrip rejects identical source/destination and bad times', () => {
    const trip = { mode: 'bus', source: 'Delhi', destination: 'Jaipur', departureTime: '06:00', arrivalTime: '11:00', basePrice: '500', totalSeats: 40 };
    expect(s.createTrip.safeParse(trip).data.basePrice).toBe(500);
    expect(s.createTrip.safeParse({ ...trip, destination: 'delhi' }).success).toBe(false);
    expect(s.createTrip.safeParse({ ...trip, departureTime: '6am' }).success).toBe(false);
    expect(s.updateTrip.safeParse({}).success).toBe(false);
    expect(s.updateTrip.safeParse({ basePrice: 600 }).success).toBe(true);
  });

  test('searchTrips coerces query strings and applies defaults', () => {
    const r = s.searchTrips.parse({ minPrice: '100', seats: '2' });
    expect(r).toMatchObject({ minPrice: 100, seats: 2, sort: 'departure' });
    expect(s.searchTrips.safeParse({ sort: 'random' }).success).toBe(false);
  });
});

describe('validate middleware', () => {
  test('stores parsed values on req.validated', () => {
    const req = { body: { email: 'X@Y.COM', password: 'p' } };
    let called = false;
    validate({ body: s.login })(req, {}, () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(req.validated.body.email).toBe('x@y.com');
  });

  test('throws a 422 AppError with field details', () => {
    expect(() => validate({ body: s.login })({ body: { email: 'bad' } }, {}, () => {})).toThrow('Invalid email');
    try {
      validate({ params: s.idParam })({ params: { id: '1' } }, {}, () => {});
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 422, code: 'VALIDATION_ERROR' });
      expect(err.details[0].path).toBe('id');
    }
  });
});
