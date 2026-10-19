import { Router } from 'express';
import axios from 'axios';
import { Book, Loan, Review, Wishlist } from '../models.js';
import { asyncRoute, requireAuth, requireRole } from '../middleware.js';

const router = Router();
const recommendationClient = axios.create({ baseURL: process.env.RECOMMENDATION_URL || 'http://127.0.0.1:8000', timeout: 4000 });
const toModel = (book) => ({ id: String(book._id), title: book.title, author: book.author, description: book.description, category: book.category, genres: book.genre || [], rating: book.averageRating || 0, popularity: book.popularity || 0, available: book.availableCopies > 0 });

router.get('/', requireAuth, requireRole('student'), asyncRoute(async (req, res) => {
  const books = await Book.find({ active: true }).sort({ popularity: -1, averageRating: -1 }).limit(500).lean();
  const [loans, likes, wishlist] = await Promise.all([
    Loan.find({ user: req.user._id }).sort({ checkoutAt: -1 }).limit(100).select('book').lean(),
    Review.find({ user: req.user._id, rating: { $gte: 4 } }).select('book').lean(),
    Wishlist.find({ user: req.user._id }).select('book').lean(),
  ]);
  const historyIds = [...new Set(loans.map((loan) => String(loan.book)))];
  const excludeIds = await Loan.find({ user: req.user._id, status: 'borrowed' }).select('book').lean();
  try {
    const { data } = await recommendationClient.post('/recommendations', {
      books: books.map(toModel), preferences: req.user.readingPreferences || [],
      history_ids: historyIds, liked_ids: likes.map((review) => String(review.book)),
      exclude_ids: excludeIds.map((loan) => String(loan.book)), limit: Math.min(16, Number(req.query.limit) || 8),
    });
    const map = new Map(books.map((book) => [String(book._id), book]));
    const recommendations = data.recommendations.map((item) => ({ ...map.get(item.id), _id: item.id, score: item.score, reason: item.reason }));
    return res.json({ recommendations, personalized: data.personalized, source: 'fastapi-tfidf-cosine' });
  } catch (error) {
    const excluded = new Set([...historyIds, ...wishlist.map((item) => String(item.book)), ...excludeIds.map((item) => String(item.book))]);
    const recommendations = books.filter((book) => !excluded.has(String(book._id))).slice(0, 8).map((book) => ({ ...book, reason: 'Popular and highly rated in the library.' }));
    return res.json({ recommendations, personalized: false, source: 'express-fallback', message: 'AI recommendations are temporarily unavailable; showing popular titles.' });
  }
}));

router.post('/similar-books', asyncRoute(async (req, res) => {
  const bookId = String(req.body?.bookId || '');
  if (!bookId) return res.status(400).json({ message: 'bookId is required.' });
  const books = await Book.find({ active: true }).limit(500).lean();
  if (!books.some((book) => String(book._id) === bookId)) return res.status(404).json({ message: 'Book not found.' });
  try {
    const { data } = await recommendationClient.post('/similar-books', { book_id: bookId, books: books.map(toModel), limit: 8 });
    const map = new Map(books.map((book) => [String(book._id), book]));
    return res.json({ similarBooks: data.similar_books.map((item) => ({ ...map.get(item.id), _id: item.id, reason: item.reason, score: item.score })), source: 'fastapi-tfidf-cosine' });
  } catch {
    const target = books.find((book) => String(book._id) === bookId);
    const tokens = new Set(`${target.category} ${target.author} ${(target.genre || []).join(' ')}`.toLowerCase().split(/\W+/).filter((token) => token.length > 2));
    const similarBooks = books.filter((book) => String(book._id) !== bookId).map((book) => {
      const text = `${book.category} ${book.author} ${(book.genre || []).join(' ')}`.toLowerCase();
      return { ...book, score: [...tokens].filter((token) => text.includes(token)).length, reason: 'Similar author or category.' };
    }).sort((a, b) => b.score - a.score).slice(0, 8);
    return res.json({ similarBooks, source: 'express-fallback' });
  }
}));

export default router;
