const tripService = require('../services/tripService');
const providerService = require('../services/providerService');
const authService = require('../services/authService');
const { todayStr, isValidDateStr } = require('../utils/dates');

exports.getProfile = async (req, res) => {
  res.json({ status: 'success', user: authService.serializeUser(req.user, req.provider) });
};

exports.updateProfile = async (req, res) => {
  const provider = await providerService.updateProfile(req.provider, req.validated.body);
  res.json({ status: 'success', user: authService.serializeUser(req.user, provider) });
};

exports.listTrips = async (req, res) => {
  const date = isValidDateStr(req.query.date) ? req.query.date : todayStr();
  const trips = await tripService.listProviderTrips(req.provider._id, date);
  res.json({ status: 'success', date, count: trips.length, trips });
};

exports.createTrip = async (req, res) => {
  const trip = await tripService.createTrip(req.provider, req.validated.body);
  res.status(201).json({ status: 'success', trip });
};

exports.updateTrip = async (req, res) => {
  const trip = await tripService.updateTrip(req.provider, req.validated.params.id, req.validated.body);
  res.json({ status: 'success', trip });
};

exports.cancelTrip = async (req, res) => {
  const result = await tripService.cancelTrip(req.provider, req.validated.params.id, { actor: 'provider' });
  res.json({ status: 'success', ...result });
};

exports.manifest = async (req, res) => {
  const manifest = await providerService.tripManifest(req.provider, req.validated.params.id, req.validated.query.date);
  res.json({ status: 'success', manifest });
};

exports.stats = async (req, res) => {
  const stats = await providerService.dashboardStats(req.provider, req.validated.query.days);
  res.json({ status: 'success', stats });
};

exports.performance = async (req, res) => {
  const trips = await providerService.tripPerformance(req.provider);
  res.json({ status: 'success', trips });
};
