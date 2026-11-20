const config = require('../config');
const AppError = require('../utils/AppError');

function notFoundHandler(req, _res, next) {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404, 'ROUTE_NOT_FOUND'));
}

function normalise(err) {
  if (err instanceof AppError) return err;
  if (err.name === 'CastError') return new AppError(`Invalid ${err.path}`, 400, 'INVALID_ID');
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({ path: e.path, message: e.message }));
    return new AppError(details[0]?.message || 'Validation failed', 422, 'VALIDATION_ERROR', details);
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    return new AppError(`Duplicate value for ${field}`, 409, 'DUPLICATE');
  }
  if (err.type === 'entity.parse.failed') return new AppError('Malformed JSON body', 400, 'BAD_JSON');
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const known = normalise(err);
  if (!known) {
    // eslint-disable-next-line no-console
    if (!config.isTest) console.error('[unhandled]', err);
    return res.status(500).json({
      status: 'error',
      code: 'INTERNAL_ERROR',
      message: config.env === 'production' ? 'Something went wrong' : err.message,
    });
  }
  const body = { status: 'error', code: known.code, message: known.message };
  if (known.details !== undefined) body.details = known.details;
  return res.status(known.statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
