import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { User } from '../models.js';
import { asyncRoute, clearSessionCookie, requireAuth, safeUser, setSessionCookie } from '../middleware.js';

const router = Router();
const emailIsValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

router.post('/register', asyncRoute(async (req, res) => {
  const { name, email, password, confirmPassword, studentId, department } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!String(name || '').trim() || !emailIsValid(normalizedEmail) || !password) return res.status(400).json({ message: 'Enter your name, a valid email, and a password.' });
  if (String(password).length < 8) return res.status(400).json({ message: 'Use a password with at least 8 characters.' });
  if (confirmPassword !== undefined && password !== confirmPassword) return res.status(400).json({ message: 'The passwords do not match.' });
  if (studentId && String(studentId).trim().length < 3) return res.status(400).json({ message: 'Student ID must be at least 3 characters.' });
  const user = await User.create({
    name: String(name).trim(), email: normalizedEmail,
    passwordHash: await bcrypt.hash(password, 12), role: 'student', status: 'active',
    studentId: studentId ? String(studentId).trim().toUpperCase() : undefined,
    department: String(department || '').trim(),
  });
  setSessionCookie(res, user, false);
  return res.status(201).json({ user: safeUser(user) });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await User.findOne({ email }).select('+passwordHash');
  const passwordOk = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!user || !passwordOk || !['active', 'invited'].includes(user.status)) return res.status(401).json({ message: 'Email or password is incorrect.' });
  user.lastLoginAt = new Date();
  await user.save();
  setSessionCookie(res, user, Boolean(req.body?.rememberMe));
  return res.json({ user: safeUser(user) });
}));

router.post('/forgot-password', asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const generic = { message: 'If an eligible account exists, password reset instructions will be sent.' };
  if (!process.env.SMTP_HOST && process.env.NODE_ENV === 'production') return res.status(503).json({ message: 'Password recovery email is not configured. Contact a library administrator.' });
  const user = await User.findOne({ email, status: { $in: ['active', 'invited'] } });
  if (!user) return res.json(generic);
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') return res.status(503).json({ message: 'Password recovery email is not configured. Contact a library administrator.' });
    return res.json({ ...generic, developmentHint: 'Configure SMTP_HOST to send account recovery emails.' });
  }
  const token = randomBytes(32).toString('base64url');
  user.resetPasswordTokenHash = createHash('sha256').update(token).digest('hex');
  user.resetPasswordExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } });
  const resetUrl = `${process.env.CLIENT_ORIGIN?.split(',')[0] || 'http://localhost:5173'}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(user.email)}`;
  await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: user.email, subject: 'Reset your BookWise AI password', text: `Use this link within 30 minutes to reset your password: ${resetUrl}` });
  return res.json(generic);
}));

router.post('/reset-password', asyncRoute(async (req, res) => {
  const token = String(req.body?.token || '');
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (password.length < 8) return res.status(400).json({ message: 'Use a password with at least 8 characters.' });
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({ email, resetPasswordTokenHash: tokenHash, resetPasswordExpiresAt: { $gt: new Date() } }).select('+resetPasswordTokenHash +resetPasswordExpiresAt +passwordHash');
  if (!user) return res.status(400).json({ message: 'This reset link is invalid or expired.' });
  user.passwordHash = await bcrypt.hash(password, 12); user.resetPasswordTokenHash = undefined; user.resetPasswordExpiresAt = undefined;
  user.forcePasswordChange = false; user.sessionVersion += 1; await user.save();
  await user.updateOne({ $unset: { resetPasswordTokenHash: 1, resetPasswordExpiresAt: 1 } });
  clearSessionCookie(res);
  return res.json({ message: 'Password reset. You can sign in with your new password.' });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  const token = req.cookies?.bookwise_session;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      await User.findByIdAndUpdate(payload.sub, { $inc: { sessionVersion: 1 } });
    } catch { /* Expired sessions can still be cleared locally. */ }
  }
  clearSessionCookie(res);
  return res.json({ message: 'Signed out.' });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: safeUser(req.user) }));
router.post('/refresh', requireAuth, (req, res) => {
  setSessionCookie(res, req.user, Boolean(req.sessionPayload?.remember));
  res.json({ user: safeUser(req.user) });
});

router.put('/password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  const user = await User.findById(req.user._id).select('+passwordHash');
  if (!user) return res.status(401).json({ message: 'Sign in again to continue.' });
  if (!user.forcePasswordChange && !await bcrypt.compare(String(currentPassword || ''), user.passwordHash)) return res.status(400).json({ message: 'Current password is incorrect.' });
  if (String(newPassword || '').length < 8) return res.status(400).json({ message: 'Use a password with at least 8 characters.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ message: 'The passwords do not match.' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.forcePasswordChange = false;
  user.status = 'active';
  user.sessionVersion += 1;
  await user.save();
  setSessionCookie(res, user, true);
  return res.json({ user: safeUser(user), message: 'Password changed.' });
}));

router.put('/profile', requireAuth, asyncRoute(async (req, res) => {
  const { name, department, studentId, readingPreferences } = req.body || {};
  const allowed = {};
  if (name !== undefined) allowed.name = String(name).trim();
  if (department !== undefined) allowed.department = String(department).trim();
  if (req.user.role === 'student' && studentId !== undefined) allowed.studentId = String(studentId).trim() ? String(studentId).trim().toUpperCase() : undefined;
  if (Array.isArray(readingPreferences)) allowed.readingPreferences = readingPreferences.map((v) => String(v).trim()).filter(Boolean).slice(0, 20);
  if (Object.hasOwn(req.body || {}, 'role') || Object.hasOwn(req.body || {}, 'permissions') || Object.hasOwn(req.body || {}, 'status')) return res.status(403).json({ message: 'Role, permissions, and account status can only be changed by an administrator.' });
  const user = await User.findById(req.user._id);
  Object.assign(user, allowed);
  await user.save();
  return res.json({ user: safeUser(user) });
}));

export default router;
