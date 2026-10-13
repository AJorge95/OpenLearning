import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const installer = fs.readFileSync(new URL('../../scripts/install.sh', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const installerPath = fileURLToPath(new URL('../../scripts/install.sh', import.meta.url));
const bashPath = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
  ? 'C:\\Program Files\\Git\\bin\\bash.exe'
  : 'bash';

test('Linux installer targets supported systems and repository main', () => {
  assert.match(installer, /REPOSITORY="AJorge95\/OpenLearning"/);
  assert.match(installer, /BRANCH="main"/);
  assert.match(installer, /ubuntu\)/);
  assert.match(installer, /Ubuntu 22\.04\+/);
  assert.match(installer, /RHEL 9\+/);
  assert.match(installer, /Node\.js 24 or newer/);
  assert.match(installer, /systemd is required/);
});

test('platform support check accepts supported releases and rejects unsupported ones', (context) => {
  const check = (distribution, version) => spawnSync(bashPath, [installerPath, '--check-support', distribution, version], { encoding: 'utf8' });
  const ubuntu = check('ubuntu', '22.04');
  if (ubuntu.error?.code === 'ENOENT' || ubuntu.stderr?.includes('NtCreateDirectoryObject')) {
    context.skip('Bash startup is unavailable on this test host.');
    return;
  }
  assert.equal(ubuntu.status, 0, ubuntu.stderr);
  assert.match(ubuntu.stdout, /apt-get/);
  const rhel = check('rocky', '9.4');
  assert.equal(rhel.status, 0, rhel.stderr);
  assert.match(rhel.stdout, /dnf/);
  const oldUbuntu = check('ubuntu', '20.04');
  assert.notEqual(oldUbuntu.status, 0);
  const unsupported = check('debian', '12');
  assert.notEqual(unsupported.status, 0);
});

test('Linux installer protects first-run credentials and managed paths', () => {
  assert.match(installer, /randomBytes\(48\)/);
  assert.match(installer, /randomBytes\(32\)/);
  assert.match(installer, /chmod 0600 "\$ENV_FILE"/);
  assert.match(installer, /OpenLearning setup token \(shown once\)/);
  assert.match(installer, /EnvironmentFile=\$ENV_FILE/);
  assert.match(installer, /DATA_DIR="\/var\/lib\/openlearning"/);
  assert.match(installer, /Environment=/);
});

test('updater creates verified backups and restores data when readiness fails', () => {
  assert.match(installer, /Creating a verified pre-update database and media backup/);
  assert.match(installer, /spawnSync\('npm', \['run', 'backup'\]/);
  assert.match(installer, /BACKUP_PATH/);
  assert.match(installer, /Readiness check failed; restoring the previous release/);
  assert.match(installer, /\/readyz/);
  assert.match(installer, /ENDPOINT="healthz"/);
});

test('README documents the GitHub one-line installer and repeated update command', () => {
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/AJorge95\/OpenLearning\/main\/scripts\/install\.sh \| sudo bash/);
  assert.match(readme, /Run the same command again to update/);
  assert.match(readme, /Ubuntu 22\.04 or newer, or RHEL 9/);
});

test('Linux installer has valid Bash syntax when Bash is available', (context) => {
  const result = spawnSync(bashPath, ['-n', installerPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    context.skip('Bash is not installed on this test host.');
    return;
  }
  if (process.platform === 'win32' && result.stderr?.includes('NtCreateDirectoryObject')) {
    context.skip('Git Bash startup is restricted by the Windows sandbox; run bash -n on a Linux host.');
    return;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
