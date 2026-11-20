const adminService = require('../services/adminService');

exports.listProviders = async (req, res) => {
  const providers = await adminService.listProviders(req.validated.query.status);
  res.json({ status: 'success', count: providers.length, providers });
};

const transition = (action) => async (req, res) => {
  const result = await adminService.changeProviderStatus(req.validated.params.id, action, req.validated.body?.reason);
  res.json({ status: 'success', ...result });
};

exports.approve = transition('approve');
exports.suspend = transition('suspend');
exports.reactivate = transition('reactivate');
exports.discontinue = transition('discontinue');

exports.stats = async (_req, res) => {
  res.json({ status: 'success', stats: await adminService.platformStats() });
};

exports.integrity = async (_req, res) => {
  res.json({ status: 'success', integrity: await adminService.integrityCheck() });
};
