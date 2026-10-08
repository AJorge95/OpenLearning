import { randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt);
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const HASH_BYTES = 64;

export function normalizeUsername(username) {
  return String(username || '').trim();
}

export function validateCredentials(username, password) {
  const normalized = normalizeUsername(username);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(normalized)) {
    return 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.';
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return 'Password must be between 12 and 256 characters.';
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, HASH_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, cost, blockSize, parallelization, saltHex, hashHex] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !cost || !blockSize || !parallelization || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = Buffer.from(await scryptAsync(password, salt, expected.length, {
      N: Number(cost), r: Number(blockSize), p: Number(parallelization), maxmem: 64 * 1024 * 1024,
    }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function publicUser(user) {
  return user ? { id: user.id, username: user.username, role: user.role, disabled: Boolean(user.disabled) } : null;
}

export async function regenerateSession(req, userId) {
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = userId;
  req.session.csrfToken = randomBytes(32).toString('base64url');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

export function createUser({ username, passwordHash, role = 'learner' }) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(id, username, passwordHash, role);
  return db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(id);
}
