/**
 * Operational error with an HTTP status and a stable machine-readable code
 * that the frontend (and the AI agent) can branch on.
 */
class AppError extends Error {
  constructor(message, statusCode = 400, code = 'BAD_REQUEST', details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  static badRequest(message, code = 'BAD_REQUEST', details) {
    return new AppError(message, 400, code, details);
  }

  static unauthorized(message = 'Please log in to continue', code = 'UNAUTHORIZED') {
    return new AppError(message, 401, code);
  }

  static forbidden(message = 'You are not allowed to perform this action', code = 'FORBIDDEN') {
    return new AppError(message, 403, code);
  }

  static notFound(what = 'Resource') {
    return new AppError(`${what} not found`, 404, 'NOT_FOUND');
  }

  static conflict(message, code = 'CONFLICT', details) {
    return new AppError(message, 409, code, details);
  }
}

module.exports = AppError;
