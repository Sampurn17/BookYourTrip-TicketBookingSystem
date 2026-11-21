const jwt = require('jsonwebtoken');
const config = require('../config');
const AppError = require('../utils/AppError');
const { User, Provider } = require('../models');

function signToken(userId) {
  return jwt.sign({ id: String(userId) }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

async function resolveUser(token) {
  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw AppError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Your session has expired. Please log in again.' : 'Invalid token',
      'INVALID_TOKEN',
    );
  }
  const user = await User.findById(decoded.id);
  if (!user) throw AppError.unauthorized('The user for this token no longer exists', 'INVALID_TOKEN');
  if (user.changedPasswordAfter(decoded.iat)) {
    throw AppError.unauthorized('Password was changed recently. Please log in again.', 'INVALID_TOKEN');
  }
  return user;
}

/** Requires a valid JWT. The identity used by every downstream handler comes from here, never from the body. */
async function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) throw AppError.unauthorized();
  req.user = await resolveUser(token);
  next();
}

const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) throw AppError.unauthorized();
    if (!roles.includes(req.user.role)) throw AppError.forbidden();
    next();
  };

/** Loads the provider profile for the logged-in provider. `requireActive` blocks pending/suspended accounts. */
const loadProvider =
  ({ requireActive = true } = {}) =>
  async (req, _res, next) => {
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) throw AppError.forbidden('Provider profile not found');
    if (requireActive && provider.status !== 'active') {
      throw AppError.forbidden(`Your provider account is ${provider.status}`, 'PROVIDER_INACTIVE');
    }
    req.provider = provider;
    next();
  };

module.exports = { signToken, authenticate, authorize, loadProvider };
