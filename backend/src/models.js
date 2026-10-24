import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['student', 'librarian', 'admin'], default: 'student', index: true },
  status: { type: String, enum: ['active', 'invited', 'suspended', 'deactivated'], default: 'active', index: true },
  studentId: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
  employeeId: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
  department: { type: String, trim: true, maxlength: 120, default: '' },
  branch: { type: String, trim: true, maxlength: 120, default: '' },
  permissions: { type: [String], default: [] },
  forcePasswordChange: { type: Boolean, default: false },
  resetPasswordTokenHash: { type: String, select: false },
  resetPasswordExpiresAt: { type: Date, select: false },
  sessionVersion: { type: Number, default: 0 },
  readingPreferences: { type: [String], default: [] },
  recentlyViewed: [{ type: Schema.Types.ObjectId, ref: 'Book' }],
  lastLoginAt: Date,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, toJSON: { transform(_doc, ret) { delete ret.passwordHash; delete ret.sessionVersion; return ret; } } });

const bookSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  author: { type: String, required: true, trim: true, maxlength: 150 },
  isbn: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
  openLibraryId: { type: String, trim: true, sparse: true, unique: true },
  description: { type: String, default: '', maxlength: 4000 },
  publisher: { type: String, trim: true, default: '' },
  year: { type: Number, min: 0 },
  numberOfPages: { type: Number, min: 1 },
  language: { type: String, trim: true, default: 'english' },
  publicationLanguage: { type: String, trim: true, default: 'English' },
  category: { type: String, trim: true, default: 'Fiction', index: true },
  genre: { type: [String], default: [] },
  departments: { type: [String], default: [], index: true },
  cover: { type: String, default: '' },
  totalCopies: { type: Number, default: 1, min: 0 },
  availableCopies: { type: Number, default: 1, min: 0 },
  branch: { type: String, trim: true, default: 'Main Library', index: true },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  ratingsCount: { type: Number, default: 0, min: 0 },
  popularity: { type: Number, default: 0, min: 0 },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
bookSchema.index({ title: 'text', author: 'text', description: 'text', isbn: 'text', publisher: 'text' });
bookSchema.index({ category: 1, availableCopies: 1, averageRating: -1 });

const loanSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
  branch: { type: String, default: 'Main Library' },
  status: { type: String, enum: ['borrowed', 'returned', 'cancelled'], default: 'borrowed', index: true },
  checkoutAt: { type: Date, default: Date.now },
  dueAt: { type: Date, required: true, index: true },
  returnedAt: Date,
  renewalRequested: { type: Boolean, default: false },
  renewalCount: { type: Number, default: 0 },
  returnRequested: { type: Boolean, default: false },
  returnRequestedAt: Date,
  lateFee: { type: Number, default: 0, min: 0 },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });
loanSchema.index({ user: 1, status: 1 });
loanSchema.index({ status: 1, dueAt: 1 });

const reservationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
  status: { type: String, enum: ['waiting', 'pending_approval', 'ready', 'issuing', 'fulfilled', 'cancelled', 'expired'], default: 'waiting', index: true },
  queueNumber: { type: Number, required: true },
  copyHeld: { type: Boolean, default: false },
  readyAt: Date,
  pickupDeadline: Date,
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  fulfilledAt: Date,
  penaltyFee: { type: Number, default: 0, min: 0 },
  penaltyAt: Date,
}, { timestamps: true });
reservationSchema.index({ user: 1, book: 1, status: 1 });
reservationSchema.index({ book: 1, status: 1, createdAt: 1 });
reservationSchema.index({ user: 1, book: 1 }, { unique: true, name: 'active_reservation_user_book', partialFilterExpression: { status: { $in: ['waiting', 'pending_approval', 'ready', 'issuing'] } } });
const reviewSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true, index: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  text: { type: String, trim: true, default: '', maxlength: 1500 },
  status: { type: String, enum: ['visible', 'reported', 'hidden'], default: 'visible' },
}, { timestamps: true });
reviewSchema.index({ user: 1, book: 1 }, { unique: true });

const wishlistSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  book: { type: Schema.Types.ObjectId, ref: 'Book', required: true },
}, { timestamps: true });
wishlistSchema.index({ user: 1, book: 1 }, { unique: true });

const auditSchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  actorEmail: { type: String, default: '' },
  action: { type: String, required: true },
  targetType: { type: String, required: true },
  targetId: { type: String, default: '' },
  details: { type: Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
}, { timestamps: true });
auditSchema.index({ createdAt: -1 });

const settingsSchema = new Schema({
  key: { type: String, default: 'default', unique: true },
  loanDays: { type: Number, default: 14, min: 1, max: 90 },
  maxActiveLoans: { type: Number, default: 5, min: 1, max: 50 },
  maxRenewals: { type: Number, default: 1, min: 0, max: 10 },
  lateFeePerDay: { type: Number, default: 0.5, min: 0, max: 100 },
  reservationLimit: { type: Number, default: 5, min: 1, max: 50 },
  reservationNoShowFee: { type: Number, default: 5, min: 0, max: 1000 },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export const User = model('User', userSchema);
export const Book = model('Book', bookSchema);
export const Loan = model('Loan', loanSchema);
export const Reservation = model('Reservation', reservationSchema);
export const Review = model('Review', reviewSchema);
export const Wishlist = model('Wishlist', wishlistSchema);
export const AuditLog = model('AuditLog', auditSchema);
export const LibrarySettings = model('LibrarySettings', settingsSchema);


