import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const installer = fs.readFileSync(new URL('../../scripts/install.sh', import.meta.url), 'utf8');
const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8');
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
  assert.match(installer, /DEFAULT_PORT="\$PORT"/);
  assert.match(installer, /apt-get install .*iproute2/);
  assert.match(installer, /dnf install .*iproute/);
});

test('installer reports the kernel-selected server IPv4 without network probing', (context) => {
  const detector = installer.match(/detect_server_ipv4\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(detector, 'expected the server IPv4 discovery helper');
  assert.match(detector, /ip -4 route get 1\.1\.1\.1/);
  assert.match(installer, /http:\/\/\$SERVER_IPV4:\$SERVICE_PORT/);
  assert.doesNotMatch(installer, /curl[^\n]*1\.1\.1\.1|ping[^\n]*1\.1\.1\.1/);
  assert.match(readme, /prints the IPv4 address selected by the host's default route/);
  assert.match(readme, /selected address may be private/);

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
  assert.match(readme, /per-job local destinations and retention/);
});

test('installer keeps the service on the package-required Node.js major', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.engines.node, />=\s*24/);
  assert.equal([...installer.matchAll(/setup_24\.x/g)].length, 2);
  assert.match(installer, /NODE_MAJOR >= 24/);
});

test('installer opens the configured application port in active local firewalls', () => {
  assert.match(installer, /ufw status.*Status: active/s);
  assert.match(installer, /ufw allow "\$SERVICE_PORT\/tcp"/);
  assert.match(installer, /firewall-cmd --state/);
  assert.match(installer, /firewall-cmd --get-zone-of-interface="\$interface"/);
  assert.match(installer, /configure_firewalld_port "\$FIREWALL_ZONE"/);
  assert.doesNotMatch(installer, /firewall-cmd --get-active-zones/);
  assert.match(installer, /firewall-cmd --reload/);
  assert.match(readme, /does not enable a firewall/i);
});

test('firewalld port setup is idempotent for existing rules and rejects real command errors', () => {
  const helper = installer.match(/configure_firewalld_port\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helper, 'expected the firewalld port setup helper');
  const run = (addStatus) => spawnSync(bashPath, ['-c', `
    set -eu
    SERVICE_PORT=6173
    MOCK_RELOAD_CALLED=false
    ${helper}
    firewall-cmd() {
      case "$*" in
        "--zone=public --permanent --add-port=6173/tcp")
          printf 'mock add result\n'
          return "$MOCK_ADD_STATUS"
          ;;
        "--reload") MOCK_RELOAD_CALLED=true ;;
        *) return 2 ;;
      esac
    }
    configure_firewalld_port public
    printf 'reload-called=%s\n' "$MOCK_RELOAD_CALLED"
  `], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_ADD_STATUS: String(addStatus) },
  });

  const added = run(0);
  assert.equal(added.status, 0, added.stderr);
  assert.equal(added.stdout.trim(), 'reload-called=true');

  const alreadyEnabled = run(11);
  assert.equal(alreadyEnabled.status, 0, alreadyEnabled.stderr);
  assert.equal(alreadyEnabled.stdout.trim(), 'reload-called=true');
  assert.equal(alreadyEnabled.stderr, '', 'the documented already-enabled warning is handled quietly');

  const commandFailure = run(13);
  assert.equal(commandFailure.status, 13, 'real firewalld errors must remain failures');
  assert.match(commandFailure.stderr, /mock add result/);
  assert.equal(commandFailure.stdout, '', 'do not reload after a real port-add failure');
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
  assert.match(readme, /creates the protected deployment `\.env` file at `\/etc\/openlearning\/\.env`/);
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
