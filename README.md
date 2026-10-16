# OpenLearning

OpenLearning is a self-hosted learning platform with courses, video lessons, quizzes, learning paths, learner progress, and administrator and moderator tools. It stores application data in SQLite and serves the web client, API, and media from one Node.js process.

## Install on Linux

The one-command installer supports Ubuntu 22.04 or newer, or RHEL 9 or newer compatible systems with systemd. Run it as root:

```sh
curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo bash
```

It installs Node.js 24, builds the application, creates the `openlearning` service, and checks the page, assets, and health endpoint. On first install it creates a private configuration at `/etc/openlearning/.env`, stores data under `/var/lib/openlearning`, and prints a one-time setup token. Enter that token in the setup wizard, then remove `SETUP_TOKEN` from the environment file and restart the service:

```sh
sudo systemctl restart openlearning
```

Run the same command again to update. It backs up the database and course media before replacing an existing installation and restores the previous release and data if readiness checks fail. To install an exact revision, pass its full commit SHA:

```sh
OPENLEARNING_COMMIT="$(git rev-parse HEAD)"
curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo env OPENLEARNING_COMMIT="$OPENLEARNING_COMMIT" bash
```

The service listens on port `5173` by default. To choose another port, pass `OPENLEARNING_PORT` to `sudo env`, for example: `curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo env OPENLEARNING_PORT=5173 bash`. The installer opens the port in an active local UFW or firewalld configuration and prints the IPv4 address selected by the host's default route; that address may be private. It does not enable a firewall or change cloud firewalls, NAT, TLS, or reverse-proxy settings. Set `TRUST_PROXY=true` only behind a trusted proxy that supplies forwarding headers. The one-time setup token and session secret are private credentials; do not share `/etc/openlearning/.env`.

## Docker Compose

Compose uses the published GHCR image by default. Create persistent data and backup directories and secret files readable by the container's `node` user (UID 1000):

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /srv/openlearning/data /srv/openlearning/backups
umask 077
openssl rand -hex 32 > /srv/openlearning/session_secret
openssl rand -hex 32 > /srv/openlearning/setup_token
sudo chown 1000:1000 /srv/openlearning/session_secret /srv/openlearning/setup_token
sudo chmod 0440 /srv/openlearning/session_secret /srv/openlearning/setup_token
export OPENLEARNING_DATA_PATH=/srv/openlearning/data
export OPENLEARNING_BACKUP_PATH=/srv/openlearning/backups
export SESSION_SECRET_FILE=/srv/openlearning/session_secret
export SETUP_TOKEN_FILE=/srv/openlearning/setup_token
```

Start first-run setup, enter the displayed token in the wizard at `http://<server>:5173`, then deploy without the setup override:

```sh
docker compose -f compose.yaml -f compose.initial-setup.yaml up -d --pull always --no-build
cat /srv/openlearning/setup_token
docker compose -f compose.yaml up -d --pull always --no-build
rm /srv/openlearning/setup_token
```

Compose defaults to `ghcr.io/ajorge95/openlearning:latest`. To pin a deployment, set `OPENLEARNING_IMAGE` to `ghcr.io/ajorge95/openlearning:sha-<full-commit-sha>`. Set `OPENLEARNING_PORT` to change the host port. For a local build, use `docker compose up -d --build --pull never`. The data and backup directories remain on the host when the service is removed.

## Docker Swarm

Swarm runs one replica because SQLite, sessions, media, and the backup scheduler use local application storage. Create the bind-mount directories on the storage node and label that node:

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /srv/openlearning/data /srv/openlearning/backups
export OPENLEARNING_NODE=worker-1
export OPENLEARNING_DATA_PATH=/srv/openlearning/data
export OPENLEARNING_BACKUP_PATH=/srv/openlearning/backups
docker node update --label-add openlearning-data=true "$OPENLEARNING_NODE"
```

On a Swarm manager, create the external secrets and deploy with the first-run override:

```sh
umask 077
openssl rand -hex 32 > ./openlearning_session_secret
openssl rand -hex 32 > ./openlearning_setup_token
docker secret create openlearning_session_secret ./openlearning_session_secret
docker secret create openlearning_setup_token ./openlearning_setup_token
export OPENLEARNING_IMAGE=ghcr.io/ajorge95/openlearning:latest
docker stack deploy -c docker-stack.yml -c docker-stack.initial-setup.yml openlearning
cat ./openlearning_setup_token
```

Complete setup at `http://<storage-node>:5173`, then redeploy without the setup override:

```sh
docker stack deploy -c docker-stack.yml openlearning
```

Wait for `docker stack services openlearning` to show the service updated before deleting its setup secret. Swarm will not remove a secret still used by a service:

```sh
docker secret rm openlearning_setup_token
rm ./openlearning_setup_token ./openlearning_session_secret
```

The stack publishes port `5173` in host mode and requires `OPENLEARNING_IMAGE`, `OPENLEARNING_DATA_PATH`, and `OPENLEARNING_BACKUP_PATH` in the manager environment; `docker stack deploy` does not load a Compose `.env` file. Keep the service on one node with access to those paths. On SELinux-enforcing hosts such as RHEL, give the bind-mounted data and backup directories a container-accessible context such as `container_file_t`; Swarm ignores `:z` and `:Z` relabel options. Before an update, create and verify a backup. Swarm can roll back a failed image update, but it does not restore data or undo database migrations.

## Move a systemd installation to Docker

Create and verify a full backup in **Settings → Backups**, stop the service, and restore the database and media into the Docker data directory. Keep the original data and configuration until the container is verified. Do not run systemd and Docker against the same SQLite files at once. Changing the session secret signs users out.

## Run from source

Requires Node.js 24 or newer. The checkout uses one `.env` file for both commands:

```sh
npm ci
cp .env.example .env
```

Set `SESSION_SECRET` and `SETUP_TOKEN` to separate random values of at least 32 characters before first use. Build and start the production server with `npm run build` and `npm start`. For development with live reload, use `npm run dev`. Both commands use port `5173` by default and the same `.env` file.

## Configuration

Set values in `.env` or the process environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5173` | HTTP port for the web client, API, and media. |
| `DATA_DIR` | `./data` | Base directory for the database and media. |
| `DB_PATH` | `DATA_DIR/openlearning.sqlite` | Optional database path override. |
| `MEDIA_ROOT` | `DATA_DIR/course-media` | Optional course-media path override. |
| `BACKUP_DIR` | `./backup` | Default location for application backups. |
| `SESSION_SECRET` / `SESSION_SECRET_FILE` | — | Session signing secret, provided directly or by a mounted file. Set one. |
| `SETUP_TOKEN` / `SETUP_TOKEN_FILE` | — | First-run setup credential, provided directly or by a mounted file. Set one; remove it after setup. |
| `TRUST_PROXY` | `false` | Set `true` only behind a trusted reverse proxy. |
| `MAX_UPLOAD_BYTES` | `2147483648` | Maximum size of one uploaded file, in bytes. |
| `REQUEST_TIMEOUT_MS` | `300000` | Maximum time to receive one HTTP request, in milliseconds. |

The installer and Docker examples configure persistent paths and secrets for their deployment method. `/healthz` checks that the HTTP process responds; `/readyz` reports whether initial setup is complete and the app can serve users.

## Back up and restore

Administrators can schedule daily or weekly database, course-media, or full backups in **Settings → Backups**, with per-job destinations and retention policies. Missed runs wait until the next scheduled time. `npm run backup` creates a verified, timestamped full backup using the same `DATA_DIR`, `DB_PATH`, and `MEDIA_ROOT` settings as the app; it reads `.env` and writes under `./backup` by default. Set `BACKUP_DIR` to choose another destination. Pause course edits and uploads while media is copied. The command checks the SQLite snapshot and media copies, rejects a destination inside the media root, and removes incomplete output after a failure.

```sh
npm run backup
```

To restore in the UI, open **Settings → Backups** and choose **Restore** beside a retained, verified full backup. Confirm the replacement after reviewing the selected run. OpenLearning is temporarily unavailable to users while it pauses changes and scheduled backups, validates the database and every media file, applies pending database migrations, and creates a verified full backup of the current installation before replacing its data. All sessions are cleared, so sign in again with an account and password from the restored backup. Database-only and media-only backups cannot be restored from the UI.

For offline recovery, stop the application and run the command below from the OpenLearning installation directory, replacing the path with the full backup directory. The CLI uses the same validation and migration checks and preserves the previous files if the switch fails. Keep the application stopped until restoration completes; use the same service account that normally runs OpenLearning.

```sh
npm run restore -- "/var/backups/openlearning/<full-backup-directory>"
```

The CLI restore stages and verifies both data components before switching them into place. If the switch fails, it puts the previous database and media directory back. When a verified pre-restore backup was available, it preserves the previous installation there after a successful restore; otherwise, the command prints the paths where it kept the original files.

For Docker Compose, run the command in a one-off container with the service stopped so it uses the same data and backup mounts:

```sh
docker compose stop openlearning
docker compose run --rm --no-deps openlearning npm run restore -- "/var/backups/openlearning/<full-backup-directory>"
docker compose up -d openlearning
```

Scheduled backup jobs default to retaining 14 successful backup artifacts; missed schedules are not replayed after downtime.

Run the automated checks with:

```sh
npm test
npm run typecheck
npm run build
```

See [LICENSE](LICENSE) for the MIT license.
