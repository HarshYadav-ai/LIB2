import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';

const databaseUrl = process.env.TEST_MONGODB_URI;
const group = `bwtest-${randomUUID()}`;
let app;
let User; let Book;
let closeServer;
const fixtureUserIds = [];
const fixtureBookIds = [];

test('Mongo-backed auth, role separation, account invitations, and stock are enforced', { skip: !databaseUrl && 'Set TEST_MONGODB_URI to run the database integration tests.' }, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'test-only-secret-that-is-at-least-32-characters-long';
  process.env.MONGODB_URI = databaseUrl;
  ({ default: app } = await import('../src/index.js'));
  ({ User, Book } = await import('../src/models.js'));
  await mongoose.connect(databaseUrl);
  const httpServer = app.listen(0);
  closeServer = () => new Promise((resolve) => httpServer.close(resolve));

  const admin = await User.create({ name: 'Integration Admin', email: `${group}-admin@example.test`, passwordHash: await bcrypt.hash('Integration-Admin-123!', 8), role: 'admin', status: 'active' });
  fixtureUserIds.push(admin._id);
  const adminAgent = request.agent(app);
  await adminAgent.post('/api/v1/auth/login').send({ email: admin.email, password: 'Integration-Admin-123!' }).expect(200);

  const studentAgent = request.agent(app);
  const studentResponse = await studentAgent.post('/api/v1/auth/register').send({ name: 'Student One', email: `${group}-student@example.test`, password: 'Student-Password-123!', role: 'admin', studentId: `${group}-s1` }).expect(201);
  fixtureUserIds.push(studentResponse.body.user.id);
  assert.equal(studentResponse.body.user.role, 'student', 'public registration must ignore a supplied role');
  await studentAgent.post('/api/v1/auth/register').send({ name: 'Duplicate', email: `${group}-student@example.test`, password: 'Student-Password-123!' }).expect(409);
  await studentAgent.get('/api/v1/admin/users').expect(403);
  await studentAgent.post('/api/v1/books').send({ title: 'Unauthorized', author: 'Reader' }).expect(403);

  const studentTwo = request.agent(app);
  const studentTwoResponse = await studentTwo.post('/api/v1/auth/register').send({ name: 'Student Two', email: `${group}-student2@example.test`, password: 'Student-Password-123!', studentId: `${group}-s2` }).expect(201);
  fixtureUserIds.push(studentTwoResponse.body.user.id);

  const book = await Book.create({ title: `${group} Last Copy`, author: 'Integration Author', totalCopies: 1, availableCopies: 1, category: 'Testing' });
  fixtureBookIds.push(book._id);
  const borrowResults = await Promise.all([
    studentAgent.post('/api/v1/loans').send({ bookId: book._id }),
    studentTwo.post('/api/v1/loans').send({ bookId: book._id }),
  ]);
  assert.deepEqual(borrowResults.map((response) => response.status).sort(), [201, 409], 'only one student may borrow the final copy');
  assert.equal((await Book.findById(book._id)).availableCopies, 0);
  const winner = borrowResults[0].status === 201 ? studentAgent : studentTwo;
  const other = winner === studentAgent ? studentTwo : studentAgent;
  const [winnerLoans, otherLoans] = await Promise.all([winner.get('/api/v1/loans/mine'), other.get('/api/v1/loans/mine')]);
  assert.equal(winnerLoans.body.loans.length, 1);
  assert.equal(otherLoans.body.loans.length, 0, 'each student should only see their own loan');

  const invitation = await adminAgent.post('/api/v1/admin/librarians').send({ name: 'Librarian One', email: `${group}-librarian@example.test`, employeeId: `${group}-e1`, branch: 'North Branch', permissions: ['books.view', 'loans.process'] }).expect(201);
  fixtureUserIds.push(invitation.body.librarian.id);
  assert.ok(invitation.body.temporaryPassword);
  const librarianAgent = request.agent(app);
  await librarianAgent.post('/api/v1/auth/login').send({ email: invitation.body.librarian.email, password: invitation.body.temporaryPassword }).expect(200);
  await librarianAgent.get('/api/v1/admin/users').expect(403);
  await librarianAgent.get('/api/v1/librarian/dashboard').expect((response) => {
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'PASSWORD_CHANGE_REQUIRED');
  });
  const passwordUpdate = await librarianAgent.put('/api/v1/auth/password').send({ newPassword: 'New-Librarian-Password-123!', confirmPassword: 'New-Librarian-Password-123!' }).expect(200);
  assert.equal(passwordUpdate.body.user.status, 'active');
  await librarianAgent.get('/api/v1/admin/users').expect(403);
  await librarianAgent.get('/api/v1/loans').expect(200);

  const loan = winnerLoans.body.loans[0];
  await winner.patch(`/api/v1/loans/${loan._id}/return`).expect(200);
  assert.equal((await Book.findById(book._id)).availableCopies, 1);
  assert.ok(book._id);
});

after(async () => {
  if (databaseUrl) {
    const { Reservation, Loan, Wishlist, Review, User, Book, AuditLog } = await import('../src/models.js');
    await Promise.all([
      User.deleteMany({ _id: { $in: fixtureUserIds } }),
      Book.deleteMany({ _id: { $in: fixtureBookIds } }),
      Loan.deleteMany({ $or: [{ user: { $in: fixtureUserIds } }, { book: { $in: fixtureBookIds } }] }),
      Reservation.deleteMany({ $or: [{ user: { $in: fixtureUserIds } }, { book: { $in: fixtureBookIds } }] }),
      Wishlist.deleteMany({ user: { $in: fixtureUserIds } }),
      Review.deleteMany({ user: { $in: fixtureUserIds } }),
      AuditLog.deleteMany({ actor: { $in: fixtureUserIds } }),
    ]).catch(() => {});
    await mongoose.disconnect().catch(() => {});
  }
  if (closeServer) await closeServer();
});
