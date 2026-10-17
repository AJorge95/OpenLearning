import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const auditTrackedTree = process.argv.includes('--tracked');
let stagedPaths;
let stagedDiff;
try {
  const pathCommand = auditTrackedTree
    ? ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
    : ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT'];
  stagedPaths = git(pathCommand)
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, '/'));
  stagedDiff = auditTrackedTree
    ? ''
    : git(['diff', '--cached', '--no-ext-diff', '--no-color', '--unified=0']);
} catch {
  console.error('Unable to inspect the Git index for sensitive files.');
  process.exit(1);
}

const blockedPathRules = [
  { name: 'local environment file', test: (path) => /(^|\/)\.env(?:$|\.)/i.test(path) && path !== '.env.example' },
  {
    name: 'local data, backup, or generated test directory',
    test: (path) => /(^|\/)(?:backup|backups|data|state|artifacts|secrets|\.secrets|\.codex-run-logs|logs|exports|coverage|test-results|playwright-report|\.nyc_output)(\/|$)/i.test(path),
  },
  {
    name: 'database, backup, log, media, or private-key file',
    test: (path) => /\.(?:sqlite3?|db|dump|bak|backup|mp4|log|pem|key|p12|pfx)(?:-(?:shm|wal|journal))?(?:\..*)?$/i.test(path)
      || /\.(?:sql|sql\.gz)$/i.test(path) && !/(^|\/)migrations\//i.test(path)
      || /(^|\/)(?:[^/]+\.junit\.xml|coverage\.xml|lcov\.info)$/i.test(path),
  },
];

const blockedPaths = [];
for (const path of stagedPaths) {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const rule = blockedPathRules.find((candidate) => candidate.test(path))
    || (/backup/i.test(basename) && /\.(?:zip|tar|tgz|gz|7z|rar)$/i.test(basename)
      ? { name: 'backup archive', test: () => true }
      : null);
  if (rule) blockedPaths.push({ path, rule: rule.name });
}

const addedLineSecretRules = [
  { name: 'private key material', test: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'GitHub access token', test: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,})\b/ },
  { name: 'AWS access key ID', test: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Stripe secret key', test: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'Slack access token', test: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  {
    name: 'credential-bearing service URL',
    test: /\b(?:https?|postgres(?:ql)?|mysql):\/\/[^/\s:@]+:[^/\s@]+@(?!example\.(?:com|net|org)(?:[:/]|$)|(?:[^/]+\.)?(?:example|test|invalid)(?:[:/]|$)|localhost(?:[:/]|$)|127\.0\.0\.1(?:[:/]|$))[^/\s]+/i,
  },
];

const contentFindings = [];
let privateAuthorEmailIssue = false;
if (auditTrackedTree) {
  for (const path of stagedPaths) {
    try {
      if (!lstatSync(path).isFile()) continue;
      const bytes = readFileSync(path);
      if (bytes.includes(0)) continue;
      const lines = bytes.toString('utf8').split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const rule = addedLineSecretRules.find((candidate) => candidate.test.test(lines[index]));
        if (rule) contentFindings.push({ rule: rule.name, path, line: index + 1 });
      }
    } catch {
      console.error(`Unable to inspect tracked file: ${path}`);
      process.exitCode = 1;
    }
  }
} else {
  try {
    const authorIdentity = git(['var', 'GIT_AUTHOR_IDENT']);
    const authorEmail = authorIdentity.match(/<([^<>]+)>/)?.[1] ?? '';
    privateAuthorEmailIssue = !/@users\.noreply\.github\.com$/i.test(authorEmail);
  } catch {
    privateAuthorEmailIssue = true;
  }

  for (const line of stagedDiff.split(/\r?\n/)) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const rule = addedLineSecretRules.find((candidate) => candidate.test.test(line.slice(1)));
    if (rule) contentFindings.push({ rule: rule.name });
  }
}

if (blockedPaths.length || contentFindings.length || privateAuthorEmailIssue || process.exitCode === 1) {
  console.error('Commit blocked by the repository hygiene policy.');
  for (const { path, rule } of blockedPaths) console.error(`- ${rule}: ${path}`);
  for (const { rule, path, line } of contentFindings) {
    const location = path ? ` in ${path}:${line}` : ' in added content';
    console.error(`- possible ${rule}${location}`);
  }
  if (privateAuthorEmailIssue) console.error('- configure the GitHub-provided noreply address as this repository\'s commit email');
  console.error('Keep local data and private information out of Git before committing.');
  process.exit(1);
}

