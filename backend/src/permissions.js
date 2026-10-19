export const LIBRARIAN_PERMISSIONS = Object.freeze([
  'books.view', 'books.create', 'books.update', 'inventory.manage',
  'loans.process', 'returns.process', 'reservations.manage',
  'students.view_limited', 'reports.view', 'notifications.send',
]);

export const DEFAULT_LIBRARIAN_PERMISSIONS = Object.freeze([
  'books.view', 'books.create', 'books.update', 'inventory.manage',
  'loans.process', 'returns.process', 'reservations.manage', 'reports.view',
]);

export const ROLE_ROUTES = Object.freeze({
  student: ['/student/dashboard', '/books', '/recommendations', '/my-library', '/wishlist', '/profile'],
  librarian: ['/librarian/dashboard', '/librarian/books', '/librarian/loans', '/librarian/reservations'],
  admin: ['/admin/dashboard', '/admin/users', '/admin/librarians', '/admin/permissions', '/admin/settings', '/admin/audit-logs'],
});

export function hasPermission(user, permission) {
  if (user?.role === 'admin') return true;
  return user?.role === 'librarian' && user.permissions?.includes(permission);
}
