import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { AuditLog, User } from '../src/models.js';

const { MONGODB_URI } = process.env;
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'BookWise Administrator';
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@bookwise.local';
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || randomBytes(24).toString('base64url');
if (!MONGODB_URI) throw new Error('Set MONGODB_URI in backend/.env before seeding the first admin.');
if (process.env.NODE_ENV === 'production' && (!process.env.BOOTSTRAP_ADMIN_NAME || !process.env.BOOTSTRAP_ADMIN_EMAIL || !process.env.BOOTSTRAP_ADMIN_PASSWORD)) throw new Error('Set explicit bootstrap name, email, and password for a production seed.');
if (password.length < 14) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 14 characters.');

try {
  await mongoose.connect(MONGODB_URI);
  if (await User.exists({ role: 'admin', status: 'active' })) throw new Error('An active admin already exists; the bootstrap script will not change it.');
  let admin = await User.findOne({ email });
  if (admin) {
    admin.name = name;
    admin.role = 'admin'; admin.status = 'active'; admin.forcePasswordChange = false;
    admin.passwordHash = await bcrypt.hash(password, 12);
    admin.sessionVersion += 1;
    await admin.save();
  } else {
    admin = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', status: 'active' });
  }
  await AuditLog.create({ actor: admin._id, actorEmail: admin.email, action: 'admin.bootstrap_created', targetType: 'User', targetId: String(admin._id), details: { method: 'local seed script' } });
  console.log(`Admin account ready: ${admin.email}`);
  if (!process.env.BOOTSTRAP_ADMIN_PASSWORD) console.log(`One-time generated password: ${password}`);
  else console.log('Use the password from backend/.env to sign in.');
  console.log('Store this credential securely, then remove any bootstrap password from backend/.env.');
} finally {
  await mongoose.disconnect();
}

