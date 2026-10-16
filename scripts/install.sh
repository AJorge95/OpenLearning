#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="OpenLearning"
SERVICE_NAME="openlearning"
REPOSITORY="AJorge95/OpenLearning"
BRANCH="main"
INSTALL_ROOT="/opt/openlearning"
RELEASES_DIR="$INSTALL_ROOT/releases"
CURRENT_LINK="$INSTALL_ROOT/current"
CONFIG_DIR="/etc/openlearning"
ENV_FILE="$CONFIG_DIR/.env"
DATA_DIR="/var/lib/openlearning"
BACKUP_ROOT="/var/backups/openlearning"
# Installed production builds serve both the browser UI and API on this port.
PORT="5173"
REQUESTED_PORT="${OPENLEARNING_PORT:-}"

log() { printf '[openlearning] %s\n' "$*"; }
fail() { printf '[openlearning] ERROR: %s\n' "$*" >&2; exit 1; }

normalize_port() {
  local requested_port="$1"
  [[ "$requested_port" =~ ^[0-9]{1,5}$ ]] || return 1
  (( 10#$requested_port >= 1 && 10#$requested_port <= 65535 )) || return 1
  printf '%s\n' "$((10#$requested_port))"
}

detect_server_ipv4() {
  local route_output=""
  local address=""
  local default_interface=""

  command -v ip >/dev/null 2>&1 || return 1

  # Ask the kernel which source address it would use for an outbound route;
  # this reads routing state and does not send a network probe.
  if route_output="$(ip -4 route get 1.1.1.1 2>/dev/null)"; then
    address="$(awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }' <<< "$route_output")"
    if [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$address" != 127.* && "$address" != 169.254.* ]]; then
      printf '%s\n' "$address"
      return 0
    fi
  fi

  # If route lookup omits a preferred source, use the first address on the
  # default-route interface instead of accidentally selecting a Docker bridge.
  if route_output="$(ip -4 route show default 2>/dev/null)"; then
    default_interface="$(awk 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }' <<< "$route_output")"
  fi
  if [[ -n "$default_interface" ]] && route_output="$(ip -o -4 addr show dev "$default_interface" scope global 2>/dev/null)"; then
    address="$(awk 'NR == 1 { split($4, cidr, "/"); print cidr[1] }' <<< "$route_output")"
    if [[ "$address" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ && "$address" != 127.* && "$address" != 169.254.* ]]; then
      printf '%s\n' "$address"
      return 0
    fi
  fi

  return 1
}

detect_server_route_interface() {
  local route_output=""
  local interface=""

  command -v ip >/dev/null 2>&1 || return 1

  if route_output="$(ip -4 route get 1.1.1.1 2>/dev/null)"; then
    interface="$(awk '{ for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }' <<< "$route_output")"
  fi
  if [[ -z "$interface" ]] && route_output="$(ip -4 route show default 2>/dev/null)"; then
    interface="$(awk 'NR == 1 { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }' <<< "$route_output")"
  fi

  [[ "$interface" =~ ^[[:alnum:]_.:-]+$ ]] || return 1
  printf '%s\n' "$interface"
}

detect_firewalld_zone() {
  local interface=""
  local zone=""

  interface="$(detect_server_route_interface)" || return 1
  zone="$(firewall-cmd --get-zone-of-interface="$interface" 2>/dev/null)" || zone=""
  if [[ -z "$zone" || "$zone" == "no zone" ]]; then
    zone="$(firewall-cmd --get-default-zone 2>/dev/null)" || return 1
  fi
  [[ -n "$zone" ]] || return 1
  printf '%s\n' "$zone"
}

configure_firewalld_port() {
  local zone="$1"
  local add_output=""
  local add_status=0
  local config_mode=""

  # Change only this rule in both configurations; a global reload would drop
  # unrelated runtime-only firewall rules on the host.
  for config_mode in permanent runtime; do
    add_status=0
    if [[ "$config_mode" == permanent ]]; then
      add_output="$(firewall-cmd --zone="$zone" --permanent --add-port="$SERVICE_PORT/tcp" 2>&1)" || add_status=$?
    else
      add_output="$(firewall-cmd --zone="$zone" --add-port="$SERVICE_PORT/tcp" 2>&1)" || add_status=$?
    fi

    # firewalld uses ALREADY_ENABLED (11) when the rule already exists.
    if [[ "$add_status" -ne 0 && "$add_status" -ne 11 ]]; then
      [[ -z "$add_output" ]] || printf '%s\n' "$add_output" >&2
      return "$add_status"
    fi
  done
}

package_manager_for() {
  local os_id="$1"
  local os_version="$2"
  local os_major="${os_version%%.*}"
  case "$os_id" in
    ubuntu)
      [[ "$os_major" =~ ^[0-9]+$ ]] && (( os_major >= 22 )) || return 1
      printf 'apt-get\n'
      ;;
    rhel|rocky|almalinux|ol|centos|fedora)
      [[ "$os_major" =~ ^[0-9]+$ ]] && (( os_major >= 9 )) || return 1
      printf 'dnf\n'
      ;;
    *) return 1 ;;
  esac
}

has_required_node_runtime() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm >/dev/null 2>&1 || return 1
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" || return 1
  [[ "$node_major" =~ ^[0-9]+$ ]] && (( node_major >= 24 ))
}

configured_port() {
  local environment_file="$1"
  local default_port="${2:-5173}"
  ENV_FILE="$environment_file" DEFAULT_PORT="$default_port" node --input-type=module -e 'import fs from "node:fs"; import dotenv from "dotenv"; console.log(dotenv.parse(fs.readFileSync(process.env.ENV_FILE)).PORT || process.env.DEFAULT_PORT)'
}

normalize_release_permissions() {
  local release_path="$1"
  # The installer is root-owned, but systemd starts the service as the
  # unprivileged openlearning user. Keep code immutable to that user while
  # making every release directory traversable and every release file readable.
  chown -R root:root "$release_path"
  find "$release_path" -type d -exec chmod 0755 {} +
  find "$release_path" -type f ! -perm /111 -exec chmod 0644 {} +
  find "$release_path" -type f -perm /111 -exec chmod 0755 {} +
}

restore_environment_config() {
  [[ "$RESTORE_CONFIG_ON_FAILURE" == true ]] || return 0
  if [[ "$CONFIG_SNAPSHOT_EXISTS" == true ]]; then
    cp -a -- "$CONFIG_SNAPSHOT" "$ENV_FILE" || return 1
  else
    rm -f -- "$ENV_FILE" || return 1
  fi
  RESTORE_CONFIG_ON_FAILURE=false
}

prepare_storage_access() {
  local storage_directory="$1"
  local parent_directory
  # Legacy storage can live below a private home directory. Grant only this
  # service account traversal, without opening home-directory listings to others.
  parent_directory="$(dirname "$storage_directory")"
  while [[ "$parent_directory" != / ]]; do
    if ! runuser -u openlearning -- test -x "$parent_directory"; then
      setfacl -m u:openlearning:--x "$parent_directory" || return 1
    fi
    parent_directory="$(dirname "$parent_directory")"
  done
  chown openlearning:openlearning "$storage_directory" || return 1
  chmod u+rwx "$storage_directory"
}

usage() {
  cat <<'EOF'
OpenLearning Linux installer and updater

Usage: install.sh [--help]

Installs or updates the OpenLearning systemd service from the latest main
branch on Ubuntu 22.04+ and RHEL 9+ (including compatible derivatives).
The web client and API share port 5173 and /etc/openlearning/.env.
Set OPENLEARNING_PORT to explicitly select another port.
Set OPENLEARNING_COMMIT to a full 40-character commit SHA to install that exact source revision.
Use --check-support <distribution> <version> to check distro support without installing.
Run as root, for example:
  curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo bash
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then usage; exit 0; fi
if [[ "${1:-}" == "--check-support" ]]; then
  [[ $# -eq 3 ]] || fail "Usage: install.sh --check-support <distribution> <version>"
  if PACKAGE_MANAGER="$(package_manager_for "$2" "$3")"; then
    printf 'Supported: %s %s (%s)\n' "$2" "$3" "$PACKAGE_MANAGER"
    exit 0
  fi
  fail "Unsupported distribution or version: $2 $3"
fi
[[ $# -eq 0 ]] || fail "Unknown option: $1"
SOURCE_COMMIT="${OPENLEARNING_COMMIT:-}"
if [[ -n "$SOURCE_COMMIT" && ! "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  fail "OPENLEARNING_COMMIT must be a full 40-character lowercase commit SHA."
fi
if [[ -n "$REQUESTED_PORT" ]]; then
  if ! PORT="$(normalize_port "$REQUESTED_PORT")"; then
    fail "OPENLEARNING_PORT must be a whole-number TCP port between 1 and 65535."
  fi
  # Normalize leading zeroes before writing the value to the service config.
  REQUESTED_PORT="$PORT"
fi
[[ "$(id -u)" -eq 0 ]] || fail "Run this installer as root, for example: curl -fsSL https://raw.githubusercontent.com/$REPOSITORY/$BRANCH/scripts/install.sh | sudo bash"

command -v systemctl >/dev/null 2>&1 || fail "systemd is required."
[[ -r /etc/os-release ]] || fail "Cannot identify this Linux distribution."
# shellcheck source=/etc/os-release
. /etc/os-release
OS_ID="${ID:-}"
OS_VERSION="${VERSION_ID:-}"
if ! PACKAGE_MANAGER="$(package_manager_for "$OS_ID" "$OS_VERSION")"; then
  fail "Unsupported distribution or version '$OS_ID $OS_VERSION'. Supported: Ubuntu 22.04+ and RHEL 9+ compatible systems."
fi

for managed_path in "$INSTALL_ROOT" "$RELEASES_DIR" "$CONFIG_DIR" "$DATA_DIR" "$BACKUP_ROOT"; do
  [[ ! -L "$managed_path" ]] || fail "Refusing to use a symlink for a managed path: $managed_path"
done
[[ ! -L "$ENV_FILE" ]] || fail "Refusing to write through a symlinked environment file: $ENV_FILE"

OLD_UNIT_PRESENT=false
OLD_WORKING_DIRECTORY=""
OLD_ENV_FILE=""
OLD_UNIT_FRAGMENT=""
UNIT_SNAPSHOT=""
CONFIG_SNAPSHOT=""
CONFIG_SNAPSHOT_EXISTS=false
RESTORE_CONFIG_ON_FAILURE=false
NEW_RELEASE=""
RELEASE_FINALIZED=false
if systemctl cat "$SERVICE_NAME.service" >/dev/null 2>&1; then
  OLD_UNIT_PRESENT=true
  OLD_UNIT_FRAGMENT="$(systemctl show --property=FragmentPath --value "$SERVICE_NAME.service" 2>/dev/null || true)"
  [[ -n "$OLD_UNIT_FRAGMENT" && -f "$OLD_UNIT_FRAGMENT" ]] || fail "Found $SERVICE_NAME.service but its unit file cannot be backed up safely."
  [[ ! -L "/etc/systemd/system/$SERVICE_NAME.service" ]] || fail "The existing service unit is a symlink; convert it to a regular unit file before adoption."
  if [[ -n "$(systemctl show --property=DropInPaths --value "$SERVICE_NAME.service" 2>/dev/null || true)" ]]; then
    fail "The existing service has systemd drop-in overrides. Consolidate them into its main unit or remove them before adoption."
  fi
  OLD_WORKING_DIRECTORY="$(systemctl show --property=WorkingDirectory --value "$SERVICE_NAME.service" 2>/dev/null || true)"
  [[ -n "$OLD_WORKING_DIRECTORY" ]] || fail "Found $SERVICE_NAME.service but could not determine its working directory; refusing to replace it."
  [[ -d "$OLD_WORKING_DIRECTORY" ]] || fail "Existing service working directory does not exist: $OLD_WORKING_DIRECTORY"
  if systemctl cat "$SERVICE_NAME.service" | grep -Eq '^[[:space:]]*Environment='; then
    fail "Preflight stopped before package installation: the existing service defines inline Environment values. Move them into one EnvironmentFile before adopting it, so configuration can be preserved safely."
  fi
  # Prefer the environment file explicitly referenced by the unit.
  mapfile -t EXISTING_ENV_FILES < <(systemctl cat "$SERVICE_NAME.service" | sed -nE 's/^[[:space:]]*EnvironmentFile=-?([^[:space:]]+).*$/\1/p')
  [[ "${#EXISTING_ENV_FILES[@]}" -le 1 ]] || fail "The existing service references multiple EnvironmentFile entries; combine them into one file before adoption."
  OLD_ENV_FILE="${EXISTING_ENV_FILES[0]:-}"
  if [[ -z "$OLD_ENV_FILE" && -f "$ENV_FILE" ]]; then OLD_ENV_FILE="$ENV_FILE"; fi
  if [[ -z "$OLD_ENV_FILE" && -f "$OLD_WORKING_DIRECTORY/.env" ]]; then OLD_ENV_FILE="$OLD_WORKING_DIRECTORY/.env"; fi
  [[ -n "$OLD_ENV_FILE" && -r "$OLD_ENV_FILE" ]] || fail "The existing service has no readable environment file. Add one or migrate its configuration manually before rerunning this installer."
fi

if [[ "$PACKAGE_MANAGER" == apt-get ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl tar xz-utils build-essential python3 acl util-linux iproute2
  NODE_SETUP_FILE="$(mktemp /tmp/openlearning-nodesource-setup.XXXXXX)"
  curl -fsSL https://deb.nodesource.com/setup_24.x -o "$NODE_SETUP_FILE"
  bash "$NODE_SETUP_FILE"
  rm -f "$NODE_SETUP_FILE"
  apt-get install -y nodejs
else
  dnf install -y ca-certificates curl tar xz gcc gcc-c++ make python3 acl util-linux iproute
  if has_required_node_runtime; then
    log "Using existing Node.js $(node --version) and npm; skipping NodeSource repository setup."
  else
    NODE_SETUP_FILE="$(mktemp /tmp/openlearning-nodesource-setup.XXXXXX)"
    curl -fsSL https://rpm.nodesource.com/setup_24.x -o "$NODE_SETUP_FILE"
    bash "$NODE_SETUP_FILE"
    rm -f "$NODE_SETUP_FILE"
    dnf install -y nodejs
  fi
fi

command -v node >/dev/null 2>&1 || fail "Node.js installation did not provide node."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 24 )) || fail "Node.js 24 or newer is required; found $(node --version)."
command -v npm >/dev/null 2>&1 || fail "Node.js installation did not provide npm."

# The service runs as an unprivileged account and must be able to traverse the
# root-owned code directories to reach its release through the current symlink.
install -d -m 0755 "$INSTALL_ROOT" "$RELEASES_DIR" "$CONFIG_DIR" "$DATA_DIR" "$BACKUP_ROOT"
chown root:root "$INSTALL_ROOT" "$RELEASES_DIR"
chmod 0755 "$INSTALL_ROOT" "$RELEASES_DIR"
chmod 0700 "$CONFIG_DIR"
chmod 0750 "$DATA_DIR" "$BACKUP_ROOT"

RELEASE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
NEW_RELEASE="$RELEASES_DIR/$RELEASE_ID"
ARCHIVE="$(mktemp /tmp/openlearning-main.XXXXXX.tar.gz)"
STAGING="$(mktemp -d /tmp/openlearning-source.XXXXXX)"
SOURCE_ARCHIVE_URL="https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/$BRANCH"
SOURCE_LABEL="latest $BRANCH source"
if [[ -n "$SOURCE_COMMIT" ]]; then
  SOURCE_ARCHIVE_URL="https://codeload.github.com/$REPOSITORY/tar.gz/$SOURCE_COMMIT"
  SOURCE_LABEL="commit $SOURCE_COMMIT"
fi
if [[ "$OLD_UNIT_PRESENT" == true ]]; then
  UNIT_SNAPSHOT="$(mktemp -d /tmp/openlearning-unit.XXXXXX)"
  cp -a "$OLD_UNIT_FRAGMENT" "$UNIT_SNAPSHOT/original-unit"
fi
cleanup() {
  if [[ "$RESTORE_CONFIG_ON_FAILURE" == true ]] && ! restore_environment_config; then
    log "WARNING: Could not restore the previous service configuration from $CONFIG_SNAPSHOT."
  fi
  rm -f "$ARCHIVE" "${NODE_SETUP_FILE:-}"
  rm -f "${CONFIG_SNAPSHOT:-}"
  rm -rf "$STAGING" "${UNIT_SNAPSHOT:-}"
  # Failed downloads, builds, or readiness checks must not accumulate unusable releases.
  if [[ "$RELEASE_FINALIZED" != true && -n "$NEW_RELEASE" && -d "$NEW_RELEASE" ]]; then
    rm -rf -- "$NEW_RELEASE"
  fi
}
trap cleanup EXIT
log "Downloading $SOURCE_LABEL from GitHub."
curl -fL --retry 3 "$SOURCE_ARCHIVE_URL" -o "$ARCHIVE"
tar -xzf "$ARCHIVE" -C "$STAGING" --strip-components=1
install -d -m 0755 "$NEW_RELEASE"
cp -a "$STAGING/." "$NEW_RELEASE/"
chown -R root:root "$NEW_RELEASE"
cd "$NEW_RELEASE"
npm ci
npm run build
normalize_release_permissions "$NEW_RELEASE"

if [[ "$OLD_UNIT_PRESENT" == true ]]; then
  log "Reading the current service configuration and resolving its data paths."
  EXPECT_READY=false
  # Probe the currently running port before an explicit override changes the
  # migrated configuration; this preserves the stronger readiness check.
  EXISTING_PORT="$(configured_port "$OLD_ENV_FILE" 6173)"
  if curl -fsS "http://127.0.0.1:$EXISTING_PORT/readyz" >/dev/null 2>&1; then EXPECT_READY=true; fi
  if [[ -e "$ENV_FILE" ]]; then
    CONFIG_SNAPSHOT="$(mktemp /tmp/openlearning-env.XXXXXX)"
    cp -a -- "$ENV_FILE" "$CONFIG_SNAPSHOT"
    CONFIG_SNAPSHOT_EXISTS=true
  fi
  RESTORE_CONFIG_ON_FAILURE=true
  OLD_WORKING_DIRECTORY="$OLD_WORKING_DIRECTORY" OLD_ENV_FILE="$OLD_ENV_FILE" NEW_ENV_FILE="$ENV_FILE" INSTALL_PORT_OVERRIDE="$REQUESTED_PORT" node scripts/migrate-install-config.js
else
  EXPECT_READY=false
  if [[ ! -e "$ENV_FILE" ]]; then
    SESSION_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))')"
    SETUP_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
    umask 077
    cat > "$ENV_FILE" <<EOF
PORT=$PORT
DATA_DIR=$DATA_DIR
BACKUP_DIR=$BACKUP_ROOT
SESSION_SECRET=$SESSION_SECRET
SETUP_TOKEN=$SETUP_TOKEN
TRUST_PROXY=false
EOF
    chmod 0600 "$ENV_FILE"
    printf '\nOpenLearning setup token (shown once): %s\n' "$SETUP_TOKEN"
    unset SESSION_SECRET SETUP_TOKEN
  fi
fi

if [[ "$OLD_UNIT_PRESENT" == true ]]; then
  WAS_ACTIVE=false
  systemctl is-active --quiet "$SERVICE_NAME.service" && WAS_ACTIVE=true || true
  systemctl stop "$SERVICE_NAME.service" || true
  if systemctl is-active --quiet "$SERVICE_NAME.service"; then fail "Could not stop the existing service; refusing to back up or replace a running deployment."; fi
  log "Creating a verified pre-update database and media backup."
  BACKUP_PATH_FILE="$(mktemp /tmp/openlearning-backup-path.XXXXXX)"
  export BACKUP_PATH_FILE ENV_FILE BACKUP_ROOT
  BACKUP_EXIT=0
  node --input-type=module <<'NODE' || BACKUP_EXIT=$?
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import dotenv from 'dotenv';
const values = dotenv.parse(fs.readFileSync(process.env.ENV_FILE));
const database = values.DB_PATH || `${values.DATA_DIR || '/var/lib/openlearning'}/openlearning.sqlite`;
if (!fs.existsSync(database)) process.exit(0);
const result = spawnSync('npm', ['run', 'backup'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, ...values, BACKUP_DIR: process.env.BACKUP_ROOT },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.status !== 0) process.exit(result.status || 1);
const match = `${result.stdout || ''}${result.stderr || ''}`.match(/Backup created at (.+)/);
if (match) fs.writeFileSync(process.env.BACKUP_PATH_FILE, match[1].trim());
NODE
  if [[ "$BACKUP_EXIT" -ne 0 || ! -s "$BACKUP_PATH_FILE" ]]; then
    rm -f "$BACKUP_PATH_FILE"
    if ! restore_environment_config; then
      log "WARNING: Could not restore the previous service configuration from $CONFIG_SNAPSHOT."
    fi
    if [[ "$WAS_ACTIVE" == true ]]; then systemctl start "$SERVICE_NAME.service" || true; fi
    fail "Existing database was not found or a verified backup could not be created; refusing to update."
  fi
  BACKUP_PATH="$(cat "$BACKUP_PATH_FILE")"
  rm -f "$BACKUP_PATH_FILE"
else
  WAS_ACTIVE=false
fi

mapfile -t STORAGE_PATHS < <(ENV_FILE="$ENV_FILE" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const values = dotenv.parse(fs.readFileSync(process.env.ENV_FILE));
const dataDir = path.resolve(values.DATA_DIR || '/var/lib/openlearning');
const dbPath = path.resolve(values.DB_PATH || path.join(dataDir, 'openlearning.sqlite'));
const mediaRoot = path.resolve(values.MEDIA_ROOT || path.join(dataDir, 'course-media'));
const sharedDirectories = new Set(['/', '/var', '/var/lib', '/var/backups', '/etc', '/usr', '/opt', '/home', '/root', '/tmp', '/run', '/mnt', '/srv']);
for (const item of [dataDir, path.dirname(dbPath), mediaRoot, dbPath]) {
  if (/[\s\\]/.test(item)) throw new Error('Data, database, and media paths must not contain whitespace or backslashes for systemd path safety.');
  if (sharedDirectories.has(item)) throw new Error(`Refusing to use a shared system directory as application storage: ${item}`);
  if (item.startsWith('/root/')) throw new Error(`OpenLearning runs as a dedicated user and cannot store data under /root: ${item}`);
  const segments = item.split(path.sep).filter(Boolean);
  let current = path.parse(item).root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlinked persistent storage path: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  console.log(item);
}
NODE
)
[[ "${#STORAGE_PATHS[@]}" -eq 4 ]] || fail "Could not safely resolve persistent storage paths from $ENV_FILE."
for storage_path in "${STORAGE_PATHS[0]}" "${STORAGE_PATHS[1]}" "${STORAGE_PATHS[2]}"; do install -d -m 0750 "$storage_path"; done
READ_WRITE_PATHS="${STORAGE_PATHS[0]} ${STORAGE_PATHS[1]} ${STORAGE_PATHS[2]} $BACKUP_ROOT"

PREVIOUS_RELEASE=""
if [[ -L "$CURRENT_LINK" ]]; then
  [[ -e "$CURRENT_LINK" ]] || fail "The managed current-release symlink is broken: $CURRENT_LINK"
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
fi
if [[ -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then fail "The managed current-release path exists but is not a symlink: $CURRENT_LINK"; fi
ln -sfn "$NEW_RELEASE" "$CURRENT_LINK"
cat > "/etc/systemd/system/$SERVICE_NAME.service" <<EOF
[Unit]
Description=OpenLearning self-hosted learning platform
After=network.target

[Service]
Type=simple
User=openlearning
Group=openlearning
WorkingDirectory=$CURRENT_LINK
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node scripts/start.js
Restart=on-failure
RestartSec=5
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$READ_WRITE_PATHS

[Install]
WantedBy=multi-user.target
EOF

if ! getent group openlearning >/dev/null; then groupadd --system openlearning; fi
if ! id openlearning >/dev/null 2>&1; then useradd --system --gid openlearning --home-dir /var/lib/openlearning --shell /sbin/nologin openlearning; fi
chown -R openlearning:openlearning "$DATA_DIR"
chown openlearning:openlearning "${STORAGE_PATHS[1]}"
chown -R openlearning:openlearning "${STORAGE_PATHS[2]}"
if [[ -e "${STORAGE_PATHS[3]}" ]]; then chown openlearning:openlearning "${STORAGE_PATHS[3]}"; fi
chown openlearning:openlearning "$BACKUP_ROOT"
chmod 0750 "$DATA_DIR" "$BACKUP_ROOT"
# Use resolved DATA_DIR as well as independently configured database/media roots.
# Checking as root would hide exactly the permission errors the daemon sees.
STORAGE_ACCESS_OK=true
for storage_path in "${STORAGE_PATHS[0]}" "${STORAGE_PATHS[1]}" "${STORAGE_PATHS[2]}" "$BACKUP_ROOT"; do
  if ! prepare_storage_access "$storage_path"; then
    log "Could not prepare service-account storage permissions: $storage_path"
    STORAGE_ACCESS_OK=false
  fi
done
for storage_path in "${STORAGE_PATHS[0]}" "${STORAGE_PATHS[1]}" "${STORAGE_PATHS[2]}" "$BACKUP_ROOT"; do
  if ! runuser -u openlearning -- test -r "$storage_path" ||
     ! runuser -u openlearning -- test -w "$storage_path" ||
     ! runuser -u openlearning -- test -x "$storage_path"; then
    log "Service account cannot read, write, or traverse storage: $storage_path"
    STORAGE_ACCESS_OK=false
  fi
done
STARTED=false
if [[ "$STORAGE_ACCESS_OK" == true ]] && systemctl daemon-reload && systemctl enable "$SERVICE_NAME.service" && systemctl restart "$SERVICE_NAME.service"; then STARTED=true; fi

READY=false
SERVICE_PORT="$(configured_port "$ENV_FILE")"
if [[ ! "$SERVICE_PORT" =~ ^[0-9]{1,5}$ ]] || (( 10#$SERVICE_PORT < 1 || 10#$SERVICE_PORT > 65535 )); then
  fail "The configured service port is invalid: $SERVICE_PORT"
fi
if [[ "$STARTED" == true ]]; then
  log "Checking application health over HTTP on 127.0.0.1:$SERVICE_PORT (local to this server)."
  for _attempt in $(seq 1 30); do
    ENDPOINT="healthz"
    [[ "$EXPECT_READY" == true ]] && ENDPOINT="readyz"
    if curl -fsS "http://127.0.0.1:$SERVICE_PORT/$ENDPOINT" >/dev/null 2>&1; then READY=true; break; fi
    if systemctl is-failed --quiet "$SERVICE_NAME.service"; then break; fi
    sleep 2
  done
fi
if [[ "$READY" == true ]]; then
  log "Checking the browser page and its JavaScript/CSS assets on the application port."
  if ! node scripts/check-web-client.js "http://127.0.0.1:$SERVICE_PORT"; then READY=false; fi
fi
if [[ "$READY" != true ]]; then
  log "Readiness check failed; restoring the previous release."
  systemctl stop "$SERVICE_NAME.service" || true
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
  else
    rm -f "$CURRENT_LINK"
  fi
  if [[ "$OLD_UNIT_PRESENT" == true ]]; then
    if [[ "$OLD_UNIT_FRAGMENT" == "/etc/systemd/system/$SERVICE_NAME.service" ]]; then
      cp -a "$UNIT_SNAPSHOT/original-unit" "$OLD_UNIT_FRAGMENT"
    else
      rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    fi
  else
    rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl disable "$SERVICE_NAME.service" >/dev/null 2>&1 || true
  fi
  systemctl daemon-reload
  if [[ -n "${BACKUP_PATH:-}" && -d "$BACKUP_PATH" ]]; then
    ENV_FILE="$ENV_FILE" BACKUP_PATH="$BACKUP_PATH" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
const values = dotenv.parse(fs.readFileSync(process.env.ENV_FILE));
const dataDir = path.resolve(values.DATA_DIR || '/var/lib/openlearning');
const dbPath = path.resolve(values.DB_PATH || path.join(dataDir, 'openlearning.sqlite'));
const mediaRoot = path.resolve(values.MEDIA_ROOT || path.join(dataDir, 'course-media'));
fs.copyFileSync(path.join(process.env.BACKUP_PATH, 'openlearning.sqlite'), dbPath);
fs.rmSync(mediaRoot, { recursive: true, force: true });
fs.cpSync(path.join(process.env.BACKUP_PATH, 'course-media'), mediaRoot, { recursive: true });
NODE
    chown openlearning:openlearning "${STORAGE_PATHS[1]}"
    chown -R openlearning:openlearning "${STORAGE_PATHS[2]}"
    chown openlearning:openlearning "${STORAGE_PATHS[3]}"
  fi
  # Restore data using the migrated absolute paths before restoring the old
  # environment, which can contain paths relative to the previous release.
  if ! restore_environment_config; then
    log "WARNING: Could not restore the previous service configuration from $CONFIG_SNAPSHOT."
  fi
  if [[ "$OLD_UNIT_PRESENT" == true && "$WAS_ACTIVE" == true ]]; then systemctl start "$SERVICE_NAME.service" || true; fi
  journalctl -u "$SERVICE_NAME.service" -n 30 --no-pager >&2 || true
  fail "OpenLearning did not become ready. The prior code release has been restored; inspect the service logs."
fi
RESTORE_CONFIG_ON_FAILURE=false
RELEASE_FINALIZED=true

FIREWALL_CONFIGURED=false
FIREWALL_FAILED=false
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
  if ufw allow "$SERVICE_PORT/tcp"; then
    log "Allowed TCP port $SERVICE_PORT through the active UFW firewall."
    FIREWALL_CONFIGURED=true
  else
    log "WARNING: Could not add TCP port $SERVICE_PORT to UFW; configure it manually."
    FIREWALL_FAILED=true
  fi
fi
if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
  if FIREWALL_ZONE="$(detect_firewalld_zone)"; then
    if configure_firewalld_port "$FIREWALL_ZONE"; then
      log "Allowed TCP port $SERVICE_PORT through the firewalld zone for the server route: $FIREWALL_ZONE."
      FIREWALL_CONFIGURED=true
    else
      log "WARNING: Could not add TCP port $SERVICE_PORT to firewalld zone $FIREWALL_ZONE; configure it manually."
      FIREWALL_FAILED=true
    fi
  else
    log "WARNING: Could not determine the firewalld zone for the server route; configure TCP port $SERVICE_PORT manually."
    FIREWALL_FAILED=true
  fi
fi
if [[ "$FIREWALL_CONFIGURED" == false ]]; then
  log "No active UFW or firewalld firewall was configured. If another firewall is in use, allow inbound TCP port $SERVICE_PORT there."
fi

if [[ "$FIREWALL_FAILED" == true ]]; then
  fail "The app passes local web checks, but firewall configuration failed. Allow TCP port $SERVICE_PORT before connecting from another computer."
fi
log "OpenLearning is ready on all IPv4 interfaces on port $SERVICE_PORT."
if SERVER_IPV4="$(detect_server_ipv4)"; then
  log "From a browser that can reach this server's network, open http://$SERVER_IPV4:$SERVICE_PORT."
else
  log "Could not determine the server IPv4 automatically; run 'ip -4 addr' and open http://<reachable-server-IP>:$SERVICE_PORT from another computer."
fi
log "Service: systemctl status $SERVICE_NAME; configuration: $ENV_FILE; data: $DATA_DIR"
