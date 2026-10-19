import { Router } from 'express';
import { AuditLog, Book, LibrarySettings, Loan, Reservation, User } from '../models.js';
import { asyncRoute, audit, requireAuth, requirePermission, requireRole } from '../middleware.js';
import { expirePickupHolds, releaseHeldCopyAndPromote } from '../reservation-service.js';

const router = Router();
router.use(requireAuth, requireRole('librarian', 'admin'));

router.get('/dashboard', requirePermission('reports.view'), asyncRoute(async (req, res) => {
  const branch = req.user.role === 'librarian' && req.user.branch ? req.user.branch : undefined;
  const bookFilter = { active: true, ...(branch ? { branch } : {}) };
  const loanFilter = { ...(branch ? { branch } : {}) };
  const [inventory, availableCopies, activeLoans, overdueLoans, reservations, recentActivity] = await Promise.all([
    Book.countDocuments(bookFilter), Book.aggregate([{ $match: bookFilter }, { $group: { _id: null, total: { $sum: '$availableCopies' } } }]),
    Loan.countDocuments({ ...loanFilter, status: 'borrowed' }), Loan.countDocuments({ ...loanFilter, status: 'borrowed', dueAt: { $lt: new Date() } }),
    Reservation.countDocuments({ status: { $in: ['waiting', 'pending_approval', 'ready'] } }),
    AuditLog.find({ actor: req.user._id }).sort({ createdAt: -1 }).limit(6).lean(),
  ]);
  res.json({ stats: { inventory, availableCopies: availableCopies[0]?.total || 0, activeLoans, overdueLoans, reservations }, recentActivity });
}));

router.get('/students', requirePermission('students.view_limited'), asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (q.length < 2) return res.status(400).json({ message: 'Enter at least two characters to search.' });
  const students = await User.find({ role: 'student', status: 'active', $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }, { studentId: new RegExp(q, 'i') }] }).select('name email studentId department branch').limit(25).lean();
  res.json({ students });
}));

router.get('/reservations', requirePermission('reservations.manage'), asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const reservations = await Reservation.find({ status: { $in: ['waiting', 'pending_approval', 'ready'] } }).populate('book', 'title author branch availableCopies').populate('user', 'name email studentId department').sort({ createdAt: 1 }).limit(250).lean();
  const branchFiltered = req.user.role === 'librarian' && req.user.branch ? reservations.filter((r) => r.book?.branch === req.user.branch) : reservations;
  res.json({ reservations: branchFiltered });
}));

router.patch('/reservations/:id/approve', requirePermission('reservations.manage'), asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const reservation = await Reservation.findById(req.params.id).populate('book', 'branch');
  if (!reservation) return res.status(404).json({ message: 'Reservation not found.' });
  if (req.user.role === 'librarian' && req.user.branch && reservation.book?.branch !== req.user.branch) return res.status(403).json({ message: 'This reservation belongs to another branch.' });
  if (reservation.status !== 'pending_approval' || !reservation.copyHeld) return res.status(409).json({ message: 'Only requests with a held copy can be approved.' });
  const now = new Date();
  const ready = await Reservation.findOneAndUpdate(
    { _id: reservation._id, status: 'pending_approval', copyHeld: true },
    { $set: { status: 'ready', readyAt: now, pickupDeadline: new Date(now.getTime() + 24 * 60 * 60 * 1000), approvedBy: req.user._id, approvedAt: now } },
    { new: true },
  );
  if (!ready) return res.status(409).json({ message: 'This request was updated by another staff member.' });
  await audit(req, 'reservation.approved_for_pickup', 'Reservation', ready._id, { pickupDeadline: ready.pickupDeadline });
  res.json({ reservation: ready, message: 'Approved. The student has 24 hours to collect this book.' });
}));

router.patch('/reservations/:id/issue', requirePermission('loans.process'), asyncRoute(async (req, res) => {
  await expirePickupHolds();
  if (req.body?.studentVerified !== true) return res.status(400).json({ message: 'Confirm the student’s identity in person before issuing this book.' });
  const reservation = await Reservation.findById(req.params.id).populate('book', 'title branch');
  if (!reservation) return res.status(404).json({ message: 'Reservation not found.' });
  if (req.user.role === 'librarian' && req.user.branch && reservation.book?.branch !== req.user.branch) return res.status(403).json({ message: 'This reservation belongs to another branch.' });
  if (reservation.status !== 'ready' || !reservation.copyHeld) return res.status(409).json({ message: 'This request is not approved for pickup.' });
  if (reservation.pickupDeadline && reservation.pickupDeadline <= new Date()) return res.status(410).json({ message: 'The pickup window expired. The held copy has been released.' });
  const student = await User.findById(reservation.user);
  if (!student || student.role !== 'student' || student.status !== 'active') return res.status(409).json({ message: 'This student account is not active.' });
  const policy = await LibrarySettings.findOne({ key: 'default' });
  const [activeLoans, duplicateLoan] = await Promise.all([
    Loan.countDocuments({ user: student._id, status: 'borrowed' }),
    Loan.exists({ user: student._id, book: reservation.book._id, status: 'borrowed' }),
  ]);
  if (duplicateLoan) return res.status(409).json({ message: 'This student already has this book checked out.' });
  if (activeLoans >= (policy?.maxActiveLoans ?? 5)) return res.status(409).json({ message: 'The student has reached the active loan limit.' });
  const claimed = await Reservation.findOneAndUpdate({ _id: reservation._id, status: 'ready', copyHeld: true }, { $set: { status: 'issuing' } }, { new: true });
  if (!claimed) return res.status(409).json({ message: 'Another staff member is already processing this pickup.' });
  try {
    const now = new Date();
    const loan = await Loan.create({ user: student._id, book: reservation.book._id, branch: reservation.book.branch || 'Main Library', checkoutAt: now, dueAt: new Date(now.getTime() + (policy?.loanDays ?? 14) * 86400000), processedBy: req.user._id });
    await Reservation.updateOne({ _id: claimed._id, status: 'issuing' }, { $set: { status: 'fulfilled', copyHeld: false, fulfilledAt: now } });
    await audit(req, 'reservation.book_issued', 'Reservation', claimed._id, { loanId: String(loan._id), studentId: String(student._id) });
    return res.status(201).json({ loan, message: `Book issued to ${student.name}.` });
  } catch (error) {
    await Reservation.updateOne({ _id: claimed._id, status: 'issuing' }, { $set: { status: 'ready' } });
    throw error;
  }
}));

router.patch('/reservations/:id/cancel', requirePermission('reservations.manage'), asyncRoute(async (req, res) => {
  const reservation = await Reservation.findOne({ _id: req.params.id, status: { $in: ['waiting', 'pending_approval', 'ready'] } }).populate('book', 'branch');
  if (!reservation) return res.status(404).json({ message: 'Open reservation not found.' });
  if (req.user.role === 'librarian' && req.user.branch && reservation.book?.branch !== req.user.branch) return res.status(403).json({ message: 'This reservation belongs to another branch.' });
  const copyHeld = reservation.copyHeld;
  const cancelled = await Reservation.findOneAndUpdate({ _id: reservation._id, status: reservation.status }, { $set: { status: 'cancelled', copyHeld: false } }, { new: true });
  if (!cancelled) return res.status(409).json({ message: 'This reservation was updated by another staff member.' });
  if (copyHeld) await releaseHeldCopyAndPromote(reservation.book._id);
  await audit(req, 'reservation.cancelled_by_staff', 'Reservation', reservation._id);
  res.json({ message: 'Reservation cancelled.' });
}));

router.get('/activity', asyncRoute(async (req, res) => {
  const logs = await AuditLog.find({ actor: req.user._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ activity: logs });
}));

export default router;
