import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
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
let verifyPassword;
let registrationFields;
let server;

const fieldDefinitions = [
  { id: 'department', label: 'Department', type: 'select', required: true, options: ['Research', 'Design'] },
  { id: 'acknowledgement', label: 'I agree to the learning policy', type: 'checkbox', required: true, options: [] },
  { id: 'start-date', label: 'Start date', type: 'date', required: false, options: [] },
  { id: 'about', label: 'About you', type: 'text', required: false, options: [] },
];

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

before(async () => {
  fixtureDirectory = createFixtureDirectory();
  Object.assign(process.env, {
    ...isolatedConfig,
    DATA_DIR: fixtureDirectory,
    DB_PATH: path.join(fixtureDirectory, 'openlearning.sqlite'),
    MEDIA_ROOT: path.join(fixtureDirectory, 'course-media'),
  });

  ({ db: database, setSetting } = await import('./db.js'));
  ({ verifyPassword } = await import('./auth.js'));
  registrationFields = await import('./registration-fields.js');
  const { authRouter } = await import('./routes-auth.js');
  const { adminRouter } = await import('./routes-admin.js');
  const { errorHandler } = await import('./http.js');

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
    req.currentUser = database.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get('registration-fields-admin');
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

test('platform settings reject truncated icons even when their first bytes match the declared image type', async () => {
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
  const malformedIcons = [
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['webp', truncatedWebp],
  ];

  for (const [type, bytes] of malformedIcons) {
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
  assertApiError(() => registrationFields.normalizeRegistrationFieldValues({ department: 'Research', acknowledgement: true, 'start-date': '2025-02-30' }, fieldDefinitions), 'invalid_registration_answers');
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
