const authService = require('../services/authService');

exports.signup = async (req, res) => {
  const result = await authService.signup(req.validated.body);
  res.status(201).json({ status: 'success', ...result });
};

exports.login = async (req, res) => {
  const result = await authService.login(req.validated.body);
  res.json({ status: 'success', ...result });
};

exports.me = async (req, res) => {
  res.json({ status: 'success', user: await authService.profileFor(req.user) });
};

exports.updateMe = async (req, res) => {
  res.json({ status: 'success', user: await authService.updateProfile(req.user, req.validated.body) });
};

exports.changePassword = async (req, res) => {
  const result = await authService.changePassword(req.user._id, req.validated.body);
  res.json({ status: 'success', ...result });
};
