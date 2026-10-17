import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const versionScript = path.join(projectRoot, 'scripts/versioning.js');
const indexCheckScript = path.join(projectRoot, 'scripts/check-git-index.js');
const hookInstaller = path.join(projectRoot, 'scripts/install-git-hooks.js');
const preCommitHook = path.join(projectRoot, '.githooks/pre-commit');
const tempBase = path.resolve(os.tmpdir());

function createFixture() {
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-versioning-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-versioning-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  fs.mkdirSync(path.join(resolvedDirectory, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(resolvedDirectory, '.githooks'), { recursive: true });
  fs.copyFileSync(versionScript, path.join(resolvedDirectory, 'scripts/versioning.js'));
  // Keep the fixture runnable when the configured hook grows additional checks.
  fs.copyFileSync(indexCheckScript, path.join(resolvedDirectory, 'scripts/check-git-index.js'));
  fs.copyFileSync(hookInstaller, path.join(resolvedDirectory, 'scripts/install-git-hooks.js'));
  const copiedHookPath = path.join(resolvedDirectory, '.githooks/pre-commit');
  fs.copyFileSync(preCommitHook, copiedHookPath);
  fs.chmodSync(copiedHookPath, 0o755);
  fs.writeFileSync(path.join(resolvedDirectory, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '0.1.0', type: 'module' }, null, 2)}\n`);
  fs.writeFileSync(path.join(resolvedDirectory, 'package-lock.json'), `${JSON.stringify({ name: 'fixture', version: '0.1.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '0.1.0' } } }, null, 2)}\n`);
  execFileSync('git', ['init', '-q'], { cwd: resolvedDirectory });
  execFileSync('git', ['config', 'user.name', 'Version Test'], { cwd: resolvedDirectory });
  execFileSync('git', ['config', 'user.email', 'version-test@users.noreply.github.com'], { cwd: resolvedDirectory });
  execFileSync('git', ['add', 'package.json', 'package-lock.json', 'scripts/versioning.js', 'scripts/check-git-index.js'], { cwd: resolvedDirectory });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: resolvedDirectory });
  return resolvedDirectory;
}

function runHook(directory) {
  const result = spawnSync(process.execPath, ['scripts/versioning.js', 'pre-commit'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function readVersions(directory) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  return [packageJson.version, packageLock.version, packageLock.packages[''].version];
}

function readIndexVersions(directory) {
  const packageJson = JSON.parse(execFileSync('git', ['show', ':package.json'], { cwd: directory, encoding: 'utf8' }));
  const packageLock = JSON.parse(execFileSync('git', ['show', ':package-lock.json'], { cwd: directory, encoding: 'utf8' }));
  return [packageJson.version, packageLock.version, packageLock.packages[''].version];
}

function cleanup(directory) {
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-versioning-')) {
    throw new Error('Refusing to remove an unexpected temporary directory.');
  }
  fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

test('pre-commit increments y once and keeps package metadata synchronized for app changes', () => {
  const directory = createFixture();
  try {
    fs.writeFileSync(path.join(directory, 'server-change.js'), 'export const changed = true;\n');
    execFileSync('git', ['add', 'server-change.js'], { cwd: directory });
    runHook(directory);
    runHook(directory);
    assert.deepEqual(readVersions(directory), ['0.2.0', '0.2.0', '0.2.0']);
    assert.deepEqual(readIndexVersions(directory), ['0.2.0', '0.2.0', '0.2.0']);
    assert.match(execFileSync('git', ['diff', '--cached', '--', 'package.json'], { cwd: directory, encoding: 'utf8' }), /0\.1\.0[\s\S]*0\.2\.0/);
  } finally { cleanup(directory); }
});

test('docs-only changes do not increment the app version', () => {
  const directory = createFixture();
  try {
    fs.writeFileSync(path.join(directory, 'README.md'), 'Documentation only.\n');
    execFileSync('git', ['add', 'README.md'], { cwd: directory });
    runHook(directory);
    assert.deepEqual(readVersions(directory), ['0.1.0', '0.1.0', '0.1.0']);
  } finally { cleanup(directory); }
});

test('tooling and dependency-only changes do not increment the app version', () => {
  const directory = createFixture();
  try {
    fs.mkdirSync(path.join(directory, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.github/workflows/checks.yml'), 'name: checks\n');
    fs.writeFileSync(path.join(directory, 'scripts/versioning.js'), '// tooling update\n');
    const packageJsonPath = path.join(directory, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    packageJson.devDependencies = { example: '^1.0.0' };
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    execFileSync('git', ['add', '.github/workflows/checks.yml', 'scripts/versioning.js', 'package.json'], { cwd: directory });
    runHook(directory);
    assert.deepEqual(readVersions(directory), ['0.1.0', '0.1.0', '0.1.0']);
  } finally { cleanup(directory); }
});

test('the configured Git hook automatically versions an app commit', () => {
  const directory = createFixture();
  try {
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], { cwd: directory });
    fs.writeFileSync(path.join(directory, 'app.js'), 'export const changed = true;\n');
    execFileSync('git', ['add', 'app.js'], { cwd: directory });
    execFileSync('git', ['commit', '-qm', 'app change'], { cwd: directory });
    assert.deepEqual(readVersions(directory), ['0.2.0', '0.2.0', '0.2.0']);
  } finally { cleanup(directory); }
});

test('a requested major bump takes precedence over the automatic minor bump', () => {
  const directory = createFixture();
  try {
    fs.writeFileSync(path.join(directory, 'app.js'), 'export const changed = true;\n');
    execFileSync('git', ['add', 'app.js'], { cwd: directory });
    execFileSync(process.execPath, ['scripts/versioning.js', 'major'], { cwd: directory });
    runHook(directory);
    assert.deepEqual(readVersions(directory), ['1.0.0', '1.0.0', '1.0.0']);
  } finally { cleanup(directory); }
});

test('npm hook setup configures the project Git hook directory', () => {
  const directory = createFixture();
  try {
    execFileSync(process.execPath, ['scripts/install-git-hooks.js'], { cwd: directory });
    assert.equal(execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: directory, encoding: 'utf8' }).trim(), '.githooks');
  } finally { cleanup(directory); }
});

test('npm hook setup preserves a contributor configured hook directory', () => {
  const directory = createFixture();
  try {
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.company-hooks'], { cwd: directory });
    execFileSync(process.execPath, ['scripts/install-git-hooks.js'], { cwd: directory, stdio: 'ignore' });
    assert.equal(execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: directory, encoding: 'utf8' }).trim(), '.company-hooks');
  } finally { cleanup(directory); }
});

test('npm prepare hook setup exits cleanly when the installer source archive has no Git metadata', () => {
  const directory = fs.mkdtempSync(path.join(tempBase, 'openlearning-version-archive-'));
  const resolvedDirectory = path.resolve(directory);
  if (path.dirname(resolvedDirectory) !== tempBase || !path.basename(resolvedDirectory).startsWith('openlearning-version-archive-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  try {
    fs.mkdirSync(path.join(resolvedDirectory, 'scripts'), { recursive: true });
    fs.copyFileSync(hookInstaller, path.join(resolvedDirectory, 'scripts/install-git-hooks.js'));
    const result = spawnSync(process.execPath, ['scripts/install-git-hooks.js'], { cwd: resolvedDirectory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(resolvedDirectory, '.git')), false);
  } finally {
    fs.rmSync(resolvedDirectory, { recursive: true, force: true });
  }
});
