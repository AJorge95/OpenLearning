import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionFiles = ['package.json', 'package-lock.json'];
const excludedPaths = [
  /^\.githooks\//,
  /^\.github\//,
  /^docs\//,
  /^scripts\/(?:versioning|install-git-hooks)\.js$/,
  /(?:^|\/)README(?:\.[^/]*)?$/i,
  /\.md$/i,
  /(?:^|\/)[^/]*\.lock$/i,
  /^(?:package|package-lock)\.json$/,
];

function parseVersion(value) {
  const match = typeof value === 'string' && /^(\d+)\.(\d+)\.0$/.exec(value);
  if (!match) throw new Error(`Expected an x.y.0 app version, received ${JSON.stringify(value)}.`);
  return { major: Number(match[1]), minor: Number(match[2]), value };
}

function readJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function formatVersion({ major, minor }) {
  return `${major}.${minor}.0`;
}

function updatePackageDocument(document, version) {
  document.version = version;
  if (document.packages?.['']) document.packages[''].version = version;
  return document;
}

function writeWorkingFile(filePath, version) {
  const fullPath = path.join(projectRoot, filePath);
  const document = readJson(fs.readFileSync(fullPath, 'utf8'), filePath);
  updatePackageDocument(document, version);
  fs.writeFileSync(fullPath, `${JSON.stringify(document, null, 2)}\n`);
}

function git(args, options = {}) {
  const { input, ...otherOptions } = options;
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    ...(input === undefined ? {} : { input }),
    ...otherOptions,
  });
}

function readHeadPackage() {
  try {
    return readJson(git(['show', 'HEAD:package.json']), 'HEAD:package.json');
  } catch {
    return readJson(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'), 'package.json');
  }
}

function readIndexFile(filePath) {
  try {
    return git(['cat-file', 'blob', `:0:${filePath}`]);
  } catch {
    return git(['show', `HEAD:${filePath}`]);
  }
}

function updateIndexFile(filePath, version) {
  const document = readJson(readIndexFile(filePath), `index:${filePath}`);
  updatePackageDocument(document, version);
  const blob = git(['hash-object', '-w', '--stdin'], { input: `${JSON.stringify(document, null, 2)}\n` }).trim();
  const entries = git(['ls-files', '--stage', '--', filePath]).trim();
  const mode = entries.match(/^(\d+) /)?.[1] || '100644';
  git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${filePath}`]);
}

function readStagedPaths() {
  const output = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']);
  return output.split('\0').filter(Boolean);
}

function isCountedAppPath(filePath) {
  return !excludedPaths.some((pattern) => pattern.test(filePath));
}

function setVersion(version) {
  for (const filePath of versionFiles) writeWorkingFile(filePath, version);
}

function majorBump() {
  const packageJson = readJson(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'), 'package.json');
  const current = parseVersion(packageJson.version);
  const nextVersion = formatVersion({ major: current.major + 1, minor: 0 });
  setVersion(nextVersion);
  console.log(`OpenLearning version updated to ${nextVersion}.`);
}

function preCommitBump() {
  const stagedPaths = readStagedPaths();
  if (!stagedPaths.some(isCountedAppPath)) return;

  const headVersion = parseVersion(readHeadPackage().version);
  const workingPackage = readJson(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'), 'package.json');
  const requestedVersion = parseVersion(workingPackage.version);
  const hasRequestedMajorBump = requestedVersion.major > headVersion.major && requestedVersion.minor === 0;
  const version = hasRequestedMajorBump
    ? requestedVersion.value
    : formatVersion({ major: headVersion.major, minor: headVersion.minor + 1 });

  for (const filePath of versionFiles) {
    writeWorkingFile(filePath, version);
    updateIndexFile(filePath, version);
  }
  console.log(`OpenLearning app commit version: ${version}.`);
}

const command = process.argv[2];
if (command === 'major') majorBump();
else if (command === 'pre-commit') preCommitBump();
else throw new Error('Usage: node scripts/versioning.js <major|pre-commit>');
