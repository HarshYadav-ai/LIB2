import { Router } from 'express';
import { Book, LibrarySettings, Loan, Reservation, Review, Wishlist } from '../models.js';
import { asyncRoute, audit, requireAuth, requireRole } from '../middleware.js';
import { ACTIVE_RESERVATION_STATUSES, createReservationRequest, expirePickupHolds, releaseHeldCopyAndPromote } from '../reservation-service.js';

const router = Router();
router.use(requireAuth, requireRole('student'));

router.get('/dashboard', asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const [loans, reservations, expiredReservations, wishlistCount, popularBooks, recentBooks, settings] = await Promise.all([
    Loan.find({ user: req.user._id }).populate('book', 'title author cover dueAt').sort({ dueAt: 1 }).lean(),
    Reservation.find({ user: req.user._id, status: { $in: ACTIVE_RESERVATION_STATUSES } }).populate('book', 'title author cover').sort({ createdAt: 1 }).lean(),
    Reservation.find({ user: req.user._id, status: 'expired', penaltyFee: { $gt: 0 }, penaltyAt: { $gte: new Date(Date.now() - 30 * 86400000) } }).populate('book', 'title').sort({ penaltyAt: -1 }).limit(10).lean(),
    Wishlist.countDocuments({ user: req.user._id }),
    Book.find({ active: true }).sort({ popularity: -1, averageRating: -1 }).limit(6).lean(),
    Book.find({ _id: { $in: req.user.recentlyViewed || [] }, active: true }).lean(),
    LibrarySettings.findOne({ key: 'default' }),
  ]);
  const activeLoans = loans.filter((loan) => loan.status === 'borrowed');
  const overdueLoans = activeLoans.filter((loan) => loan.dueAt < new Date());
  const dueSoon = activeLoans.filter((loan) => loan.dueAt >= new Date() && loan.dueAt <= new Date(Date.now() + 3 * 86400000));
  const lateFeePerDay = settings?.lateFeePerDay ?? 0.5;
  const notifications = [
    ...overdueLoans.map((loan) => ({ type: 'overdue', book: loan.book?.title, dueAt: loan.dueAt, fee: Number((Math.ceil((Date.now() - new Date(loan.dueAt)) / 86400000) * lateFeePerDay).toFixed(2)) })),
    ...dueSoon.map((loan) => ({ type: 'due_soon', book: loan.book?.title, dueAt: loan.dueAt })),
    ...activeLoans.filter((loan) => loan.returnRequested).map((loan) => ({ type: 'return_requested', book: loan.book?.title, requestedAt: loan.returnRequestedAt })),
    ...loans.filter((loan) => loan.status === 'returned' && loan.returnedAt >= new Date(Date.now() - 30 * 86400000)).map((loan) => ({ type: 'return_confirmed', book: loan.book?.title, returnedAt: loan.returnedAt })),
    ...loans.filter((loan) => loan.status === 'returned' && loan.lateFee > 0 && loan.returnedAt >= new Date(Date.now() - 30 * 86400000)).map((loan) => ({ type: 'fine_assessed', book: loan.book?.title, fee: loan.lateFee, returnedAt: loan.returnedAt })),
    ...reservations.filter((reservation) => reservation.status === 'ready').map((reservation) => ({ type: 'reservation_ready', book: reservation.book?.title, readyAt: reservation.readyAt })),
    ...reservations.filter((reservation) => reservation.status === 'pending_approval').map((reservation) => ({ type: 'request_pending', book: reservation.book?.title })),
    ...expiredReservations.map((reservation) => ({ type: 'pickup_expired', book: reservation.book?.title, fee: reservation.penaltyFee, penaltyAt: reservation.penaltyAt })),
  ];
  const recentOrder = new Map((req.user.recentlyViewed || []).map((id, i) => [String(id), i]));
  recentBooks.sort((a, b) => (recentOrder.get(String(a._id)) ?? 99) - (recentOrder.get(String(b._id)) ?? 99));
  const reservationPenaltyTotal = expiredReservations.reduce((sum, reservation) => sum + Number(reservation.penaltyFee || 0), 0);
  res.json({ summary: { activeLoans: activeLoans.length, overdue: overdueLoans.length, dueSoon: dueSoon.length, reservations: reservations.length, wishlist: wishlistCount, reservationPenaltyTotal }, loans, overdueLoans, dueSoon, reservations, notifications, popularBooks, recentBooks, profile: { name: req.user.name, department: req.user.department, studentId: req.user.studentId } });
}));

router.get('/notifications', asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const [loans, reservations, settings] = await Promise.all([
    Loan.find({ user: req.user._id, status: { $in: ['borrowed', 'returned'] } }).populate('book', 'title').lean(),
    Reservation.find({ user: req.user._id, status: { $in: ['pending_approval', 'ready'] } }).populate('book', 'title').lean(),
    LibrarySettings.findOne({ key: 'default' }),
  ]);
  const now = Date.now(); const lateFeePerDay = settings?.lateFeePerDay ?? 0.5;
  const notifications = loans.map((loan) => ({
    type: loan.dueAt < now ? 'overdue' : loan.dueAt < now + 3 * 86400000 ? 'due_soon' : null,
    book: loan.book?.title, dueAt: loan.dueAt,
    fee: loan.dueAt < now ? Number((Math.ceil((now - loan.dueAt) / 86400000) * lateFeePerDay).toFixed(2)) : 0,
  })).filter((item) => item.type);
  notifications.push(...loans.filter((loan) => loan.status === 'borrowed' && loan.returnRequested).map((loan) => ({ type: 'return_requested', book: loan.book?.title, requestedAt: loan.returnRequestedAt })));
  notifications.push(...loans.filter((loan) => loan.status === 'returned' && loan.returnedAt >= new Date(now - 30 * 86400000)).map((loan) => ({ type: 'return_confirmed', book: loan.book?.title, returnedAt: loan.returnedAt })));
  notifications.push(...loans.filter((loan) => loan.status === 'returned' && loan.lateFee > 0 && loan.returnedAt >= new Date(now - 30 * 86400000)).map((loan) => ({ type: 'fine_assessed', book: loan.book?.title, fee: loan.lateFee, returnedAt: loan.returnedAt })));
  notifications.push(...reservations.map((reservation) => ({ type: reservation.status === 'ready' ? 'reservation_ready' : 'request_pending', book: reservation.book?.title, readyAt: reservation.readyAt, pickupDeadline: reservation.pickupDeadline })));
  const expiredReservations = await Reservation.find({ user: req.user._id, status: 'expired', penaltyFee: { $gt: 0 } }).populate('book', 'title').sort({ penaltyAt: -1 }).limit(10).lean();
  notifications.push(...expiredReservations.map((reservation) => ({ type: 'pickup_expired', book: reservation.book?.title, fee: reservation.penaltyFee, penaltyAt: reservation.penaltyAt })));
  res.json({ notifications });
}));

router.post('/recently-viewed/:bookId', asyncRoute(async (req, res) => {
  const book = await Book.findOne({ _id: req.params.bookId, active: true });
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  req.user.recentlyViewed = [book._id, ...(req.user.recentlyViewed || []).filter((id) => String(id) !== String(book._id))].slice(0, 20);
  await req.user.save();
  res.json({ message: 'Reading history updated.' });
}));

router.get('/wishlist', asyncRoute(async (req, res) => {
  const items = await Wishlist.find({ user: req.user._id }).populate('book').sort({ createdAt: -1 }).lean();
  res.json({ wishlist: items });
}));
router.post('/wishlist', asyncRoute(async (req, res) => {
  const book = await Book.findOne({ _id: req.body?.bookId, active: true });
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  const item = await Wishlist.findOneAndUpdate({ user: req.user._id, book: book._id }, { $setOnInsert: { user: req.user._id, book: book._id } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  res.status(201).json({ wishlistItem: item });
}));
router.delete('/wishlist/:bookId', asyncRoute(async (req, res) => {
  await Wishlist.deleteOne({ user: req.user._id, book: req.params.bookId });
  res.json({ message: 'Removed from your wishlist.' });
}));

router.get('/reservations', asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const reservations = await Reservation.find({ user: req.user._id }).populate('book', 'title author cover availableCopies').sort({ createdAt: -1 }).lean();
  const result = await Promise.all(reservations.map(async (reservation) => {
    const queuePosition = reservation.status === 'waiting'
      ? await Reservation.countDocuments({ book: reservation.book._id, status: 'waiting', createdAt: { $lt: reservation.createdAt } }) + 1
      : 0;
    return { ...reservation, queuePosition };
  }));
  res.json({ reservations: result });
}));
router.post('/reservations', asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const result = await createReservationRequest(req.user._id, req.body?.bookId);
  if (result.error) return res.status(result.error.status).json({ message: result.error.message });
  await audit(req, 'reservation.requested', 'Reservation', result.reservation._id, { bookId: String(result.reservation.book), status: result.reservation.status });
  res.status(201).json({ reservation: result.reservation, message: result.message });
}));
router.delete('/reservations/:id', asyncRoute(async (req, res) => {
  await expirePickupHolds();
  const reservation = await Reservation.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id, status: { $in: ACTIVE_RESERVATION_STATUSES } },
    { $set: { status: 'cancelled', copyHeld: false } }, { new: true },
  );
  if (!reservation) return res.status(404).json({ message: 'Active reservation not found.' });
  if (reservation.copyHeld) await releaseHeldCopyAndPromote(reservation.book);
  await audit(req, 'reservation.cancelled', 'Reservation', reservation._id);
  res.json({ message: 'Reservation cancelled.' });
}));

router.get('/reviews', asyncRoute(async (req, res) => {
  const reviews = await Review.find({ user: req.user._id }).populate('book', 'title author cover').sort({ updatedAt: -1 }).lean();
  res.json({ reviews });
}));
router.post('/reviews', asyncRoute(async (req, res) => {
  const { bookId, rating, text = '' } = req.body || {};
  const book = await Book.findById(bookId);
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) return res.status(400).json({ message: 'Choose a rating from 1 to 5.' });
  const hasBorrowed = await Loan.exists({ user: req.user._id, book: book._id });
  if (!hasBorrowed) return res.status(403).json({ message: 'You can review books you have borrowed.' });
  await Review.findOneAndUpdate({ user: req.user._id, book: book._id }, { $set: { rating: Number(rating), text: String(text).trim() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const [aggregate] = await Review.aggregate([{ $match: { book: book._id, status: 'visible' } }, { $group: { _id: '$book', average: { $avg: '$rating' }, count: { $sum: 1 } } }]);
  await Book.updateOne({ _id: book._id }, { $set: { averageRating: aggregate?.average || 0, ratingsCount: aggregate?.count || 0 } });
  res.status(201).json({ message: 'Your review was saved.' });
}));

export default router;
