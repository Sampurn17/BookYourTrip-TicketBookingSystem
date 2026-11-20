const AppError = require('../utils/AppError');

function formatIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/**
 * Validates and coerces request parts with zod schemas.
 * Parsed values are exposed on req.validated (Express 5 makes req.query read-only).
 */
const validate =
  (schemas = {}) =>
  (req, _res, next) => {
    req.validated = req.validated || {};
    for (const part of ['params', 'query', 'body']) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        const issues = formatIssues(result.error);
        throw new AppError(issues[0]?.message || 'Invalid request', 422, 'VALIDATION_ERROR', issues);
      }
      req.validated[part] = result.data;
    }
    next();
  };

module.exports = { validate };
