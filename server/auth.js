import { randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.js';

const scryptAsync = promisify(scrypt);
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SALT_BYTES = 16;
const HASH_BYTES = 64;
let dummyPasswordHashPromise;

export function normalizeUsername(username) {
  return typeof username === 'string' ? username.trim() : '';
}

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim() : '';
}

export function validateEmail(email) {
  const normalized = normalizeEmail(email);
  const separator = normalized.indexOf('@');
  const domain = separator >= 0 ? normalized.slice(separator + 1) : '';
  if (normalized.length > 254 || separator < 1 || separator !== normalized.lastIndexOf('@') || separator > 64
    || !/^[^\s@]+$/.test(normalized.slice(0, separator)) || !domain.includes('.')
    || domain.split('.').some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    return 'Enter a valid email address (up to 254 characters).';
  }
  return null;
}

export function validateCredentials(username, password) {
  const normalized = normalizeUsername(username);
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(normalized)) {
    return 'Username must be 3–32 characters using letters, numbers, dots, underscores, or hyphens.';
  }
  return validatePassword(password);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    return 'Password must be between 12 and 256 characters.';
  }
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt, HASH_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

function parsePasswordHash(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 256) return null;
  const parts = encoded.split('$');
  if (parts.length !== 6) return null;
  const [algorithm, cost, blockSize, parallelization, saltHex, hashHex] = parts;
  if (algorithm !== 'scrypt'
    || cost !== String(SCRYPT_COST)
    || blockSize !== String(SCRYPT_BLOCK_SIZE)
    || parallelization !== String(SCRYPT_PARALLELIZATION)
    || saltHex.length !== SALT_BYTES * 2
    || hashHex.length !== HASH_BYTES * 2
    || !/^[a-f0-9]+$/i.test(saltHex)
    || !/^[a-f0-9]+$/i.test(hashHex)) return null;
  return { salt: Buffer.from(saltHex, 'hex'), expected: Buffer.from(hashHex, 'hex') };
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  try {
    const actual = Buffer.from(await scryptAsync(password, parsed.salt, parsed.expected.length, {
      N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION, maxmem: 64 * 1024 * 1024,
    }));
    return actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

export async function verifyLoginPassword(password, user) {
  dummyPasswordHashPromise ??= hashPassword(randomBytes(32).toString('base64url'));
  const dummyPasswordHash = await dummyPasswordHashPromise;
  const usableAccount = Boolean(user && !user.disabled && parsePasswordHash(user.password_hash));
  const hash = usableAccount ? user.password_hash : dummyPasswordHash;
  const matches = await verifyPassword(password, hash);
  return usableAccount && matches;
}

export function publicUser(user) {
  return user ? {
    id: user.id,
    username: user.username,
    email: user.email ?? null,
    firstName: user.first_name ?? '',
    lastName: user.last_name ?? '',
    role: user.role,
    disabled: Boolean(user.disabled),
  } : null;
}

export async function regenerateSession(req, userId) {
  await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
  req.session.userId = userId;
  req.session.csrfToken = randomBytes(32).toString('base64url');
  await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
}

export function createUser({ username, email = null, firstName = '', lastName = '', passwordHash, role = 'learner' }) {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, email, first_name, last_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, email, firstName, lastName, passwordHash, role);
  return db.prepare('SELECT id, username, email, first_name, last_name, role, disabled FROM users WHERE id = ?').get(id);
}
