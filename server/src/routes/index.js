const express = require('express');
const s = require('../validators/schemas');
const { validate } = require('../middleware/validate');
const { authenticate, optionalAuth, authorize, loadProvider } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const auth = require('../controllers/authController');
const trips = require('../controllers/tripController');
const bookings = require('../controllers/bookingController');
const provider = require('../controllers/providerController');
const admin = require('../controllers/adminController');

const router = express.Router();
const idParams = { params: s.idParam };

// ---------- auth & profile ----------
router.post('/auth/signup', authLimiter, validate({ body: s.signup }), auth.signup);
router.post('/auth/login', authLimiter, validate({ body: s.login }), auth.login);
router.get('/auth/me', authenticate, auth.me);
router.patch('/users/me', authenticate, validate({ body: s.updateProfile }), auth.updateMe);
router.patch('/users/me/password', authenticate, validate({ body: s.changePassword }), auth.changePassword);

// ---------- public catalogue ----------
router.get('/trips/search', validate({ query: s.searchTrips }), trips.search);
router.get('/trips/cities', trips.cities);
router.get('/policies', trips.policies);
router.get('/trips/:id', validate(idParams), trips.getTrip);
router.get('/trips/:id/seats', validate({ params: s.idParam, query: s.dateQuery }), trips.seatMap);

// ---------- customer bookings ----------
const customer = [authenticate, authorize('customer')];
router.post('/bookings', ...customer, validate({ body: s.createBooking }), bookings.create);
router.get('/bookings', ...customer, validate({ query: s.listBookings }), bookings.list);
router.get('/bookings/:id', ...customer, validate(idParams), bookings.get);
router.get('/bookings/:id/cancel-quote', ...customer, validate(idParams), bookings.cancelQuote);
router.post('/bookings/:id/cancel', ...customer, validate({ params: s.idParam, body: s.cancel }), bookings.cancel);
router.post('/bookings/:id/reschedule-quote', ...customer, validate({ params: s.idParam, body: s.reschedule }), bookings.rescheduleQuote);
router.post('/bookings/:id/reschedule', ...customer, validate({ params: s.idParam, body: s.reschedule }), bookings.reschedule);
router.patch('/bookings/:id/passengers', ...customer, validate({ params: s.idParam, body: s.updatePassengers }), bookings.updatePassengers);

// ---------- provider console ----------
const anyProvider = [authenticate, authorize('provider'), loadProvider({ requireActive: false })];
const activeProvider = [authenticate, authorize('provider'), loadProvider({ requireActive: true })];
router.get('/provider/me', ...anyProvider, provider.getProfile);
router.patch('/provider/me', ...anyProvider, validate({ body: s.updateProvider }), provider.updateProfile);
router.get('/provider/trips', ...activeProvider, provider.listTrips);
router.post('/provider/trips', ...activeProvider, validate({ body: s.createTrip }), provider.createTrip);
router.patch('/provider/trips/:id', ...activeProvider, validate({ params: s.idParam, body: s.updateTrip }), provider.updateTrip);
router.delete('/provider/trips/:id', ...activeProvider, validate(idParams), provider.cancelTrip);
router.get('/provider/trips/:id/manifest', ...activeProvider, validate({ params: s.idParam, query: s.dateQuery }), provider.manifest);
router.get('/provider/stats', ...activeProvider, validate({ query: s.statsQuery }), provider.stats);
router.get('/provider/performance', ...activeProvider, provider.performance);

// ---------- admin ----------
const adminOnly = [authenticate, authorize('admin')];
router.get('/admin/providers', ...adminOnly, validate({ query: s.adminProviderQuery }), admin.listProviders);
router.patch('/admin/providers/:id/approve', ...adminOnly, validate({ params: s.idParam, body: s.adminReason }), admin.approve);
router.patch('/admin/providers/:id/suspend', ...adminOnly, validate({ params: s.idParam, body: s.adminReason }), admin.suspend);
router.patch('/admin/providers/:id/reactivate', ...adminOnly, validate({ params: s.idParam, body: s.adminReason }), admin.reactivate);
router.patch('/admin/providers/:id/discontinue', ...adminOnly, validate({ params: s.idParam, body: s.adminReason }), admin.discontinue);
router.get('/admin/stats', ...adminOnly, admin.stats);
router.get('/admin/integrity', ...adminOnly, admin.integrity);

module.exports = router;
