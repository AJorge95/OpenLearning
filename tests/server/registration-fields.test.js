import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import express from 'express';
import session from 'express-session';
import { after, before, test } from 'node:test';

const isolatedConfig = {
  NODE_ENV: 'test',
  DATA_DIR: '',
  DB_PATH: '',
  MEDIA_ROOT: '',
  SESSION_SECRET: 'isolated-registration-field-tests',
  TRUST_PROXY: 'false',
  PORT: '3000',
  MAX_UPLOAD_BYTES: '2147483648',
  REQUEST_TIMEOUT_MS: '300000',
};
const previousConfig = new Map(Object.keys(isolatedConfig).map((key) => [key, process.env[key]]));
let fixtureDirectory;
let database;
let setSetting;
let hashPassword;
let verifyPassword;
let registrationFields;
let adminPasswordResetLimiter;
let server;

const fieldDefinitions = [
  { id: 'department', label: 'Department', type: 'select', required: true, options: ['Research', 'Design'] },
  { id: 'acknowledgement', label: 'I agree to the learning policy', type: 'checkbox', required: true, options: [] },
  { id: 'start-date', label: 'Start date', type: 'date', required: false, options: [] },
  { id: 'about', label: 'About you', type: 'text', required: false, options: [] },
];
const onePixelJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD58ooor9bPyo//2Q==', 'base64');

const onePixelWebp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64');

function createExtendedPlatformWebp() {
  const imageChunk = onePixelWebp.subarray(12, 42);
  const bytes = Buffer.alloc(12 + 18 + imageChunk.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  imageChunk.copy(bytes, 30);
  return bytes;
}

function createAnimatedPlatformWebp() {
  const imageChunk = onePixelWebp.subarray(12, 42);
  const bytes = Buffer.alloc(12 + 18 + 14 + 8 + 16 + imageChunk.length);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUInt32LE(10, 16);
  bytes[20] = 0x02;
  bytes.write('ANIM', 30, 'ascii');
  bytes.writeUInt32LE(6, 34);
  bytes.write('ANMF', 44, 'ascii');
  bytes.writeUInt32LE(16 + imageChunk.length, 48);
  bytes.writeUIntLE(100, 64, 3);
  imageChunk.copy(bytes, 68);
  return bytes;
}

function createFixtureDirectory() {
  const tempBase = path.resolve(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-registration-fields-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-registration-fields-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  return resolvedDirectory;
}

function removeFixtureDirectory(directory) {
  if (!directory) return;
  const tempBase = path.resolve(os.tmpdir());
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase
    || !path.basename(resolvedDirectory).startsWith('openlearning-registration-fields-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

function apiUrl(pathname) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/api${pathname}`;
}

function assertApiError(action, code, status = 400) {
  assert.throws(action, (error) => error?.status === status && error?.code === code);
}

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function createPlatformIconPng(red, green, blue, width = 1, height = 1, interlace = 0) {
  const passes = interlace === 0
    ? [[0, 0, 1, 1]]
    : [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
  const scanlines = [];
  for (const [startX, startY, stepX, stepY] of passes) {
    const passWidth = width <= startX ? 0 : Math.ceil((width - startX) / stepX);
    const passHeight = passWidth === 0 || height <= startY ? 0 : Math.ceil((height - startY) / stepY);
    const scanline = Buffer.alloc(1 + passWidth * 4);
    for (let x = 0; x < passWidth; x += 1) scanline.set([red, green, blue, 255], 1 + x * 4);
    for (let y = 0; y < passHeight; y += 1) scanlines.push(scanline);
  }
  const imageData = Buffer.concat(scanlines);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', Buffer.from([
      (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
      (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
      8, 6, 0, 0, interlace,
    ])),
    pngChunk('IDAT', deflateSync(imageData)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database, setSetting } = await import('../../server/db.js'));
  ({ hashPassword, verifyPassword } = await import('../../server/auth.js'));
  registrationFields = await import('../../server/registration-fields.js');
  ({ adminPasswordResetLimiter } = await import('../../server/rate-limits.js'));
  const { authRouter } = await import('../../server/routes-auth.js');
  const { adminRouter } = await import('../../server/routes-admin.js');
  const { errorHandler } = await import('../../server/http.js');

  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')`).run(
    'registration-fields-admin',
    'registration_fields_admin',
    'admin.registration@example.invalid',
    'not-used-by-this-fixture',
  );
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'learner')`).run(
    'registration-fields-role-target',
    'registration_fields_role_target',
    'role-target@example.invalid',
    'not-used-by-this-fixture',
  );
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'learner')`).run(
    'registration-fields-password-target',
    'registration_fields_password_target',
    'password-target@example.invalid',
    'original-password-hash',
  );
  setSetting('setup_complete', '1');
  setSetting('registration_enabled', '1');
  registrationFields.saveRegistrationFields(fieldDefinitions);

  const app = express();
  app.use(express.json());
  app.use(session({ secret: isolatedConfig.SESSION_SECRET, resave: false, saveUninitialized: false }));
  app.use('/api', (req, _res, next) => {
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?')
      .get(req.get('x-test-user') || 'registration-fields-admin');
    next();
  });
  app.use('/api', authRouter);
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);
  server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  if (server?.listening) {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  }
  if (database?.open) database.close();
  removeFixtureDirectory(fixtureDirectory);
  for (const [key, value] of previousConfig) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('registration field definitions trim values and reject duplicate or invalid choices', () => {
  const normalized = registrationFields.normalizeRegistrationFields([
    { id: ' department ', label: ' Department ', type: 'select', required: true, options: [' Research ', 'Design'] },
  ]);
  assert.deepEqual(normalized, [
    { id: 'department', label: 'Department', type: 'select', required: true, options: ['Research', 'Design'] },
  ]);

  assertApiError(() => registrationFields.normalizeRegistrationFields([
    { id: 'same', label: 'First', type: 'text', required: false },
    { id: 'same', label: 'Second', type: 'text', required: false },
  ]), 'invalid_registration_fields');
  assertApiError(() => registrationFields.normalizeRegistrationFields([
    { id: 'first', label: 'Department', type: 'text', required: false },
    { id: 'second', label: ' department ', type: 'text', required: false },
  ]), 'invalid_registration_fields');
  assertApiError(() => registrationFields.normalizeRegistrationFields([
    { id: 'department', label: 'Department', type: 'select', required: true, options: ['Research', ' research '] },
  ]), 'invalid_registration_fields');
  assertApiError(() => registrationFields.normalizeRegistrationFields([
    { id: 'website', label: 'Website', type: 'url', required: false, options: [] },
  ]), 'invalid_registration_fields');
});

test('registration label and option uniqueness is independent of server locale', () => {
  const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function toTurkishLowerCase() {
    return originalToLocaleLowerCase.call(this, 'tr');
  };
  try {
    const fields = registrationFields.normalizeRegistrationFields([
      { id: 'first', label: 'I', type: 'text', required: false, options: [] },
      { id: 'second', label: 'ı', type: 'text', required: false, options: [] },
    ]);
    assert.equal(fields.length, 2);
    const select = registrationFields.normalizeRegistrationFields([
      { id: 'interest', label: 'Interest', type: 'select', required: false, options: ['I', 'ı'] },
    ]);
    assert.deepEqual(select[0].options, ['I', 'ı']);
  } finally {
    String.prototype.toLocaleLowerCase = originalToLocaleLowerCase;
  }
});

test('registration writes reject canonical duplicates while stored values remain readable', () => {
  const originalFields = database.prepare('SELECT value FROM app_settings WHERE key = ?').get('registration_fields').value;
  const legacyFields = [
    { id: 'interest', label: 'Interest', type: 'select', required: false, options: ['Café', 'Cafe\u0301', 'Research'] },
  ];

  assertApiError(() => registrationFields.normalizeRegistrationFields(legacyFields), 'invalid_registration_fields');
  assertApiError(() => registrationFields.normalizeRegistrationFields([
    { id: 'first', label: 'Café', type: 'text', required: false },
    { id: 'second', label: 'Cafe\u0301', type: 'text', required: false },
  ]), 'invalid_registration_fields');
  try {
    setSetting('registration_fields', JSON.stringify(legacyFields));
    const loaded = registrationFields.getRegistrationFields();
    assert.deepEqual(loaded, legacyFields);
    assert.deepEqual(registrationFields.normalizeRegistrationFieldValues({ interest: 'Cafe\u0301' }, loaded)
      .map((field) => field.value), ['Cafe\u0301']);
  } finally {
    setSetting('registration_fields', originalFields);
  }
});

test('invalid stored registration fields pause public signup and stay recoverable in admin settings', async () => {
  setSetting('registration_fields', '{invalid json');
  assert.deepEqual(registrationFields.readRegistrationFields(), { fields: [], configurationValid: false });
  assertApiError(() => registrationFields.getRegistrationFields(), 'registration_fields_unavailable', 503);

  const publicFieldsResponse = await fetch(apiUrl('/registration-fields'));
  assert.equal(publicFieldsResponse.status, 503);
  assert.equal((await publicFieldsResponse.json()).code, 'registration_fields_unavailable');

  const invalidAdminResponse = await fetch(apiUrl('/admin/registration-fields'));
  assert.equal(invalidAdminResponse.status, 200);
  assert.deepEqual(await invalidAdminResponse.json(), { fields: [], configurationValid: false });

  const registrationResponse = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      email: 'invalid-config@example.invalid',
      firstName: 'Invalid',
      lastName: 'Config',
      username: 'invalid_config_learner',
      password: 'RegistrationPassphrase-2026',
      confirmPassword: 'RegistrationPassphrase-2026',
      registrationFieldValues: {},
    }),
  });
  assert.equal(registrationResponse.status, 503);
  assert.equal((await registrationResponse.json()).code, 'registration_fields_unavailable');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('invalid_config_learner').count, 0);

  const recoveryResponse = await fetch(apiUrl('/admin/registration-fields'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ fields: fieldDefinitions }),
  });
  assert.equal(recoveryResponse.status, 200);
  assert.deepEqual(registrationFields.getRegistrationFields(), fieldDefinitions);
});

test('saving equivalent registration fields skips setting writes and audit events', async () => {
  const currentSetting = database.prepare('SELECT value FROM app_settings WHERE key = ?').get('registration_fields').value;
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.registration_fields_updated'`).get().count;
  database.exec(`
    CREATE TRIGGER fail_registration_fields_setting_update
      BEFORE UPDATE ON app_settings WHEN OLD.key = 'registration_fields'
      BEGIN SELECT RAISE(ABORT, 'setting write'); END;
    CREATE TRIGGER fail_registration_fields_noop_audit
      BEFORE INSERT ON audit_logs WHEN NEW.action = 'platform.registration_fields_updated'
      BEGIN SELECT RAISE(ABORT, 'audit write'); END;
  `);

  try {
    const equivalentFields = fieldDefinitions.map((field) => ({
      ...field,
      label: ` ${field.label} `,
      options: field.options.map((option) => ` ${option} `),
    }));
    const response = await fetch(apiUrl('/admin/registration-fields'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ fields: equivalentFields }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).fields, fieldDefinitions);
    assert.equal(database.prepare('SELECT value FROM app_settings WHERE key = ?').get('registration_fields').value, currentSetting);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'platform.registration_fields_updated'`).get().count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_registration_fields_setting_update; DROP TRIGGER fail_registration_fields_noop_audit;');
  }
});

test('registration field saves roll back when the required audit entry cannot be written', async () => {
  const originalFields = registrationFields.getRegistrationFields();
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.registration_fields_updated'`).get().count;
  database.exec(`CREATE TRIGGER fail_registration_fields_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'platform.registration_fields_updated'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const response = await fetch(apiUrl('/admin/registration-fields'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ fields: [{ ...originalFields[0], label: 'Changed department' }] }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.deepEqual(registrationFields.getRegistrationFields(), originalFields);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'platform.registration_fields_updated'`).get().count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_registration_fields_audit');
  }
});

test('platform setting changes roll back when their required audit entry cannot be written', async () => {
  const currentSetting = (key) => database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  setSetting('platform_name', 'Original learning space');
  setSetting('theme_palette', 'violet');
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.settings_updated'`).get().count;
  database.exec(`CREATE TRIGGER fail_platform_settings_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'platform.settings_updated'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const request = () => fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ platformName: 'Updated learning space', themePalette: 'ocean' }),
    });
    const failedResponse = await request();
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(currentSetting('platform_name'), 'Original learning space');
    assert.equal(currentSetting('theme_palette'), 'violet');
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'platform.settings_updated'`).get().count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_platform_settings_audit');
  }

  const savedResponse = await fetch(apiUrl('/admin/settings'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ platformName: 'Updated learning space', themePalette: 'ocean' }),
  });
  assert.equal(savedResponse.status, 200);
  assert.equal(currentSetting('platform_name'), 'Updated learning space');
  assert.equal(currentSetting('theme_palette'), 'ocean');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.settings_updated'`).get().count, originalAuditCount + 1);
});

test('platform settings reject malformed and oversized icons without changing branding or audit history', async () => {
  const settingValue = (key) => database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  const originalName = settingValue('platform_name');
  const originalIcon = settingValue('platform_icon');
  const originalVersion = settingValue('platform_icon_version');
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.settings_updated'`).get().count;
  const truncatedWebp = Buffer.alloc(12);
  truncatedWebp.write('RIFF', 0, 'ascii');
  truncatedWebp.writeUInt32LE(4, 4);
  truncatedWebp.write('WEBP', 8, 'ascii');
  const oversizedPng = createPlatformIconPng(0, 0, 0, 1025, 1);
  const corruptedPngCrc = createPlatformIconPng(10, 20, 30);
  corruptedPngCrc[29] ^= 1;
  const pngWithoutImageData = createPlatformIconPng(10, 20, 30);
  const missingPngDataChunk = Buffer.concat([pngWithoutImageData.subarray(0, 33), pngWithoutImageData.subarray(-12)]);
  const invalidCompressedPng = Buffer.concat([
    pngWithoutImageData.subarray(0, 33),
    pngChunk('IDAT', Buffer.from([0xff, 0xff, 0xff])),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const excessivePngImageData = Buffer.concat([
    pngWithoutImageData.subarray(0, 33),
    pngChunk('IDAT', deflateSync(Buffer.alloc(100_000))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const invalidPngFilter = Buffer.concat([
    pngWithoutImageData.subarray(0, 33),
    pngChunk('IDAT', deflateSync(Buffer.from([5, 10, 20, 30, 40]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  const jpegFrameOffset = onePixelJpeg.indexOf(Buffer.from([0xff, 0xc0]));
  const jpegScanOffset = onePixelJpeg.indexOf(Buffer.from([0xff, 0xda]));
  assert.notEqual(jpegFrameOffset, -1, 'expected the JPEG fixture to contain a frame header');
  assert.notEqual(jpegScanOffset, -1, 'expected the JPEG fixture to contain a scan header');
  const jpegScanDataOffset = jpegScanOffset + 2 + onePixelJpeg.readUInt16BE(jpegScanOffset + 2);
  const jpegWithoutScan = Buffer.concat([onePixelJpeg.subarray(0, jpegScanOffset), Buffer.from([0xff, 0xd9])]);
  const jpegWithoutScanData = Buffer.concat([onePixelJpeg.subarray(0, jpegScanDataOffset), Buffer.from([0xff, 0xd9])]);
  const jpegWithTrailingBytes = Buffer.concat([onePixelJpeg, Buffer.from([0])]);
  const oversizedJpeg = Buffer.from(onePixelJpeg);
  oversizedJpeg.writeUInt16BE(1025, jpegFrameOffset + 7);
  const oversizedWebp = Buffer.from(onePixelWebp);
  oversizedWebp.writeUInt16LE(1025, 26);
  const webpWithoutImageData = Buffer.alloc(30);
  webpWithoutImageData.write('RIFF', 0, 'ascii');
  webpWithoutImageData.writeUInt32LE(22, 4);
  webpWithoutImageData.write('WEBP', 8, 'ascii');
  webpWithoutImageData.write('VP8X', 12, 'ascii');
  webpWithoutImageData.writeUInt32LE(10, 16);
  const webpWithoutBitstream = Buffer.from(onePixelWebp.subarray(0, 30));
  webpWithoutBitstream.writeUInt32LE(22, 4);
  webpWithoutBitstream.writeUInt32LE(10, 16);
  const invalidIcons = [
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['png', corruptedPngCrc],
    ['png', missingPngDataChunk],
    ['png', invalidCompressedPng],
    ['png', excessivePngImageData],
    ['png', invalidPngFilter],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['jpeg', jpegWithoutScan],
    ['jpeg', jpegWithoutScanData],
    ['jpeg', jpegWithTrailingBytes],
    ['webp', truncatedWebp],
    ['webp', webpWithoutImageData],
    ['webp', webpWithoutBitstream],
    ['png', oversizedPng],
    ['jpeg', oversizedJpeg],
    ['webp', oversizedWebp],
  ];

  for (const [type, bytes] of invalidIcons) {
    const response = await fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ platformName: 'Icon validation test', platformIcon: `data:image/${type};base64,${bytes.toString('base64')}` }),
    });
    assert.equal(response.status, 400, type);
    assert.equal((await response.json()).code, 'invalid_platform_icon', type);
  }

  assert.equal(settingValue('platform_name'), originalName);
  assert.equal(settingValue('platform_icon'), originalIcon);
  assert.equal(settingValue('platform_icon_version'), originalVersion);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'platform.settings_updated'`).get().count, originalAuditCount);
});

test('platform settings accept a complete JPEG icon and serve its original bytes', async () => {
  const settingValue = (key) => database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  const originalName = settingValue('platform_name');
  const originalIcon = settingValue('platform_icon');
  const originalVersion = settingValue('platform_icon_version');

  try {
    const response = await fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        platformName: 'JPEG acceptance test',
        platformIcon: `data:image/jpeg;base64,${onePixelJpeg.toString('base64')}`,
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const branding = await response.json();
    const iconResponse = await fetch(new URL(branding.platformIcon, apiUrl('/')));
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await iconResponse.arrayBuffer()), onePixelJpeg);
  } finally {
    if (originalName === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_name'").run();
    else setSetting('platform_name', originalName);
    if (originalIcon === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_icon'").run();
    else setSetting('platform_icon', originalIcon);
    if (originalVersion === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_icon_version'").run();
    else setSetting('platform_icon_version', originalVersion);
  }
});

test('platform settings accept a complete WebP icon and serve its original bytes', async () => {
  const settingValue = (key) => database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  const originalName = settingValue('platform_name');
  const originalIcon = settingValue('platform_icon');
  const originalVersion = settingValue('platform_icon_version');

  try {
    const response = await fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        platformName: 'WebP acceptance test',
        platformIcon: `data:image/webp;base64,${onePixelWebp.toString('base64')}`,
      }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    const branding = await response.json();
    const iconResponse = await fetch(new URL(branding.platformIcon, apiUrl('/')));
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await iconResponse.arrayBuffer()), onePixelWebp);

    const extendedWebp = createExtendedPlatformWebp();
    const extendedResponse = await fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        platformName: 'Extended WebP acceptance test',
        platformIcon: `data:image/webp;base64,${extendedWebp.toString('base64')}`,
      }),
    });
    assert.equal(extendedResponse.status, 200, await extendedResponse.clone().text());
    const extendedBranding = await extendedResponse.json();
    const extendedIconResponse = await fetch(new URL(extendedBranding.platformIcon, apiUrl('/')));
    assert.equal(extendedIconResponse.status, 200);
    assert.equal(extendedIconResponse.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await extendedIconResponse.arrayBuffer()), extendedWebp);

    const animatedWebp = createAnimatedPlatformWebp();
    const animatedResponse = await fetch(apiUrl('/admin/settings'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        platformName: 'Animated WebP acceptance test',
        platformIcon: `data:image/webp;base64,${animatedWebp.toString('base64')}`,
      }),
    });
    assert.equal(animatedResponse.status, 200, await animatedResponse.clone().text());
    const animatedBranding = await animatedResponse.json();
    const animatedIconResponse = await fetch(new URL(animatedBranding.platformIcon, apiUrl('/')));
    assert.equal(animatedIconResponse.status, 200);
    assert.equal(animatedIconResponse.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await animatedIconResponse.arrayBuffer()), animatedWebp);
  } finally {
    if (originalName === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_name'").run();
    else setSetting('platform_name', originalName);
    if (originalIcon === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_icon'").run();
    else setSetting('platform_icon', originalIcon);
    if (originalVersion === null) database.prepare("DELETE FROM app_settings WHERE key = 'platform_icon_version'").run();
    else setSetting('platform_icon_version', originalVersion);
  }
});

test('platform icon URLs remain stable across unrelated changes and change when the icon is replaced', async () => {
  const settingValue = (key) => database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null;
  const originalName = settingValue('platform_name');
  const originalIcon = settingValue('platform_icon');
  const originalVersion = settingValue('platform_icon_version');
  const firstIcon = createPlatformIconPng(31, 116, 75);
  const secondIcon = createPlatformIconPng(26, 89, 142, 3, 3, 1);
  const iconDataUrl = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
  const updateSettings = (body) => fetch(apiUrl('/admin/settings'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });
  const restoreSetting = (key, value) => {
    if (value === null) database.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
    else setSetting(key, value);
  };

  try {
    const initialResponse = await updateSettings({
      platformName: 'Icon cache test',
      platformIcon: iconDataUrl(firstIcon),
    });
    assert.equal(initialResponse.status, 200);
    const initialBranding = await initialResponse.json();
    const initialUrl = initialBranding.platformIcon;
    assert.match(initialUrl, /^\/api\/branding\/icon\?v=[0-9a-f-]+$/);
    const initialVersion = new URL(initialUrl, 'http://127.0.0.1').searchParams.get('v');
    assert.ok(initialVersion);

    const firstIconResponse = await fetch(new URL(initialUrl, apiUrl('/')));
    assert.equal(firstIconResponse.status, 200);
    assert.equal(firstIconResponse.headers.get('content-type'), 'image/png');
    assert.equal(firstIconResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.deepEqual(Buffer.from(await firstIconResponse.arrayBuffer()), firstIcon);

    const unrelatedUpdate = await updateSettings({ platformName: 'Renamed cache test' });
    assert.equal(unrelatedUpdate.status, 200);
    assert.equal((await unrelatedUpdate.json()).platformIcon, initialUrl);

    const replacementResponse = await updateSettings({
      platformName: 'Renamed cache test',
      platformIcon: iconDataUrl(secondIcon),
    });
    assert.equal(replacementResponse.status, 200, await replacementResponse.clone().text());
    const replacementUrl = (await replacementResponse.json()).platformIcon;
    const replacementVersion = new URL(replacementUrl, 'http://127.0.0.1').searchParams.get('v');
    assert.notEqual(replacementVersion, initialVersion);

    const replacedIconResponse = await fetch(new URL(replacementUrl, apiUrl('/')));
    assert.equal(replacedIconResponse.status, 200);
    assert.equal(replacedIconResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.deepEqual(Buffer.from(await replacedIconResponse.arrayBuffer()), secondIcon);
  } finally {
    restoreSetting('platform_name', originalName);
    restoreSetting('platform_icon', originalIcon);
    restoreSetting('platform_icon_version', originalVersion);
  }
});

test('the last active administrator cannot be disabled or demoted', async () => {
  const adminId = 'registration-fields-admin';
  const originalUser = database.prepare('SELECT role, disabled FROM users WHERE id = ?').get(adminId);
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = ?`).get(adminId).count;
  const detailsResponse = await fetch(apiUrl(`/admin/users/${adminId}`));
  assert.equal(detailsResponse.status, 200);
  assert.equal((await detailsResponse.json()).user.isLastActiveAdmin, true);

  for (const change of [{ disabled: true }, { role: 'moderator' }]) {
    const response = await fetch(apiUrl(`/admin/users/${adminId}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(change),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: 'The last active administrator cannot be disabled or demoted.',
      code: 'last_admin',
    });
    assert.deepEqual(database.prepare('SELECT role, disabled FROM users WHERE id = ?').get(adminId), originalUser);
  }

  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = ?`).get(adminId).count, originalAuditCount);
});

test('an administrator can be disabled while another active administrator remains', async () => {
  const targetId = 'registration-fields-second-admin';
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')`).run(targetId, 'second_admin', 'second.admin@example.invalid', 'not-used-by-this-fixture');

  try {
    const adminsBeforeUpdate = await fetch(apiUrl('/admin/users?role=admin'));
    assert.equal(adminsBeforeUpdate.status, 200);
    assert.deepEqual((await adminsBeforeUpdate.json()).users.map((user) => [user.id, user.isLastActiveAdmin]), [
      ['registration-fields-admin', false],
      [targetId, false],
    ]);

    for (const userId of ['registration-fields-admin', targetId]) {
      const details = await fetch(apiUrl(`/admin/users/${userId}`));
      assert.equal(details.status, 200);
      assert.equal((await details.json()).user.isLastActiveAdmin, false);
    }

    const response = await fetch(apiUrl(`/admin/users/${targetId}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(response.status, 200);
    const updatedTarget = await response.json();
    assert.equal(updatedTarget.user.disabled, true);
    assert.equal(updatedTarget.user.isLastActiveAdmin, false);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0").get().count, 1);
    const remainingAdmins = await fetch(apiUrl('/admin/users?role=admin'));
    assert.equal(remainingAdmins.status, 200);
    assert.deepEqual((await remainingAdmins.json()).users.map((user) => [user.id, user.isLastActiveAdmin]), [
      ['registration-fields-admin', true],
      [targetId, false],
    ]);
    const remainingAdmin = await fetch(apiUrl('/admin/users/registration-fields-admin'));
    assert.equal(remainingAdmin.status, 200);
    assert.equal((await remainingAdmin.json()).user.isLastActiveAdmin, true);
  } finally {
    database.prepare("DELETE FROM audit_logs WHERE action = 'account.updated' AND entity_id = ?").run(targetId);
    database.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  }
});

test('account changes and session revocations roll back when their required audit entry cannot be written', async () => {
  database.prepare(`INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)`)
    .run('account-update-session', JSON.stringify({ userId: 'registration-fields-role-target' }), Date.now() + 60_000, 'registration-fields-role-target');
  const originalUser = database.prepare('SELECT role, disabled, updated_at FROM users WHERE id = ?')
    .get('registration-fields-role-target');
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = 'registration-fields-role-target'`).get().count;
  database.exec(`CREATE TRIGGER fail_account_update_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.updated' AND NEW.entity_id = 'registration-fields-role-target'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const response = await fetch(apiUrl('/admin/users/registration-fields-role-target'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.deepEqual(database.prepare('SELECT role, disabled, updated_at FROM users WHERE id = ?')
      .get('registration-fields-role-target'), originalUser);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get('account-update-session').count, 1);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'account.updated' AND entity_id = 'registration-fields-role-target'`).get().count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_account_update_audit');
  }

  const savedResponse = await fetch(apiUrl('/admin/users/registration-fields-role-target'), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ disabled: true }),
  });
  assert.equal(savedResponse.status, 200);
  assert.equal((await savedResponse.json()).user.disabled, true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get('account-update-session').count, 0);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = 'registration-fields-role-target'`).get().count, originalAuditCount + 1);
});

test('certificate-name updates roll back with certificate backfill failures and can be retried', async () => {
  const userId = 'registration-fields-certificate-target';
  const courseId = 'registration-fields-certificate-course';
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'learner')`).run(userId, 'registration_fields_certificate_target', 'certificate-target@example.invalid', 'not-used');
  database.prepare(`INSERT INTO courses (id, title, status, created_by, updated_by)
    VALUES (?, 'Certificate Backfill', 'published', 'registration-fields-admin', 'registration-fields-admin')`).run(courseId);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('registration-fields-certificate-module', ?, 'Module', 0)`).run(courseId);
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES ('registration-fields-certificate-lesson', 'registration-fields-certificate-module', 'Lesson', 0)`).run();
  database.prepare(`INSERT INTO course_versions
    (id, course_id, storage_course_id, version_number, published_by, requires_recompletion, change_note)
    VALUES ('registration-fields-certificate-version', ?, ?, 1, 'registration-fields-admin', 0, 'Initial publication')`)
    .run(courseId, courseId);
  database.prepare('INSERT INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
    .run('registration-fields-certificate-enrollment', courseId, userId);
  database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)')
    .run(userId, 'registration-fields-certificate-lesson');
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = ?`).get(userId).count;
  const originalConsoleError = console.error;
  database.exec(`CREATE TRIGGER fail_profile_certificate_insert
    BEFORE INSERT ON course_certificates WHEN NEW.user_id = '${userId}'
    BEGIN SELECT RAISE(ABORT, 'certificate storage unavailable'); END`);

  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl(`/admin/users/${userId}`), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ firstName: 'Morgan', lastName: 'Reed' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'internal_error');
    assert.deepEqual(database.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(userId), {
      first_name: '', last_name: '',
    });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'account.updated' AND entity_id = ?`).get(userId).count, originalAuditCount);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_certificates WHERE user_id = ?').get(userId).count, 0);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_profile_certificate_insert');
  }

  const retryResponse = await fetch(apiUrl(`/admin/users/${userId}`), {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ firstName: 'Morgan', lastName: 'Reed' }),
  });
  assert.equal(retryResponse.status, 200);
  assert.equal((await retryResponse.json()).certificatesIssued, 1);
  assert.deepEqual(database.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(userId), {
    first_name: 'Morgan', last_name: 'Reed',
  });
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.updated' AND entity_id = ?`).get(userId).count, originalAuditCount + 1);
  assert.equal(database.prepare('SELECT recipient_name FROM course_certificates WHERE user_id = ?').get(userId).recipient_name, 'Morgan Reed');
});

test('administrator password resets and session revocations roll back when audit persistence fails', async () => {
  const userId = 'registration-fields-password-target';
  const originalPasswordHash = database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash;
  database.prepare('INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)')
    .run('password-reset-session', JSON.stringify({ userId }), Date.now() + 60_000, userId);
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.password_reset' AND entity_id = ?`).get(userId).count;
  database.exec(`CREATE TRIGGER fail_password_reset_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.password_reset' AND NEW.entity_id = 'registration-fields-password-target'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const response = await fetch(apiUrl(`/admin/users/${userId}/password`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ password: 'AdminResetPassphrase-2026', confirmPassword: 'AdminResetPassphrase-2026' }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash, originalPasswordHash);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get('password-reset-session').count, 1);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'account.password_reset' AND entity_id = ?`).get(userId).count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_password_reset_audit');
  }

  const savedResponse = await fetch(apiUrl(`/admin/users/${userId}/password`), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ password: 'AdminResetPassphrase-2026', confirmPassword: 'AdminResetPassphrase-2026' }),
  });
  assert.equal(savedResponse.status, 204);
  const savedPasswordHash = database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash;
  assert.notEqual(savedPasswordHash, originalPasswordHash);
  assert.equal(await verifyPassword('AdminResetPassphrase-2026', savedPasswordHash), true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE sid = ?').get('password-reset-session').count, 0);
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.password_reset' AND entity_id = ?`).get(userId).count, originalAuditCount + 1);
});

test('administrator password reset validates password length for legacy usernames', async () => {
  const userId = 'registration-fields-password-target';
  const user = database.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(userId);
  database.prepare('UPDATE users SET username = ? WHERE id = ?').run('legacy username', userId);

  try {
    const response = await fetch(apiUrl(`/admin/users/${userId}/password`), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ password: 'short', confirmPassword: 'short' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Password must be between 12 and 256 characters.',
      code: 'invalid_password',
    });
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash, user.password_hash);
  } finally {
    database.prepare('UPDATE users SET username = ? WHERE id = ?').run(user.username, userId);
  }
  assert.equal(database.prepare('SELECT username FROM users WHERE id = ?').get(userId).username, user.username);
});

test('self-service password change validates password length for legacy usernames', async () => {
  const userId = 'registration-fields-admin';
  const user = database.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(userId);
  const currentPasswordHash = await hashPassword('KnownCurrentPassphrase-2026');
  database.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?')
    .run('legacy username', currentPasswordHash, userId);

  try {
    const response = await fetch(apiUrl('/auth/password'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        currentPassword: 'KnownCurrentPassphrase-2026',
        password: 'short',
        confirmPassword: 'short',
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Password must be between 12 and 256 characters.',
      code: 'invalid_password',
    });
    assert.equal(database.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId).password_hash, currentPasswordHash);
  } finally {
    database.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?')
      .run(user.username, user.password_hash, userId);
  }
  assert.deepEqual(database.prepare('SELECT username, password_hash FROM users WHERE id = ?').get(userId), user);
});

test('administrator password reset route throttles requests per admin before target lookup', async () => {
  const limiterKey = 'user:registration-fields-admin';
  adminPasswordResetLimiter.resetKey(limiterKey);
  const requestReset = () => fetch(apiUrl('/admin/users/missing-password-target/password'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ password: 'not-a-valid-reset', confirmPassword: 'different' }),
  });

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await requestReset();
      assert.equal(response.status, 404);
    }

    const limitedResponse = await requestReset();
    assert.equal(limitedResponse.status, 429);
    assert.deepEqual(await limitedResponse.json(), {
      error: 'Too many administrator password resets. Please wait before trying again.',
      code: 'rate_limited',
    });
  } finally {
    adminPasswordResetLimiter.resetKey(limiterKey);
  }
});

test('administrator account creation rolls back when its required audit entry cannot be written', async () => {
  const username = 'audit_failure_account';
  const email = 'audit-failure-account@example.invalid';
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.created'`).get().count;
  database.exec(`CREATE TRIGGER fail_account_creation_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.created'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const response = await fetch(apiUrl('/admin/users'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        username,
        email,
        firstName: 'Admin',
        lastName: 'Created',
        password: 'AdminCreatedAccountPassphrase-2026',
        confirmPassword: 'AdminCreatedAccountPassphrase-2026',
        role: 'learner',
      }),
    });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get(username).count, 0);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.created'`).get().count, originalAuditCount);
  } finally {
    database.exec('DROP TRIGGER fail_account_creation_audit');
  }

  const savedResponse = await fetch(apiUrl('/admin/users'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      username,
      email,
      firstName: 'Admin',
      lastName: 'Created',
      password: 'AdminCreatedAccountPassphrase-2026',
      confirmPassword: 'AdminCreatedAccountPassphrase-2026',
      role: 'learner',
    }),
  });
  assert.equal(savedResponse.status, 201);
  const createdUser = (await savedResponse.json()).user;
  assert.equal(createdUser.username, username);
  assert.equal(createdUser.firstName, 'Admin');
  assert.equal(createdUser.lastName, 'Created');
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.created'`).get().count, originalAuditCount + 1);
});

test('account profiles require valid first and last names and return the saved profile', async () => {
  const invalidResponse = await fetch(apiUrl('/auth/profile'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ firstName: '   ', lastName: 'Admin' }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).code, 'invalid_name');

  const response = await fetch(apiUrl('/auth/profile'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ firstName: '  Ana   María ', lastName: 'García' }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.user.firstName, 'Ana María');
  assert.equal(result.user.lastName, 'García');
  assert.equal(result.user.email, 'admin.registration@example.invalid');
  assert.deepEqual(database.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get('registration-fields-admin'), {
    first_name: 'Ana María', last_name: 'García',
  });
});

test('self-service profile and certificate updates roll back together and can be retried', async () => {
  const userId = 'registration-fields-self-profile-certificate';
  const courseId = 'registration-fields-self-profile-course';
  database.prepare(`INSERT INTO users (id, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'learner')`).run(userId, 'registration_fields_self_profile', 'self-profile@example.invalid', 'not-used');
  database.prepare(`INSERT INTO courses (id, title, status, visibility, created_by, updated_by)
    VALUES (?, 'Self-service Certificate', 'published', 'public', 'registration-fields-admin', 'registration-fields-admin')`).run(courseId);
  database.prepare(`INSERT INTO course_modules (id, course_id, title, position)
    VALUES ('registration-fields-self-profile-module', ?, 'Module', 0)`).run(courseId);
  database.prepare(`INSERT INTO lessons (id, module_id, title, position)
    VALUES ('registration-fields-self-profile-lesson', 'registration-fields-self-profile-module', 'Lesson', 0)`).run();
  database.prepare('INSERT INTO enrollments (id, course_id, user_id) VALUES (?, ?, ?)')
    .run('registration-fields-self-profile-enrollment', courseId, userId);
  database.prepare('INSERT INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)')
    .run(userId, 'registration-fields-self-profile-lesson');
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.profile_updated' AND entity_id = ?`).get(userId).count;
  database.exec(`CREATE TRIGGER fail_self_profile_certificate_insert
    BEFORE INSERT ON course_certificates WHEN NEW.user_id = '${userId}'
    BEGIN SELECT RAISE(ABORT, 'certificate storage unavailable'); END`);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const failedResponse = await fetch(apiUrl('/auth/profile'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': userId, connection: 'close' },
      body: JSON.stringify({ firstName: 'Jordan', lastName: 'Rivera' }),
    });
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'internal_error');
    assert.deepEqual(database.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(userId), {
      first_name: '', last_name: '',
    });
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'account.profile_updated' AND entity_id = ?`).get(userId).count, originalAuditCount);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM course_certificates WHERE user_id = ?').get(userId).count, 0);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_self_profile_certificate_insert');
  }

  const retryResponse = await fetch(apiUrl('/auth/profile'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-test-user': userId, connection: 'close' },
    body: JSON.stringify({ firstName: 'Jordan', lastName: 'Rivera' }),
  });
  assert.equal(retryResponse.status, 200);
  const result = await retryResponse.json();
  assert.equal(result.certificatesIssued, 1);
  assert.deepEqual(database.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(userId), {
    first_name: 'Jordan', last_name: 'Rivera',
  });
  assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.profile_updated' AND entity_id = ?`).get(userId).count, originalAuditCount + 1);
  assert.equal(database.prepare('SELECT recipient_name FROM course_certificates WHERE user_id = ?').get(userId).recipient_name, 'Jordan Rivera');
});

test('registration answers enforce required, date, choice, checkbox, and field-version rules', () => {
  const validValues = {
    department: ' Research ',
    acknowledgement: true,
    'start-date': '2026-10-09',
    about: '  I am returning to study.  ',
  };
  assert.deepEqual(
    registrationFields.normalizeRegistrationFieldValues(validValues, fieldDefinitions).map((field) => field.value),
    ['Research', 'true', '2026-10-09', 'I am returning to study.'],
  );

  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ acknowledgement: true }, fieldDefinitions), 'required_registration_field');
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Other', acknowledgement: true }, fieldDefinitions), 'invalid_registration_answers');
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: 'yes' }, fieldDefinitions), 'invalid_registration_answers');
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, 'start-date': '0000-01-01' }, fieldDefinitions), 'invalid_registration_answers');
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, 'start-date': '2025-02-30' }, fieldDefinitions), 'invalid_registration_answers');
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, 'start-date': '10000-01-01' }, fieldDefinitions), 'invalid_registration_answers');
  for (const date of ['0001-01-01', '9999-12-31']) {
    assert.equal(registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, 'start-date': date }, fieldDefinitions)[2].value, date);
  }
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, removedField: 'old value' }, fieldDefinitions), 'registration_fields_changed', 409);
});

test('public registration stores answer snapshots and rejects invalid submissions before account creation', async () => {
  const publicFieldsResponse = await fetch(apiUrl('/registration-fields'));
  assert.equal(publicFieldsResponse.status, 200);
  assert.deepEqual((await publicFieldsResponse.json()).fields, fieldDefinitions);

  const invalidResponse = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      email: 'missing-answer@example.invalid',
      firstName: 'Missing',
      lastName: 'Answer',
      username: 'missing_answer',
      password: 'RegistrationPassphrase-2026',
      confirmPassword: 'RegistrationPassphrase-2026',
      registrationFieldValues: { department: 'Research', acknowledgement: false },
    }),
  });
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).code, 'required_registration_field');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('missing_answer').count, 0);

  const missingNameResponse = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({ email: 'missing-name@example.invalid', username: 'missing_name', password: 'RegistrationPassphrase-2026', confirmPassword: 'RegistrationPassphrase-2026' }),
  });
  assert.equal(missingNameResponse.status, 400);
  assert.equal((await missingNameResponse.json()).code, 'invalid_name');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('missing_name').count, 0);

  for (const [missingName, submittedNames] of [
    ['first_name', { lastName: 'Present' }],
    ['last_name', { firstName: 'Present' }],
    ['first_name_whitespace', { firstName: '   ', lastName: 'Present' }],
    ['last_name_whitespace', { firstName: 'Present', lastName: '   ' }],
  ]) {
    const missingRequiredName = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        email: `${missingName}@example.invalid`,
        username: `missing_${missingName}`,
        password: 'RegistrationPassphrase-2026',
        confirmPassword: 'RegistrationPassphrase-2026',
        ...submittedNames,
      }),
    });
    assert.equal(missingRequiredName.status, 400);
    assert.equal((await missingRequiredName.json()).code, 'invalid_name');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get(`missing_${missingName}`).count, 0);
  }

  const response = await fetch(apiUrl('/auth/register'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify({
      email: 'registration-fields@example.invalid',
      firstName: 'Registration',
      lastName: 'Learner',
      username: 'registration_fields_learner',
      password: 'RegistrationPassphrase-2026',
      confirmPassword: 'RegistrationPassphrase-2026',
      registrationFieldValues: {
        department: 'Research',
        acknowledgement: true,
        'start-date': '2026-10-09',
        about: '  Returning learner.  ',
      },
    }),
  });
  assert.equal(response.status, 201);
  const { user } = await response.json();
  assert.equal(user.username, 'registration_fields_learner');
  assert.equal(user.firstName, 'Registration');
  assert.equal(user.lastName, 'Learner');

  const storedAnswers = database.prepare(`SELECT field_id, field_label, field_type, field_value, position
    FROM user_registration_field_values WHERE user_id = ? ORDER BY position`).all(user.id);
  assert.deepEqual(storedAnswers, [
    { field_id: 'department', field_label: 'Department', field_type: 'select', field_value: 'Research', position: 0 },
    { field_id: 'acknowledgement', field_label: 'I agree to the learning policy', field_type: 'checkbox', field_value: 'true', position: 1 },
    { field_id: 'start-date', field_label: 'Start date', field_type: 'date', field_value: '2026-10-09', position: 2 },
    { field_id: 'about', field_label: 'About you', field_type: 'text', field_value: 'Returning learner.', position: 3 },
  ]);

  registrationFields.saveRegistrationFields([
    { ...fieldDefinitions[0], label: 'Team', options: ['Research', 'Design', 'Support'] },
    ...fieldDefinitions.slice(1),
  ]);
  assert.equal(database.prepare(`SELECT field_label FROM user_registration_field_values
    WHERE user_id = ? AND field_id = 'department'`).get(user.id).field_label, 'Department');
});

test('public registration reports stale field answers without creating an account', async () => {
  const username = 'registration_stale_fields';
  registrationFields.saveRegistrationFields(fieldDefinitions.filter((field) => field.id !== 'about'));
  try {
    const response = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        email: 'stale-fields@example.invalid',
        firstName: 'Stale',
        lastName: 'Fields',
        username,
        password: 'RegistrationPassphrase-2026',
        confirmPassword: 'RegistrationPassphrase-2026',
        registrationFieldValues: {
          department: 'Research',
          acknowledgement: true,
          'start-date': '2026-10-09',
          about: 'Answer from the older form',
        },
      }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'registration_fields_changed');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get(username).count, 0);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM user_registration_field_values
      WHERE user_id IN (SELECT id FROM users WHERE username = ?)`)
      .get(username).count, 0);
  } finally {
    registrationFields.saveRegistrationFields(fieldDefinitions);
  }
});

test('public registration rolls back account state when its required audit entry cannot be written', async () => {
  const originalFields = registrationFields.getRegistrationFields();
  registrationFields.saveRegistrationFields(fieldDefinitions);
  const originalAuditCount = database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
    WHERE action = 'account.registered'`).get().count;
  const originalAnswerCount = database.prepare('SELECT COUNT(*) AS count FROM user_registration_field_values').get().count;
  const originalConsoleError = console.error;
  console.error = () => {};
  database.exec(`CREATE TRIGGER fail_public_registration_audit
    BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'account.registered'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`);

  try {
    const request = () => fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({
        email: 'registration-audit@example.invalid',
        firstName: 'Audit',
        lastName: 'Learner',
        username: 'registration_audit',
        password: 'RegistrationPassphrase-2026',
        confirmPassword: 'RegistrationPassphrase-2026',
        registrationFieldValues: { department: 'Research', acknowledgement: true },
      }),
    });

    const failedResponse = await request();
    assert.equal(failedResponse.status, 500);
    assert.equal((await failedResponse.json()).code, 'audit_unavailable');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users WHERE username = ?').get('registration_audit').count, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM user_registration_field_values').get().count, originalAnswerCount);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'account.registered'`).get().count, originalAuditCount);

    database.exec('DROP TRIGGER fail_public_registration_audit');
    const successfulResponse = await request();
    assert.equal(successfulResponse.status, 201);
    const { user } = await successfulResponse.json();
    assert.ok(database.prepare('SELECT last_login_at FROM users WHERE id = ?').get(user.id).last_login_at);
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM audit_logs
      WHERE action = 'account.registered' AND entity_id = ?`).get(user.id).count, 1);
  } finally {
    console.error = originalConsoleError;
    database.exec('DROP TRIGGER IF EXISTS fail_public_registration_audit');
    registrationFields.saveRegistrationFields(originalFields);
  }
});
