import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuditLog, Book, LibrarySettings, Loan, Reservation, Review, User } from '../models.js';
import { asyncRoute, audit, requireAuth, requireRole, safeUser } from '../middleware.js';
import { LIBRARIAN_PERMISSIONS, DEFAULT_LIBRARIAN_PERMISSIONS } from '../permissions.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));
const makeTemporaryPassword = () => randomBytes(12).toString('base64url');
const validPermissionList = (items) => Array.isArray(items) && items.every((item) => LIBRARIAN_PERMISSIONS.includes(item));

router.get('/dashboard', asyncRoute(async (_req, res) => {
  const [students, librarians, activeLoans, overdueLoans, books, waitingReservations, popularBooks, recentLogs] = await Promise.all([
    User.countDocuments({ role: 'student', status: 'active' }),
    User.countDocuments({ role: 'librarian', status: { $in: ['active', 'invited'] } }),
    Loan.countDocuments({ status: 'borrowed' }), Loan.countDocuments({ status: 'borrowed', dueAt: { $lt: new Date() } }),
    Book.countDocuments({ active: true }), Reservation.countDocuments({ status: { $in: ['waiting', 'pending_approval', 'ready'] } }),
    Book.find({ active: true }).sort({ popularity: -1, averageRating: -1 }).limit(5).select('title author popularity averageRating').lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).select('actorEmail action targetType createdAt').lean(),
  ]);
  res.json({ stats: { students, librarians, activeLoans, overdueLoans, books, waitingReservations }, popularBooks, recentLogs });
}));

router.get('/users', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Number.parseInt(req.query.limit, 10) || 25);
  const filter = {};
  if (req.query.role && ['student', 'librarian', 'admin'].includes(req.query.role)) filter.role = req.query.role;
  if (req.query.status && ['active', 'invited', 'suspended', 'deactivated'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) { const q = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['name', 'email', 'studentId', 'employeeId'].map((field) => ({ [field]: new RegExp(q, 'i') })); }
  const [users, total] = await Promise.all([User.find(filter).select('-passwordHash -sessionVersion').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), User.countDocuments(filter)]);
  res.json({ users: users.map((u) => ({ ...u, id: String(u._id) })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.post('/librarians', asyncRoute(async (req, res) => {
  const { name, email, employeeId, department = '', branch, permissions = DEFAULT_LIBRARIAN_PERMISSIONS } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!String(name || '').trim() || !normalizedEmail || !String(employeeId || '').trim() || !String(branch || '').trim()) return res.status(400).json({ message: 'Name, email, employee ID, and branch are required.' });
  if (!validPermissionList(permissions)) return res.status(400).json({ message: 'One or more permissions are not supported.' });
  const temporaryPassword = makeTemporaryPassword();
  const librarian = await User.create({
    name: String(name).trim(), email: normalizedEmail, employeeId: String(employeeId).trim().toUpperCase(),
    department: String(department).trim(), branch: String(branch).trim(), role: 'librarian', status: 'invited',
    permissions, passwordHash: await bcrypt.hash(temporaryPassword, 12), forcePasswordChange: true, createdBy: req.user._id,
  });
  await audit(req, 'librarian.invited', 'User', librarian._id, { employeeId: librarian.employeeId, branch: librarian.branch, permissions });
  res.status(201).json({ librarian: safeUser(librarian), temporaryPassword, message: 'Copy this temporary password now; it will not be shown again.' });
}));

router.get('/librarians', asyncRoute(async (_req, res) => {
  const librarians = await User.find({ role: 'librarian' }).select('-passwordHash -sessionVersion').sort({ createdAt: -1 }).lean();
  res.json({ librarians: librarians.map((u) => ({ ...u, id: String(u._id) })) });
}));

router.patch('/librarians/:id', asyncRoute(async (req, res) => {
  const librarian = await User.findOne({ _id: req.params.id, role: 'librarian' });
  if (!librarian) return res.status(404).json({ message: 'Librarian account not found.' });
  const { name, employeeId, department, branch, permissions } = req.body || {};
  if (permissions !== undefined && !validPermissionList(permissions)) return res.status(400).json({ message: 'One or more permissions are not supported.' });
  if (name !== undefined) librarian.name = String(name).trim();
  if (employeeId !== undefined) librarian.employeeId = String(employeeId).trim().toUpperCase();
  if (department !== undefined) librarian.department = String(department).trim();
  if (branch !== undefined) librarian.branch = String(branch).trim();
  if (permissions !== undefined) librarian.permissions = [...new Set(permissions)];
  librarian.updatedBy = req.user._id;
  await librarian.save();
  await audit(req, 'librarian.updated', 'User', librarian._id, { permissions: librarian.permissions, branch: librarian.branch });
  res.json({ librarian: safeUser(librarian) });
}));

router.post('/librarians/:id/reset-password', asyncRoute(async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ message: 'Confirm the password reset to continue.' });
  const librarian = await User.findOne({ _id: req.params.id, role: 'librarian' });
  if (!librarian) return res.status(404).json({ message: 'Librarian account not found.' });
  const temporaryPassword = makeTemporaryPassword();
  librarian.passwordHash = await bcrypt.hash(temporaryPassword, 12);
  librarian.forcePasswordChange = true; librarian.status = 'invited'; librarian.sessionVersion += 1; librarian.updatedBy = req.user._id;
  await librarian.save();
  await audit(req, 'librarian.password_reset', 'User', librarian._id);
  res.json({ temporaryPassword, message: 'Copy this temporary password now; it will not be shown again.' });
}));

router.patch('/users/:id/status', asyncRoute(async (req, res) => {
  const { status, confirmEmail } = req.body || {};
  if (!['active', 'suspended', 'deactivated'].includes(status)) return res.status(400).json({ message: 'Choose active, suspended, or deactivated.' });
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: 'Account not found.' });
  if (String(target._id) === String(req.user._id)) return res.status(409).json({ message: 'You cannot suspend or deactivate your own account.' });
  if (['suspended', 'deactivated'].includes(status) && String(confirmEmail || '').toLowerCase() !== target.email) return res.status(400).json({ message: 'Enter this account’s email to confirm the change.' });
  target.status = status; target.updatedBy = req.user._id; target.sessionVersion += 1;
  await target.save();
  await audit(req, `user.${status}`, 'User', target._id, { role: target.role });
  res.json({ user: safeUser(target) });
}));

router.delete('/users/:id', asyncRoute(async (req, res) => {
  const { confirmEmail } = req.body || {};
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: 'Account not found.' });
  if (String(target._id) === String(req.user._id)) return res.status(409).json({ message: 'You cannot delete your own account.' });
  if (!['student', 'librarian'].includes(target.role)) return res.status(409).json({ message: 'Only student and librarian accounts can be deleted here.' });
  if (String(confirmEmail || '').trim().toLowerCase() !== target.email) return res.status(400).json({ message: 'Enter this account’s email to confirm deletion.' });
  if (target.role === 'student') {
    const [activeLoan, activeReservation] = await Promise.all([
      Loan.exists({ user: target._id, status: 'borrowed' }),
      Reservation.exists({ user: target._id, status: { $in: ['waiting', 'pending_approval', 'ready', 'issuing'] } }),
    ]);
    if (activeLoan || activeReservation) return res.status(409).json({ message: 'This student has an active loan or reservation. Process those items before deleting the account.' });
  }
  const reviews = await Review.find({ user: target._id }).select('book').lean();
  await Promise.all([Wishlist.deleteMany({ user: target._id }), Review.deleteMany({ user: target._id })]);
  for (const bookId of new Set(reviews.map((review) => String(review.book)))) {
    const [aggregate] = await Review.aggregate([{ $match: { book: new mongoose.Types.ObjectId(bookId), status: 'visible' } }, { $group: { _id: '$book', average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
    await Book.updateOne({ _id: bookId }, { $set: { averageRating: aggregate?.average || 0, ratingsCount: aggregate?.count || 0 } });
  }
  await User.deleteOne({ _id: target._id });
  await audit(req, 'user.deleted', 'User', target._id, { role: target.role, email: target.email });
  res.json({ message: `${target.role === 'librarian' ? 'Librarian' : 'Student'} account deleted. Historical loans and audit records remain.` });
}));

router.patch('/users/:id/role', asyncRoute(async (req, res) => {
  const { role, confirmEmail } = req.body || {};
  if (!['student', 'librarian', 'admin'].includes(role)) return res.status(400).json({ message: 'Choose student, librarian, or admin.' });
  if (role === 'librarian') return res.status(400).json({ message: 'Create librarian accounts with the secure invitation form.' });
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).json({ message: 'Account not found.' });
  if (role === 'admin' && String(confirmEmail || '').toLowerCase() !== target.email) return res.status(400).json({ message: 'Enter the account email to confirm administrator access.' });
  if (String(target._id) === String(req.user._id) && role !== 'admin') return res.status(409).json({ message: 'You cannot remove your own admin role.' });
  const oldRole = target.role; target.role = role; target.updatedBy = req.user._id; target.sessionVersion += 1;
  if (role !== 'librarian') target.permissions = [];
  await target.save();
  await audit(req, 'user.role_changed', 'User', target._id, { from: oldRole, to: role });
  res.json({ user: safeUser(target) });
}));

router.get('/settings', asyncRoute(async (_req, res) => {
  const settings = await LibrarySettings.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true });
  res.json({ settings });
}));
router.put('/settings', asyncRoute(async (req, res) => {
  const allowed = ['loanDays', 'maxActiveLoans', 'maxRenewals', 'lateFeePerDay', 'reservationLimit', 'reservationNoShowFee'];
  const updates = {};
  for (const key of allowed) if (req.body?.[key] !== undefined) updates[key] = Number(req.body[key]);
  const settings = await LibrarySettings.findOneAndUpdate({ key: 'default' }, { $set: { ...updates, updatedBy: req.user._id }, $setOnInsert: { key: 'default' } }, { upsert: true, new: true, runValidators: true });
  await audit(req, 'settings.updated', 'LibrarySettings', settings._id, updates);
  res.json({ settings });
}));

router.get('/audit-logs', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const logs = await AuditLog.find().populate('actor', 'name email role').sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean();
  res.json({ logs, page });
}));

router.get('/analytics', asyncRoute(async (_req, res) => {
  const [byCategory, topBooks, monthlyLoans] = await Promise.all([
    Book.aggregate([{ $match: { active: true } }, { $group: { _id: '$category', count: { $sum: 1 }, copies: { $sum: '$totalCopies' }, available: { $sum: '$availableCopies' } } }, { $sort: { count: -1 } }]),
    Book.find({ active: true }).sort({ popularity: -1 }).limit(10).select('title author popularity averageRating').lean(),
    Loan.aggregate([{ $match: { checkoutAt: { $gte: new Date(Date.now() - 180 * 86400000) } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$checkoutAt' } }, total: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  ]);
  res.json({ byCategory, topBooks, monthlyLoans });
}));

router.get('/reviews', asyncRoute(async (_req, res) => {
  const reviews = await Review.find({}).populate('book', 'title').populate('user', 'name email').sort({ updatedAt: -1 }).limit(200).lean();
  res.json({ reviews });
}));
router.patch('/reviews/:id', asyncRoute(async (req, res) => {
  const status = req.body?.status;
  if (!['visible', 'hidden', 'reported'].includes(status)) return res.status(400).json({ message: 'Choose visible, hidden, or reported.' });
  const review = await Review.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!review) return res.status(404).json({ message: 'Review not found.' });
  await audit(req, 'review.moderated', 'Review', review._id, { status });
  res.json({ review });
}));

export default router;

