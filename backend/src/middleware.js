import jwt from 'jsonwebtoken';
import { User } from './models.js';
import { hasPermission } from './permissions.js';
export { hasPermission };

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export const safeUser = (user) => ({
  id: String(user._id), name: user.name, email: user.email, role: user.role,
  status: user.status, studentId: user.studentId || '', employeeId: user.employeeId || '',
  department: user.department || '', branch: user.branch || '',
  permissions: user.role === 'admin' ? ['*'] : (user.permissions || []),
  readingPreferences: user.readingPreferences || [],
  forcePasswordChange: Boolean(user.forcePasswordChange),
  createdAt: user.createdAt,
});

export function setSessionCookie(res, user, remember = false) {
  const secret = process.env.JWT_SECRET;
  const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : undefined;
  const token = jwt.sign({ sub: String(user._id), sv: user.sessionVersion, remember }, secret, {
    expiresIn: remember ? '30d' : '12h',
  });
  res.cookie('bookwise_session', token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/api/v1', ...(maxAge ? { maxAge } : {}),
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('bookwise_session', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', path: '/api/v1',
  });
}

export const requireAuth = asyncRoute(async (req, res, next) => {
  const cookieToken = req.cookies?.bookwise_session;
  const bearerToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ message: 'Sign in to continue.' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.sessionPayload = payload;
    const user = await User.findById(payload.sub);
    if (!user || !['active', 'invited'].includes(user.status) || user.sessionVersion !== payload.sv) {
      return res.status(401).json({ message: 'This session is no longer active. Please sign in again.' });
    }
    req.user = user;
    if (user.forcePasswordChange && !['/password', '/me', '/refresh'].includes(req.path)) {
      return res.status(403).json({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your temporary password to continue.' });
    }
    return next();
  } catch {
    return res.status(401).json({ message: 'Your session expired. Please sign in again.' });
  }
});

export const optionalAuth = asyncRoute(async (req, _res, next) => {
  const cookieToken = req.cookies?.bookwise_session;
  const bearerToken = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (cookieToken || bearerToken) {
    try {
      const payload = jwt.verify(cookieToken || bearerToken, process.env.JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (user && user.status === 'active' && user.sessionVersion === payload.sv) req.user = user;
    } catch { /* Public catalogue reads remain public for expired sessions. */ }
  }
  next();
});

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) return res.status(403).json({ message: 'You do not have access to this area.' });
  return next();
};

export const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.user, permission)) return res.status(403).json({ message: `Missing permission: ${permission}` });
  return next();
};

export async function audit(req, action, targetType, targetId = '', details = {}) {
  const { AuditLog } = await import('./models.js');
  return AuditLog.create({
    actor: req.user?._id, actorEmail: req.user?.email || '', action,
    targetType, targetId: String(targetId || ''), details, ip: req.ip || '',
  });
}
