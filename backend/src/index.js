import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import bookRoutes from './routes/books.js';
import loanRoutes from './routes/loans.js';
import studentRoutes from './routes/students.js';
import recommendationRoutes from './routes/recommendations.js';
import staffRoutes from './routes/staff.js';
import adminRoutes from './routes/admin.js';
import { expirePickupHolds } from './reservation-service.js';

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const api = express.Router();
const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((origin) => origin.trim());

app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet());
app.use(cors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 25, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many account requests. Please wait and try again.' } });
api.use('/auth/register', authLimiter);
api.use('/auth/login', authLimiter);
api.use('/auth/forgot-password', authLimiter);
api.use('/auth/reset-password', authLimiter);
api.use('/auth', authRoutes);
api.use('/books', bookRoutes);
api.use('/loans', loanRoutes);
api.use('/students', studentRoutes);
api.use('/recommendations', recommendationRoutes);
api.use('/librarian', staffRoutes);
api.use('/admin', adminRoutes);
api.get('/health', async (_req, res) => {
  let recommendationService = 'unavailable';
  try {
    const { data } = await axios.get(`${process.env.RECOMMENDATION_URL || 'http://127.0.0.1:8000'}/health`, { timeout: 1200 });
    recommendationService = data.ok ? 'connected' : 'unavailable';
  } catch { /* Recommendation outage does not take the library API down. */ }
  res.json({ ok: true, service: 'bookwise-express-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', recommendationService });
});
app.use('/api/v1', api);

app.use((req, res) => res.status(404).json({ message: `No route for ${req.method} ${req.path}` }));
app.use((error, _req, res, _next) => {
  if (error?.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || 'value';
    return res.status(409).json({ message: `That ${field} is already in use.` });
  }
  console.error(error);
  if (error?.name === 'ValidationError') return res.status(400).json({ message: error.message });
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid record ID.' });
  return res.status(500).json({ message: 'The server could not complete that request.' });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env. See README.md for setup.');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('Set a private JWT_SECRET of at least 32 characters in backend/.env.');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  await expirePickupHolds();
  const pickupExpiryJob = setInterval(() => expirePickupHolds().catch((error) => console.error('Pickup expiry job failed:', error.message)), 60_000);
  pickupExpiryJob.unref();
  app.listen(PORT, '0.0.0.0', () => console.log(`BookWise API listening at http://localhost:${PORT}/api/v1`));
}

if (process.env.NODE_ENV !== 'test') start().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
});

export default app;

