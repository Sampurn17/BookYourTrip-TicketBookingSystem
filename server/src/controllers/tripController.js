const tripService = require('../services/tripService');
const policy = require('../services/policyService');

exports.search = async (req, res) => {
  const result = await tripService.searchTrips(req.validated.query);
  res.json({ status: 'success', ...result });
};

exports.cities = async (_req, res) => {
  res.json({ status: 'success', cities: await tripService.listCities() });
};

exports.policies = async (_req, res) => {
  res.json({ status: 'success', policies: policy.describePolicies() });
};

exports.getTrip = async (req, res) => {
  const trip = await tripService.getTripOrThrow(req.validated.params.id);
  res.json({ status: 'success', trip });
};

exports.seatMap = async (req, res) => {
  const result = await tripService.getSeatMap(req.validated.params.id, req.validated.query.date);
  res.json({ status: 'success', ...result });
};
