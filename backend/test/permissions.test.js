import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, LIBRARIAN_PERMISSIONS, ROLE_ROUTES } from '../src/permissions.js';

test('administrator bypasses granular librarian permission checks', () => {
  assert.equal(hasPermission({ role: 'admin' }, 'users.manage'), true);
});

test('librarians receive only explicitly granted permissions', () => {
  assert.equal(hasPermission({ role: 'librarian', permissions: ['books.view'] }, 'books.view'), true);
  assert.equal(hasPermission({ role: 'librarian', permissions: ['books.view'] }, 'inventory.manage'), false);
});

test('students cannot use staff permissions', () => {
  assert.equal(hasPermission({ role: 'student', permissions: ['books.create'] }, 'books.create'), false);
});

test('supported permissions and dashboard routes are defined separately by role', () => {
  assert.ok(LIBRARIAN_PERMISSIONS.includes('students.view_limited'));
  assert.ok(ROLE_ROUTES.student.includes('/student/dashboard'));
  assert.ok(ROLE_ROUTES.librarian.includes('/librarian/dashboard'));
  assert.ok(ROLE_ROUTES.admin.includes('/admin/librarians'));
  assert.equal(ROLE_ROUTES.student.includes('/admin/dashboard'), false);
});
