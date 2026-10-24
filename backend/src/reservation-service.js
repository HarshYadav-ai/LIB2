import { AuditLog, Book, LibrarySettings, Loan, Reservation } from './models.js';

export const ACTIVE_RESERVATION_STATUSES = ['waiting', 'pending_approval', 'ready', 'issuing'];
export const PICKUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function promoteWaitingReservation(bookId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const next = await Reservation.findOne({ book: bookId, status: 'waiting' }).sort({ createdAt: 1 });
    if (!next) return null;
    const copy = await Book.findOneAndUpdate({ _id: bookId, active: true, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } }, { new: true });
    if (!copy) return null;
    const promoted = await Reservation.findOneAndUpdate(
      { _id: next._id, status: 'waiting' },
      { $set: { status: 'pending_approval', copyHeld: true, readyAt: null, pickupDeadline: null } },
      { new: true },
    );
    if (promoted) return promoted;
    await Book.updateOne({ _id: bookId }, { $inc: { availableCopies: 1 } });
  }
  return null;
}

export async function releaseHeldCopyAndPromote(bookId) {
  await Book.updateOne({ _id: bookId }, { $inc: { availableCopies: 1 } });
  return promoteWaitingReservation(bookId);
}

export async function createReservationRequest(userId, bookId, { checkoutRequest = false } = {}) {
  const book = await Book.findOne({ _id: bookId, active: true });
  if (!book) return { error: { status: 404, message: 'Book not found.' } };
  const settings = await LibrarySettings.findOne({ key: 'default' });
  const reservationLimit = settings?.reservationLimit ?? 5;
  const activeReservations = await Reservation.countDocuments({ user: userId, status: { $in: ACTIVE_RESERVATION_STATUSES } });
  if (activeReservations >= reservationLimit) return { error: { status: 409, message: `You can have up to ${reservationLimit} active requests or reservations.` } };
  const existing = await Reservation.exists({ user: userId, book: book._id, status: { $in: ACTIVE_RESERVATION_STATUSES } });
  if (existing) return { error: { status: 409, message: 'You already have an active request or reservation for this title.' } };

  if (checkoutRequest) {
    const [activeLoans, pendingCheckouts] = await Promise.all([
      Loan.countDocuments({ user: userId, status: 'borrowed' }),
      Reservation.countDocuments({ user: userId, status: { $in: ['pending_approval', 'ready', 'issuing'] } }),
    ]);
    const maxLoans = settings?.maxActiveLoans ?? 5;
    if (activeLoans + pendingCheckouts >= maxLoans) return { error: { status: 409, message: `Your active loan limit is ${maxLoans}.` } };
    const duplicateLoan = await Loan.exists({ user: userId, book: book._id, status: 'borrowed' });
    if (duplicateLoan) return { error: { status: 409, message: 'You already have this book checked out.' } };
  }

  await promoteWaitingReservation(book._id);
  const remainingWaiters = await Reservation.exists({ book: book._id, status: 'waiting' });
  let heldCopy = false;
  if (!remainingWaiters) {
    const claimed = await Book.findOneAndUpdate({ _id: book._id, active: true, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } }, { new: true });
    heldCopy = Boolean(claimed);
  }
  const newest = await Reservation.findOne({ book: book._id }).sort({ queueNumber: -1 }).select('queueNumber').lean();
  try {
    const reservation = await Reservation.create({
      user: userId,
      book: book._id,
      queueNumber: (newest?.queueNumber || 0) + 1,
      status: heldCopy ? 'pending_approval' : 'waiting',
      copyHeld: heldCopy,
    });
    return {
      reservation,
      message: heldCopy
        ? 'Request sent. A copy is held while library staff review it.'
        : 'No copies are currently available. Your request is in the waiting queue.',
    };
  } catch (error) {
    if (heldCopy) await Book.updateOne({ _id: book._id }, { $inc: { availableCopies: 1 } });
    throw error;
  }
}

export async function expirePickupHolds(now = new Date()) {
  const settings = await LibrarySettings.findOne({ key: 'default' });
  const penalty = settings?.reservationNoShowFee ?? 5;
  const candidates = await Reservation.find({ status: 'ready', copyHeld: true, pickupDeadline: { $lte: now } }).select('_id book user pickupDeadline').limit(500).lean();
  let expiredCount = 0;
  for (const candidate of candidates) {
    const expired = await Reservation.findOneAndUpdate(
      { _id: candidate._id, status: 'ready', copyHeld: true, pickupDeadline: { $lte: now } },
      { $set: { status: 'expired', copyHeld: false, penaltyFee: penalty, penaltyAt: now } },
      { new: true },
    );
    if (!expired) continue;
    await releaseHeldCopyAndPromote(expired.book);
    await AuditLog.create({ action: 'reservation.pickup_expired', targetType: 'Reservation', targetId: String(expired._id), details: { studentId: String(expired.user), penaltyFee: penalty } });
    expiredCount += 1;
  }
  return expiredCount;
}
