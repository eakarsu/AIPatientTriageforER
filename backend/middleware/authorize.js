/**
 * Role-based authorization middleware.
 * Usage: authorize('doctor', 'admin')
 * Requires auth middleware to run first (populates req.user).
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Please log in.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}.`
      });
    }
    next();
  };
}

module.exports = authorize;
