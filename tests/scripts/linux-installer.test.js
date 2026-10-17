import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const installer = fs.readFileSync(new URL('../../scripts/install.sh', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8');
const startScript = fs.readFileSync(new URL('../../scripts/start.js', import.meta.url), 'utf8');
const dockerfile = fs.readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8');
const swarm = fs.readFileSync(new URL('../../docker-stack.yml', import.meta.url), 'utf8');
const installerPath = fileURLToPath(new URL('../../scripts/install.sh', import.meta.url));
const bashPath = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
  ? 'C:\\Program Files\\Git\\bin\\bash.exe'
  : 'bash';

test('Linux installer targets supported systems and repository main', () => {
  assert.match(installer, /REPOSITORY="AJorge95\/OpenLearning"/);
  assert.match(installer, /BRANCH="main"/);
  assert.match(installer, /OPENLEARNING_COMMIT must be a full 40-character lowercase commit SHA/);
  assert.match(installer, /codeload\.github\.com\/\$REPOSITORY\/tar\.gz\/\$SOURCE_COMMIT/);
  assert.match(installer, /ubuntu\)/);
  assert.match(installer, /Ubuntu 22\.04\+/);
  assert.match(installer, /RHEL 9\+/);
  assert.match(installer, /Node\.js 24 or newer/);
  assert.match(installer, /systemd is required/);
  assert.match(installer, /PORT="5173"/);
  assert.match(installer, /REQUESTED_PORT="\$\{OPENLEARNING_PORT:-\}"/);
  assert.match(installer, /OPENLEARNING_PORT must be a whole-number TCP port between 1 and 65535/);
  assert.match(installer, /default_port="\$\{2:-5173\}"/);
  assert.match(installer, /apt-get install .*iproute2/);
  assert.match(installer, /dnf install .*iproute/);
});

test('installer accepts only valid TCP ports and normalizes leading zeroes', (context) => {
  const normalize = installer.match(/normalize_port\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(normalize, 'expected a port validation helper');
  const run = (value) => spawnSync(bashPath, ['-c', `${normalize}; normalize_port "$PORT_VALUE"`], {
    encoding: 'utf8',
    env: { ...process.env, PORT_VALUE: value },
  });
  const valid = run('05173');
  if (valid.error?.code === 'ENOENT' || valid.stderr?.includes('NtCreateDirectoryObject')) {
    context.skip('Bash startup is unavailable on this test host.');
    return;
  }
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout.trim(), '5173');
  for (const invalidPort of ['0', '65536', '123456', 'abc']) {
    assert.notEqual(run(invalidPort).status, 0, `expected ${invalidPort} to be rejected`);
  }
});

test('installer port override reaches both fresh installs and existing service migrations', () => {
  assert.match(installer, /PORT=\$PORT/);
  assert.match(installer, /INSTALL_PORT_OVERRIDE="\$REQUESTED_PORT" node scripts\/migrate-install-config\.js/);
  assert.match(installer, /configured_port "\$OLD_ENV_FILE" 6173/);
  assert.match(installer, /curl -fsS "http:\/\/127\.0\.0\.1:\$EXISTING_PORT\/readyz"/);
  assert.match(installer, /http:\/\/\$SERVER_IPV4:\$SERVICE_PORT/);
  assert.match(readme, /OPENLEARNING_PORT/);
  assert.match(readme, /sudo env OPENLEARNING_PORT=5173 bash/);
});

test('installer reports the kernel-selected server IPv4 without network probing', (context) => {
  const detector = installer.match(/detect_server_ipv4\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(detector, 'expected the server IPv4 discovery helper');
  assert.match(detector, /ip -4 route get 1\.1\.1\.1/);
  assert.match(installer, /http:\/\/\$SERVER_IPV4:\$SERVICE_PORT/);
  assert.doesNotMatch(installer, /curl[^\n]*1\.1\.1\.1|ping[^\n]*1\.1\.1\.1/);
  assert.match(readme, /prints the IPv4 address selected by the host's default route/);
  assert.match(readme, /that address may be private/);

  const run = (route, defaults, addresses) => spawnSync(bashPath, ['-c', `
    set -eu
    ${detector}
    ip() {
      case "$*" in
        "-4 route get 1.1.1.1") printf '%s\\n' "$MOCK_ROUTE" ;;
        "-4 route show default") printf '%s\\n' "$MOCK_DEFAULTS" ;;
        "-o -4 addr show dev ens192 scope global") printf '%s\\n' "$MOCK_ADDRESSES" ;;
        *) return 1 ;;
      esac
    }
    detect_server_ipv4
  `], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_ROUTE: route, MOCK_DEFAULTS: defaults, MOCK_ADDRESSES: addresses },
  });

  const routeSelected = run('1.1.1.1 via 10.123.89.1 dev ens192 src 10.123.89.19 uid 0', '', '');
  if (routeSelected.error?.code === 'ENOENT' || routeSelected.stderr?.includes('NtCreateDirectoryObject')) {
    context.skip('Bash startup is unavailable on this test host.');
    return;
  }
  assert.equal(routeSelected.status, 0, routeSelected.stderr);
  assert.equal(routeSelected.stdout.trim(), '10.123.89.19');

  const interfaceFallback = run('', 'default via 10.123.89.1 dev ens192 proto dhcp', '2: ens192 inet 10.123.89.19/24 brd 10.123.89.255 scope global dynamic ens192');
  assert.equal(interfaceFallback.status, 0, interfaceFallback.stderr);
  assert.equal(interfaceFallback.stdout.trim(), '10.123.89.19');

  const noRoute = run('', '', '');
  assert.notEqual(noRoute.status, 0, 'return no guess when there is no route-selected address');
});

test('production startup guidance no longer advertises a placeholder server address', () => {
  assert.doesNotMatch(server, /<server-external-ip>/);
  assert.match(server, /reachable IPv4 address or DNS name/);
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
  assert.match(installer, /ENV_FILE="\$CONFIG_DIR\/\.env"/);
  assert.match(installer, /randomBytes\(48\)/);
  assert.match(installer, /randomBytes\(32\)/);
  assert.match(installer, /chmod 0600 "\$ENV_FILE"/);
  assert.match(installer, /OpenLearning setup token \(shown once\)/);
  assert.match(installer, /EnvironmentFile=\$ENV_FILE/);
  assert.match(installer, /DATA_DIR="\/var\/lib\/openlearning"/);
  assert.match(installer, /Environment=/);
});

test('Linux installer makes root-owned releases readable by the service user', () => {
  assert.match(installer, /normalize_release_permissions\(\) \{/);
  assert.match(installer, /chown -R root:root "\$release_path"/);
  assert.match(installer, /find "\$release_path" -type d -exec chmod 0755 \{\} \+/);
  assert.match(installer, /find "\$release_path" -type f ! -perm \/111 -exec chmod 0644 \{\} \+/);
  assert.match(installer, /normalize_release_permissions "\$NEW_RELEASE"/);
  assert.match(installer, /User=openlearning/);
});

test('updater creates verified backups and restores data when readiness fails', () => {
  assert.match(installer, /Creating a verified pre-update database and media backup/);
  assert.match(installer, /spawnSync\('npm', \['run', 'backup'\]/);
  assert.match(installer, /BACKUP_PATH/);
  assert.match(installer, /Readiness check failed; restoring the previous release/);
  assert.match(installer, /\/readyz/);
  assert.match(installer, /ENDPOINT="healthz"/);
  assert.match(installer, /CONFIG_SNAPSHOT="\$\(mktemp \/tmp\/openlearning-env\.XXXXXX\)"/);
  assert.match(installer, /if ! restore_environment_config; then/);
  assert.match(installer, /cp -a -- "\$CONFIG_SNAPSHOT" "\$ENV_FILE"/);
});

test('port migration rollback restores the prior private environment file', (context) => {
  const helper = installer.match(/restore_environment_config\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'expected a service configuration rollback helper');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'openlearning-port-rollback-'));
  const root = path.resolve(directory);
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('openlearning-port-rollback-')) {
    throw new Error('Refusing to use an unexpected temporary directory.');
  }
  const environmentFile = path.join(root, '.env');
  const snapshotFile = path.join(root, 'previous.env');
  fs.writeFileSync(environmentFile, 'PORT=5173\n');
  fs.writeFileSync(snapshotFile, 'PORT=6173\nSESSION_SECRET=private-value\n', { mode: 0o600 });
  try {
    const result = spawnSync(bashPath, ['-c', `
      set -eu
      ENV_FILE="$MOCK_ENV_FILE"
      CONFIG_SNAPSHOT="$MOCK_CONFIG_SNAPSHOT"
      CONFIG_SNAPSHOT_EXISTS=true
      RESTORE_CONFIG_ON_FAILURE=true
      ${helper}
      restore_environment_config
      printf 'restore=%s\\n' "$RESTORE_CONFIG_ON_FAILURE"
    `], {
      encoding: 'utf8',
      env: { ...process.env, MOCK_ENV_FILE: environmentFile, MOCK_CONFIG_SNAPSHOT: snapshotFile },
    });
    if (result.error?.code === 'ENOENT' || result.stderr?.includes('NtCreateDirectoryObject')) {
      context.skip('Bash startup is unavailable on this test host.');
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'restore=false\n');
    assert.equal(fs.readFileSync(environmentFile, 'utf8'), 'PORT=6173\nSESSION_SECRET=private-value\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy storage repair grants account-specific traversal and propagates ACL failure', () => {
  const helper = installer.match(/prepare_storage_access\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'expected the actual storage permission helper');
  // Exercise the Bash helper without changing host accounts or filesystem modes.
  const run = (aclStatus) => spawnSync(bashPath, ['-c', `
    set -eu
    ${helper}
    runuser() { return 1; }
    setfacl() { printf 'ACL %s\\n' "$*"; return ${aclStatus}; }
    chown() { printf 'OWNER %s\\n' "$*"; }
    chmod() { printf 'MODE %s\\n' "$*"; }
    prepare_storage_access /home/legacy/OpenLearning/data
  `], { encoding: 'utf8' });
  const success = run(0);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /ACL -m u:openlearning:--x \/home\/legacy\n/);
  assert.match(success.stdout, /OWNER openlearning:openlearning \/home\/legacy\/OpenLearning\/data/);
  assert.match(success.stdout, /MODE u\+rwx \/home\/legacy\/OpenLearning\/data/);
  assert.doesNotMatch(success.stdout, /OWNER.*\/home\/legacy\n/);
  const failure = run(1);
  assert.notEqual(failure.status, 0, 'unsupported ACLs must prevent activation');
  assert.doesNotMatch(failure.stdout, /OWNER/);
});

test('updater removes an unfinalized release without deleting the active release', () => {
  assert.match(installer, /NEW_RELEASE=""/);
  assert.match(installer, /RELEASE_FINALIZED=false/);
  assert.match(installer, /if \[\[ "\$RELEASE_FINALIZED" != true && -n "\$NEW_RELEASE" && -d "\$NEW_RELEASE" \]\]; then/);
  assert.match(installer, /rm -rf -- "\$NEW_RELEASE"/);
  assert.match(installer, /RELEASE_FINALIZED=true/);
});

test('installer supports the new configurable backup feature under its systemd sandbox', () => {
  assert.match(installer, /BACKUP_DIR=\$BACKUP_ROOT/);
  assert.match(installer, /READ_WRITE_PATHS=.*\$BACKUP_ROOT/);
  assert.match(installer, /ReadWritePaths=\$READ_WRITE_PATHS/);
  assert.match(installer, /ProtectSystem=full/);
  assert.match(installer, /node scripts\/migrate-install-config\.js/);
  assert.match(readme, /per-job destinations and retention/);
});

test('installer keeps the service on the package-required Node.js major', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.engines.node, />=\s*24/);
  assert.equal([...installer.matchAll(/setup_24\.x/g)].length, 2);
  assert.match(installer, /NODE_MAJOR >= 24/);
});

test('native releases discard build-only dependencies after the build succeeds', () => {
  assert.match(installer, /npm run build\r?\nnpm prune --omit=dev\r?\n/);
});

test('container deployments use the shared startup command without duplicate mode flags', () => {
  assert.match(startScript, /process\.env\.NODE_ENV = process\.argv\.includes\('--dev'\) \? 'development' : 'production'/);
  assert.match(dockerfile, /ENV NODE_ENV=production/);
  for (const deployment of [compose, swarm]) {
    assert.doesNotMatch(deployment, /NODE_ENV/);
  }
  assert.match(dockerfile, /CMD \["node", "scripts\/start\.js"\]/);
  assert.match(compose, /PORT: "5173"/);
  assert.match(swarm, /PORT: "5173"/);
});

test('installer opens the configured application port in active local firewalls', () => {
  assert.match(installer, /ufw status.*Status: active/s);
  assert.match(installer, /ufw allow "\$SERVICE_PORT\/tcp"/);
  assert.match(installer, /firewall-cmd --state/);
  assert.match(installer, /firewall-cmd --get-zone-of-interface="\$interface"/);
  assert.match(installer, /configure_firewalld_port "\$FIREWALL_ZONE"/);
  assert.match(installer, /firewall-cmd --zone="\$zone" --permanent --add-port="\$SERVICE_PORT\/tcp"/);
  assert.match(installer, /firewall-cmd --zone="\$zone" --add-port="\$SERVICE_PORT\/tcp"/);
  assert.doesNotMatch(installer, /firewall-cmd --get-active-zones/);
  assert.doesNotMatch(installer, /firewall-cmd --reload/);
  assert.match(readme, /does not enable a firewall/i);
});

test('firewalld port setup is idempotent without reloading unrelated runtime rules', () => {
  const helper = installer.match(/configure_firewalld_port\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'expected the firewalld port setup helper');
  const run = (permanentStatus, runtimeStatus) => spawnSync(bashPath, ['-c', `
    set -eu
    SERVICE_PORT=6173
    exec 3>&1
    ${helper}
    firewall-cmd() {
      case "$*" in
        "--zone=public --permanent --add-port=6173/tcp")
          printf 'permanent\n' >&3
          [[ "$MOCK_PERMANENT_STATUS" -ne 13 ]] || printf 'mock permanent failure\n'
          return "$MOCK_PERMANENT_STATUS"
          ;;
        "--zone=public --add-port=6173/tcp")
          printf 'runtime\n' >&3
          [[ "$MOCK_RUNTIME_STATUS" -ne 13 ]] || printf 'mock runtime failure\n'
          return "$MOCK_RUNTIME_STATUS"
          ;;
        "--reload") printf 'reload\n' >&3; return 99 ;;
        *) return 2 ;;
      esac
    }
    configure_firewalld_port public
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_PERMANENT_STATUS: String(permanentStatus),
      MOCK_RUNTIME_STATUS: String(runtimeStatus),
    },
  });

  const added = run(0, 0);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.stdout, 'permanent\nruntime\n');

  const permanentAlreadyEnabled = run(11, 0);
  assert.equal(permanentAlreadyEnabled.status, 0, permanentAlreadyEnabled.stderr);
  assert.equal(permanentAlreadyEnabled.stdout, 'permanent\nruntime\n');
  assert.equal(permanentAlreadyEnabled.stderr, '', 'the permanent already-enabled warning is handled quietly');

  const runtimeAlreadyEnabled = run(0, 11);
  assert.equal(runtimeAlreadyEnabled.status, 0, runtimeAlreadyEnabled.stderr);
  assert.equal(runtimeAlreadyEnabled.stdout, 'permanent\nruntime\n');
  assert.equal(runtimeAlreadyEnabled.stderr, '', 'the runtime already-enabled warning is handled quietly');

  const bothAlreadyEnabled = run(11, 11);
  assert.equal(bothAlreadyEnabled.status, 0, bothAlreadyEnabled.stderr);
  assert.equal(bothAlreadyEnabled.stdout, 'permanent\nruntime\n');
  assert.equal(bothAlreadyEnabled.stderr, '');

  const permanentFailure = run(13, 0);
  assert.equal(permanentFailure.status, 13, 'real permanent configuration errors must remain failures');
  assert.equal(permanentFailure.stdout, 'permanent\n', 'do not open a temporary runtime port if persistence fails');
  assert.match(permanentFailure.stderr, /mock permanent failure/);

  const runtimeFailure = run(0, 13);
  assert.equal(runtimeFailure.status, 13, 'real runtime configuration errors must remain failures');
  assert.equal(runtimeFailure.stdout, 'permanent\nruntime\n');
  assert.match(runtimeFailure.stderr, /mock runtime failure/);
});

test('firewalld port selection follows the server route interface and falls back only to the default zone', () => {
  const interfaceHelper = installer.match(/detect_server_route_interface\(\) \{[\s\S]*?\n\}/)?.[0];
  const zoneHelper = installer.match(/detect_firewalld_zone\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(interfaceHelper, 'expected the server route-interface helper');
  assert.ok(zoneHelper, 'expected the route-specific firewalld zone helper');

  const run = (route, defaults, interfaceZone, defaultZone) => spawnSync(bashPath, ['-c', `
    set -eu
    ${interfaceHelper}
    ${zoneHelper}
    ip() {
      case "$*" in
        "-4 route get 1.1.1.1") printf '%s\\n' "$MOCK_ROUTE" ;;
        "-4 route show default") printf '%s\\n' "$MOCK_DEFAULTS" ;;
        *) return 1 ;;
      esac
    }
    firewall-cmd() {
      case "$*" in
        "--get-zone-of-interface=ens192") printf '%s\\n' "$MOCK_INTERFACE_ZONE" ;;
        "--get-default-zone") printf '%s\\n' "$MOCK_DEFAULT_ZONE" ;;
        *) return 1 ;;
      esac
    }
    detect_firewalld_zone
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_ROUTE: route,
      MOCK_DEFAULTS: defaults,
      MOCK_INTERFACE_ZONE: interfaceZone,
      MOCK_DEFAULT_ZONE: defaultZone,
    },
  });

  const routedZone = run('1.1.1.1 via 10.123.89.1 dev ens192 src 10.123.89.19 uid 0', '', 'public', 'docker');
  assert.equal(routedZone.status, 0, routedZone.stderr);
  assert.equal(routedZone.stdout.trim(), 'public');

  const defaultZoneFallback = run('1.1.1.1 via 10.123.89.1 dev ens192 src 10.123.89.19 uid 0', '', 'no zone', 'public');
  assert.equal(defaultZoneFallback.status, 0, defaultZoneFallback.stderr);
  assert.equal(defaultZoneFallback.stdout.trim(), 'public');

  const defaultRouteFallback = run('', 'default via 10.123.89.1 dev ens192 proto dhcp', 'public', 'docker');
  assert.equal(defaultRouteFallback.status, 0, defaultRouteFallback.stderr);
  assert.equal(defaultRouteFallback.stdout.trim(), 'public');

  const unknownInterface = run('', '', 'public', 'docker');
  assert.notEqual(unknownInterface.status, 0, 'do not open every active zone when the server route is unknown');
});

test('README documents the GitHub one-line installer and repeated update command', () => {
  assert.match(readme, /curl -fsSL https:\/\/raw\.githubusercontent\.com\/AJorge95\/OpenLearning\/main\/scripts\/install\.sh \| sudo bash/);
  assert.match(readme, /Run the same command again to update/);
  assert.match(readme, /Ubuntu 22\.04 or newer, or RHEL 9/);
  assert.match(readme, /private configuration at `\/etc\/openlearning\/\.env`/);
  assert.match(readme, /OPENLEARNING_COMMIT/);
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
