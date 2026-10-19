import { Router } from 'express';
import { Book, Loan, Review } from '../models.js';
import { asyncRoute, hasPermission, optionalAuth, requireAuth, requirePermission } from '../middleware.js';

const router = Router();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', optionalAuth, asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 12));
  const filter = { active: true };
  if (req.user?.role === 'librarian' && req.user.branch) filter.branch = req.user.branch;
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  if (q) filter.$or = ['title', 'author', 'isbn', 'description', 'publisher', 'category'].map((field) => ({ [field]: new RegExp(esc(q), 'i') }));
  if (category && category !== 'All books') filter.category = new RegExp(`^${esc(category)}$`, 'i');
  if (req.query.available === 'true') filter.availableCopies = { $gt: 0 };
  if (req.query.available === 'false') filter.availableCopies = 0;
  if (req.query.genre) filter.genre = { $in: [new RegExp(esc(req.query.genre), 'i')] };
  if (req.query.minRating) filter.averageRating = { $gte: Math.max(0, Math.min(5, Number(req.query.minRating) || 0)) };
  if (req.query.branch && req.user?.role !== 'librarian') filter.branch = String(req.query.branch);
  const sortMap = { newest: { createdAt: -1 }, title: { title: 1 }, author: { author: 1, title: 1 }, rating: { averageRating: -1, ratingsCount: -1 }, popular: { popularity: -1 }, available: { availableCopies: -1 } };
  const sort = sortMap[req.query.sort] || sortMap.newest;
  const [books, total] = await Promise.all([
    Book.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Book.countDocuments(filter),
  ]);
  res.json({ books, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id/reviews', asyncRoute(async (req, res) => {
  const reviews = await Review.find({ book: req.params.id, status: 'visible' }).populate('user', 'name').sort({ createdAt: -1 }).limit(50).lean();
  res.json({ reviews });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const book = await Book.findById(req.params.id).lean();
  if (!book || !book.active) return res.status(404).json({ message: 'Book not found.' });
  res.json({ book });
}));

router.post('/', requireAuth, requirePermission('books.create'), asyncRoute(async (req, res) => {
  const { title, author } = req.body || {};
  if (!String(title || '').trim() || !String(author || '').trim()) return res.status(400).json({ message: 'Title and author are required.' });
  if (req.user.role === 'librarian' && !hasPermission(req.user, 'inventory.manage') && req.body.totalCopies !== undefined) return res.status(403).json({ message: 'Inventory changes need the inventory.manage permission.' });
  const copies = Math.max(0, Number(req.body.totalCopies ?? req.body.availableCopies ?? 1));
  const payload = { title, author, ...req.body, totalCopies: copies, availableCopies: copies,
    branch: req.user.role === 'librarian' ? (req.user.branch || 'Main Library') : (req.body.branch || 'Main Library'), createdBy: req.user._id,
  };
  if (!String(payload.isbn || '').trim()) delete payload.isbn;
  const book = await Book.create(payload);
  res.status(201).json({ book });
}));

router.put('/:id', requireAuth, requirePermission('books.update'), asyncRoute(async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  if (req.user.role === 'librarian' && req.user.branch && book.branch !== req.user.branch) return res.status(403).json({ message: 'This book belongs to another branch.' });
  const body = req.body || {};
  const metadata = {};
  for (const field of ['title', 'author', 'isbn', 'description', 'publisher', 'year', 'language', 'category', 'genre', 'cover', 'branch']) {
    if (body[field] !== undefined) metadata[field] = body[field];
  }
  if (metadata.isbn !== undefined && !String(metadata.isbn).trim()) metadata.isbn = undefined;
  if (req.user.role === 'librarian' && metadata.branch && metadata.branch !== req.user.branch) return res.status(403).json({ message: 'Librarians cannot change a book’s assigned branch.' });
  const { availableCopies, totalCopies } = body;
  if ((availableCopies !== undefined || totalCopies !== undefined) && !hasPermission(req.user, 'inventory.manage')) return res.status(403).json({ message: 'Inventory changes need the inventory.manage permission.' });
  if (Object.keys(metadata).length) Object.assign(book, metadata);
  if (totalCopies !== undefined) {
    const activeLoans = await Loan.countDocuments({ book: book._id, status: 'borrowed' });
    const nextTotal = Math.max(0, Number(totalCopies));
    if (nextTotal < activeLoans) return res.status(409).json({ message: `There are ${activeLoans} active loans; total copies cannot be lower than that.` });
    const delta = nextTotal - book.totalCopies;
    book.totalCopies = nextTotal;
    book.availableCopies = Math.max(0, Math.min(nextTotal - activeLoans, book.availableCopies + delta));
  } else if (availableCopies !== undefined && req.user.role === 'admin') {
    const nextAvailable = Math.max(0, Number(availableCopies));
    if (nextAvailable > book.totalCopies) book.totalCopies = nextAvailable;
    book.availableCopies = nextAvailable;
  }
  book.updatedBy = req.user._id;
  await book.save();
  res.json({ book });
}));

router.delete('/:id', requireAuth, requirePermission('inventory.manage'), asyncRoute(async (req, res) => {
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ message: 'Book not found.' });
  if (req.user.role === 'librarian' && req.user.branch && book.branch !== req.user.branch) return res.status(403).json({ message: 'This book belongs to another branch.' });
  const activeLoan = await Loan.exists({ book: book._id, status: 'borrowed' });
  if (activeLoan) return res.status(409).json({ message: 'Return active loans before archiving this book.' });
  book.active = false;
  book.updatedBy = req.user._id;
  await book.save();
  res.json({ message: 'Book archived.' });
}));

export default router;
