import { Router } from 'express';
import { Book, LibrarySettings, Loan } from '../models.js';
import { asyncRoute, hasPermission, requireAuth, requireRole } from '../middleware.js';
import { audit } from '../middleware.js';
import { createReservationRequest, promoteWaitingReservation } from '../reservation-service.js';

const router = Router();
const settings = async () => {
  try {
    return await LibrarySettings.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { upsert: true, new: true });
  } catch (error) {
    if (error?.code === 11000) return LibrarySettings.findOne({ key: 'default' });
    throw error;
  }
};
const branchDenied = (user, branch) => user.role === 'librarian' && user.branch && user.branch !== branch;

router.get('/mine', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const loans = await Loan.find({ user: req.user._id }).populate('book').sort({ createdAt: -1 }).lean();
  res.json({ loans });
}));

router.post('/', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const result = await createReservationRequest(req.user._id, req.body?.bookId, { checkoutRequest: true });
  if (result.error) return res.status(result.error.status).json({ message: result.error.message });
  await audit(req, 'loan.requested', 'Reservation', result.reservation._id, { bookId: String(result.reservation.book), status: result.reservation.status });
  return res.status(201).json({ reservation: result.reservation, message: result.message });
}));
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  if (!hasPermission(req.user, 'loans.process') && !hasPermission(req.user, 'returns.process')) return res.status(403).json({ message: 'You need loan or return processing permission to view transactions.' });
  const filter = {};
  if (req.user.role === 'librarian' && req.user.branch) filter.branch = req.user.branch;
  if (req.query.status && ['borrowed', 'returned', 'cancelled'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.overdue === 'true') { filter.status = 'borrowed'; filter.dueAt = { $lt: new Date() }; }
  let query = Loan.find(filter).populate('book', 'title author isbn cover branch').sort({ dueAt: 1 }).limit(250);
  query = hasPermission(req.user, 'students.view_limited') ? query.populate('user', 'name email studentId department') : query.populate('user', 'name');
  const [loans, policy] = await Promise.all([query.lean(), settings()]);
  const now = Date.now();
  res.json({ loans: loans.map((loan) => ({
    ...loan,
    estimatedLateFee: loan.status === 'borrowed' && loan.dueAt < now
      ? Number((Math.ceil((now - new Date(loan.dueAt)) / 86400000) * policy.lateFeePerDay).toFixed(2))
      : 0,
  })) });
}));

router.patch('/:id/renew', requireAuth, asyncRoute(async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate('book');
  if (!loan) return res.status(404).json({ message: 'Loan not found.' });
  if (branchDenied(req.user, loan.branch || loan.book?.branch)) return res.status(403).json({ message: 'This loan belongs to another branch.' });
  const isOwner = String(loan.user) === String(req.user._id);
  if (req.user.role === 'student' && isOwner) {
    if (loan.status !== 'borrowed') return res.status(409).json({ message: 'Only active loans can be renewed.' });
    if (loan.renewalCount >= (await settings()).maxRenewals) return res.status(409).json({ message: 'This loan has reached its renewal limit.' });
    if (loan.renewalRequested) return res.status(409).json({ message: 'A renewal request is already waiting.' });
    loan.renewalRequested = true; await loan.save();
    await audit(req, 'loan.renewal_requested', 'Loan', loan._id);
    return res.json({ loan, message: 'Renewal request sent to the library desk.' });
  }
  if (!hasPermission(req.user, 'loans.process')) return res.status(403).json({ message: 'You cannot process this renewal.' });
  if (!loan.renewalRequested || loan.status !== 'borrowed') return res.status(409).json({ message: 'This loan has no pending renewal request.' });
  const policy = await settings();
  loan.dueAt = new Date(Math.max(Date.now(), loan.dueAt.getTime()) + policy.loanDays * 86400000);
  loan.renewalRequested = false; loan.renewalCount += 1; loan.processedBy = req.user._id;
  await loan.save(); await audit(req, 'loan.renewed', 'Loan', loan._id);
  res.json({ loan });
}));

router.patch('/:id/return', requireAuth, asyncRoute(async (req, res) => {
  const loan = await Loan.findById(req.params.id);
  if (!loan) return res.status(404).json({ message: 'Loan not found.' });
  if (branchDenied(req.user, loan.branch)) return res.status(403).json({ message: 'This loan belongs to another branch.' });
  const isOwner = String(loan.user) === String(req.user._id);
  if (req.user.role === 'student' && isOwner) {
    if (loan.status !== 'borrowed') return res.status(409).json({ message: 'Only active loans can have a return request.' });
    const requestedAt = new Date();
    const requested = await Loan.findOneAndUpdate(
      { _id: loan._id, status: 'borrowed', returnRequested: { $ne: true } },
      { $set: { returnRequested: true, returnRequestedAt: requestedAt } },
      { new: true },
    );
    if (!requested) return res.status(409).json({ message: 'A return request is already waiting for library staff.' });
    await audit(req, 'loan.return_requested', 'Loan', loan._id);
    return res.json({ loan: requested, message: 'Return request sent. The loan stays active until library staff receive and confirm the book.' });
  }
  if (!hasPermission(req.user, 'returns.process')) return res.status(403).json({ message: 'You cannot process this return.' });
  if (req.body?.received !== true) return res.status(400).json({ message: 'Confirm that the physical book has been received at the library desk.' });
  if (loan.status !== 'borrowed') return res.status(409).json({ message: 'This loan has already been returned.' });
  const returnedAt = new Date();
  const policy = await settings();
  const daysLate = Math.max(0, Math.ceil((returnedAt - loan.dueAt) / 86400000));
  const fee = Number((daysLate * policy.lateFeePerDay).toFixed(2));
  const updated = await Loan.findOneAndUpdate({ _id: loan._id, status: 'borrowed' }, { $set: { status: 'returned', returnedAt, lateFee: fee, processedBy: req.user._id, renewalRequested: false, returnRequested: false } }, { new: true });
  if (!updated) return res.status(409).json({ message: 'This loan has already been returned.' });
  await Book.updateOne({ _id: loan.book }, { $inc: { availableCopies: 1 } });
  const nextReservation = await promoteWaitingReservation(loan.book);
  await audit(req, 'loan.returned', 'Loan', loan._id, { lateFee: fee, reservationAdvanced: nextReservation ? String(nextReservation._id) : '' });
  res.json({ loan: updated, lateFee: fee, advancedReservation: nextReservation?._id || null });
}));

export default router;

