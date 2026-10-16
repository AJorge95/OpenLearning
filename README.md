# OpenLearning

OpenLearning is a lightweight, self-hosted learning platform for a single organization. It provides a searchable course catalog, video lessons, module quizzes, learning paths, competencies, learner progress, course access grants, and role-based course management.

If OpenLearning is useful for your team, please [star the repository](https://github.com/AJorge95/OpenLearning) to help others discover it.

## Features

- Username-and-password sign-in, email addresses for new accounts, configurable learner registration fields and account limits, and a one-time setup wizard for the initial administrator.
- Administrator, moderator, and learner roles.
- Public courses for signed-in learners, plus private courses available through an individual grant or an unlocked step in an assigned learning path.
- Searchable guided learning paths order courses and can require earlier courses to be completed. Staff can search paths by title or description and assign them; learners can search eligible published paths and self-enroll when every course is public.
- Course competency mappings and learner progress toward an organization’s competency map.
- Versioned course publication with review workflows, restoration of earlier versions, and optional completion windows.
- A learner calendar for course deadlines and completion status.
- Courses organized into ordered modules, described video lessons with optional text transcripts and WebVTT caption tracks, lesson links and documents, and optional single-answer quizzes.
- Lesson-level likes, dislikes, and learner comments, with reactions limited to one per learner per lesson.
- Verified video watch progress before lesson completion, saved quiz attempts, unlimited retries, course completion tracking, and learner-specific certificates.
- SQLite application data and local course media stored in a separate directory for each course.
- Optional platform icon and selectable violet, ocean, forest, rose, and amber color palettes.
- MP4 video upload with browser upload progress and authenticated byte-range delivery for seeking.
- Administrator-only audit and system logs with search, filters, and pagination.
- Administrator-configured automatic backups with independent full, database-only, or course-media-only schedules, per-job local destinations and retention, manual runs, and run history.
- Native Node and Docker deployments: one Express process serves the API and production web client. Docker is optional.

## Requirements

- Node.js 24 LTS
- npm

## Linux install and update

On Ubuntu 22.04 or newer, or RHEL 9 or a compatible derivative, install OpenLearning with the repository-hosted installer:

```sh
curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo bash
```

The Ubuntu/RHEL installer, Docker image, Compose service, and Swarm stack all use this repository as their source of truth. The native installer downloads `main` by default; set `OPENLEARNING_COMMIT` to a full 40-character SHA to pin it. The container workflow builds each pushed source commit and publishes matching `sha-<commit>`, `latest`, and app `x.y` tags for `linux/amd64` and `linux/arm64`. For identical source across install methods, use the same SHA: set `OPENLEARNING_COMMIT` for native installs, pull `ghcr.io/ajorge95/openlearning:sha-<commit>` for Docker, and set `OPENLEARNING_IMAGE` to that same image for Compose or Swarm. The moving `latest` tag can briefly lag behind `main` while GitHub Actions publishes it.

The installer installs Node.js 24 and native build prerequisites, creates the `openlearning` systemd service, and builds the latest commit on the repository's `main` branch unless `OPENLEARNING_COMMIT` is set. It stores application releases in `/opt/openlearning`, creates the protected deployment `.env` file at `/etc/openlearning/.env`, and stores application data in `/var/lib/openlearning`. It generates a production session secret and one-time setup token on first install; the token is printed once for the initial setup wizard. Keep the environment file private. After completing setup, remove `SETUP_TOKEN` from the environment file and restart the service. The installer configures `/var/backups/openlearning` as the default app backup destination and preserves existing custom backup paths during updates.

To pin the native installer to a published image's source revision, use the full commit SHA from its `sha-<commit>` tag:

```sh
# Run from a checkout of the desired source revision.
export OPENLEARNING_COMMIT="$(git rev-parse HEAD)"
curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo env OPENLEARNING_COMMIT="$OPENLEARNING_COMMIT" bash
```

Run the same command again to update. The installer preserves recognized `openlearning.service` configuration and resolves relative database and media paths against the existing service working directory. It stops the service, creates a verified database and media backup under `/var/backups/openlearning`, activates the new release, and checks service health. If an already-configured deployment fails its readiness check, it restores the previous release and the pre-update database and media snapshot. First-run installations are checked through `/healthz`; `/readyz` remains unavailable until the setup wizard has been completed.

The installer serves both the built frontend and API on port 5173 by default (or the existing `PORT` setting) and allows that TCP port through an already-active UFW or firewalld firewall. Open `http://<server-IP-or-hostname>:5173` from another computer, using the configured port if different. There is no separate Vite process in production. Docker and direct Node startup retain their 6173 defaults. The installer does not enable a firewall, configure external cloud firewall rules, a reverse proxy, or a TLS certificate. If neither UFW nor firewalld is active, allow the port through your firewall manually. Restrict direct access or configure HTTPS termination separately. Set `TRUST_PROXY=true` in the environment file only when a trusted reverse proxy supplies forwarding headers, then restart the service with `sudo systemctl restart openlearning`.

Updates preserve a saved `PORT`, so changing the installer default does not move an existing installation from 6173. To move it to 5173, back up and edit the deployment configuration, then rerun the installer to restart the service and configure its active local firewall:

```sh
sudo cp -p /etc/openlearning/.env /etc/openlearning/.env.before-port-change
sudo sed -i 's/^[[:space:]]*PORT=.*/PORT=5173/' /etc/openlearning/.env
curl -fsSL https://raw.githubusercontent.com/AJorge95/OpenLearning/main/scripts/install.sh | sudo bash
```

If external cloud firewall or reverse-proxy rules are configured, update them for the selected port separately. A successful local health check verifies the running app, not remote browser connectivity.

The service runs as the dedicated `openlearning` account. For preserved storage inside a private home directory, the installer grants that account traversal through the parent directories using filesystem ACLs, then checks storage access as the service account. Home-directory ownership is preserved. Health checks use HTTP on `127.0.0.1:<configured PORT>` to check the app on the same server; this is not an ICMP ping or a test of public network access.

## Docker and Docker Swarm

The Docker image runs the same Node server as the systemd installer, as the non-root `node` user. Both deployment examples use one app process, persistent host directories for application data and backups, and a container health check against `/healthz`. SQLite, session data, and the in-process backup scheduler are not configured for multiple concurrent replicas. For Swarm, the service is constrained to one node labeled for OpenLearning storage and uses stop-first updates.

### Move an existing systemd installation to Docker

Create and verify a full backup from **Settings** → **Backups** while the systemd service is running. Then stop the service and copy the files from that backup into the Docker data directory (replace `<backup-directory>` with the full backup's timestamped directory):

```sh
sudo systemctl stop openlearning
sudo install -d -o 1000 -g 1000 -m 0750 /srv/openlearning/data
sudo cp -a /var/backups/openlearning/<backup-directory>/openlearning.sqlite /srv/openlearning/data/
sudo cp -a /var/backups/openlearning/<backup-directory>/course-media /srv/openlearning/data/
sudo chown -R 1000:1000 /srv/openlearning/data
```

Set `OPENLEARNING_DATA_PATH=/srv/openlearning/data` and start Docker Compose without the initial-setup override because the restored database already contains the setup state. Keep the original `/var/lib/openlearning` and systemd configuration intact until the Docker instance is verified. Starting with a new session secret will require users to sign in again. Do not run the systemd service and Docker container against the same SQLite files concurrently.

### Docker Compose on one host

Install Docker Engine and the Docker Compose v2 plugin. After the first image publish, set the GHCR package visibility to **Public** once so clients can pull without registry credentials. Create persistent directories owned by the image's `node` user (UID 1000), and create protected secret files readable by that user. To run the same source revision as a native install, also export `OPENLEARNING_IMAGE` with that commit's full SHA tag; otherwise Compose defaults to `latest`.

```sh
sudo install -d -o "$(id -u)" -g "$(id -g)" -m 0750 /srv/openlearning
sudo install -d -o 1000 -g 1000 -m 0750 /srv/openlearning/data /srv/openlearning/backups
umask 077
openssl rand -hex 32 > /srv/openlearning/session_secret
openssl rand -hex 32 > /srv/openlearning/setup_token
sudo chown 1000:"$(id -g)" /srv/openlearning/session_secret /srv/openlearning/setup_token
sudo chmod 0440 /srv/openlearning/session_secret /srv/openlearning/setup_token
export OPENLEARNING_DATA_PATH=/srv/openlearning/data
export OPENLEARNING_BACKUP_PATH=/srv/openlearning/backups
export SESSION_SECRET_FILE=/srv/openlearning/session_secret
export SETUP_TOKEN_FILE=/srv/openlearning/setup_token
# Optional, after exporting OPENLEARNING_COMMIT to the same 40-character SHA as the native install:
# export OPENLEARNING_IMAGE="ghcr.io/ajorge95/openlearning:sha-$OPENLEARNING_COMMIT"
```

To pin Compose to that same revision, set `OPENLEARNING_IMAGE` to `ghcr.io/ajorge95/openlearning:sha-${OPENLEARNING_COMMIT}` before starting the service.

Start the initial setup by pulling and running the published image with the one-time setup secret mounted:

```sh
docker compose -f compose.yaml -f compose.initial-setup.yaml up -d --pull always --no-build
cat /srv/openlearning/setup_token
```

Open the server on port 6173, complete the setup wizard with the displayed token, then redeploy without the setup override and remove its host file:

```sh
docker compose -f compose.yaml up -d --pull always --no-build
rm /srv/openlearning/setup_token
```

The Compose service is named `openlearning` and defaults to `ghcr.io/ajorge95/openlearning:latest`. To pull it directly with Docker, run:

```sh
docker pull ghcr.io/ajorge95/openlearning:latest
```

For an immutable source revision, run `docker pull "ghcr.io/ajorge95/openlearning:sha-${OPENLEARNING_COMMIT}"` after setting `OPENLEARNING_COMMIT` to the full commit SHA.

To download it through Compose without restarting the app, run `docker compose pull openlearning`. To pull and apply it in one command, run `docker compose up -d --pull always --no-build openlearning`. The `docker-compose` hyphenated CLI can be used where installed; `docker compose` is the Docker Compose v2 plugin syntax. Docker Hub interprets the bare name `openlearning` as `library/openlearning`; the GHCR image therefore needs its registry and owner in the pull name.

Set `OPENLEARNING_PORT` to change the host port. Set `TRUST_PROXY=true` only when a trusted reverse proxy supplies forwarding headers. Limit direct access to the published port when TLS terminates at that proxy. The admin backup page's default destination is `/var/backups/openlearning`; other backup destinations must also be mounted into the container. `docker compose down` leaves the host data and backup directories intact. To build the image from a local checkout instead of pulling it, run `docker compose up -d --build --pull never`.

### Docker Swarm

Swarm uses `docker stack deploy` rather than `docker compose up`; the Compose pull command does not update a running Swarm service. The published workflow builds the repository commit that triggered it and creates `latest`, the app's `x.y` version, and an immutable `sha-<full-commit-sha>` tag for both `linux/amd64` and `linux/arm64`. Use that SHA tag in `OPENLEARNING_IMAGE` to pin Swarm to the same code as a native or Compose install. After the first image publish, set the GHCR package visibility to **Public** once so nodes can pull without registry credentials. See [GitHub's package visibility guide](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

#### Manual Swarm deployment

For a manually managed deployment, use a published image or build and push from a checked-out repository commit. The workflow publishes the `sha-<full-commit-sha>` tag for the exact source commit; the local build below uses the same tag convention:

```sh
SOURCE_COMMIT="$(git rev-parse HEAD)"
export OPENLEARNING_IMAGE="ghcr.io/ajorge95/openlearning:sha-$SOURCE_COMMIT"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GITHUB_USERNAME" --password-stdin
docker build -t "$OPENLEARNING_IMAGE" .
docker push "$OPENLEARNING_IMAGE"
docker logout ghcr.io
```

For local publishing, set `GHCR_TOKEN` to a GitHub classic personal access token with `write:packages` and `GITHUB_USERNAME` to your GitHub username. Public pulls do not require authentication.

On the node that stores the SQLite database, media, and backups, create the directories with ownership for UID 1000:

```sh
sudo install -d -o 1000 -g 1000 -m 0750 /srv/openlearning/data /srv/openlearning/backups
```

On a Swarm manager, set the node name and exact host paths, then label that storage node. These same path values are expanded into the stack file and must exist on the labeled node:

```sh
export OPENLEARNING_NODE=worker-1
export OPENLEARNING_DATA_PATH=/srv/openlearning/data
export OPENLEARNING_BACKUP_PATH=/srv/openlearning/backups
docker node update --label-add openlearning-data=true "$OPENLEARNING_NODE"
```

Create the permanent session secret and temporary setup secret. Keep the setup token available to enter in the first-run wizard:

```sh
umask 077
openssl rand -hex 32 > ./openlearning_session_secret
openssl rand -hex 32 > ./openlearning_setup_token
docker secret create openlearning_session_secret ./openlearning_session_secret
docker secret create openlearning_setup_token ./openlearning_setup_token
cat ./openlearning_setup_token
```

Deploy the stack with the initial-setup override, complete the wizard at `http://<storage-node>:6173`, then redeploy without that override and remove the one-time secret:

```sh
docker stack deploy --with-registry-auth -c docker-stack.yml -c docker-stack.initial-setup.yml openlearning
docker stack deploy --with-registry-auth -c docker-stack.yml openlearning
docker secret rm openlearning_setup_token
rm ./openlearning_setup_token
rm ./openlearning_session_secret
```

The stack publishes port 6173 in host mode and sets `TRUST_PROXY=false` by default. Export `TRUST_PROXY=true` before `docker stack deploy` only when traffic arrives through a trusted reverse proxy. Restrict the port with the host firewall to the proxy and intended clients. In the backup settings, use `/var/backups/openlearning` or another path mounted into the service.

Before upgrading, create and verify a backup. Build and push a new immutable image tag, set `OPENLEARNING_IMAGE` to it, and redeploy `docker-stack.yml`. Swarm's rollback restores the prior image if an update fails its health check; it does not roll back SQLite migrations or restore the bind-mounted data. Keep an independent copy of backups off the storage node. To recover on a replacement node, restore the data and backup directories there before moving the `openlearning-data` label.

`/healthz` checks that the HTTP process responds. `/readyz` reports application readiness after setup is complete. Swarm does not move the local SQLite files with the service, so do not label multiple nodes for this single-replica stack unless they are guaranteed to see the same valid data and backup paths. Multi-replica high availability requires a different shared database, session, media, and backup architecture.

## Install and run

```sh
git clone <repository-url> openlearning
cd openlearning
npm install
cp .env.example .env
```

For deployment, set `NODE_ENV=production` and replace `SESSION_SECRET` in `.env` with a random value. You can generate one with Node:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Before first-run setup, set `SETUP_TOKEN` in `.env` to a separate random value of at least 32 characters (the same Node command can generate one). Keep it private and enter it in the setup wizard over localhost or HTTPS. After setup succeeds, remove the token from `.env` and restart the server; setup is then permanently closed by the database's configured state.

The example secret is rejected in production. If HTTPS is terminated by a reverse proxy, set `TRUST_PROXY=true` so secure session cookies work through that proxy. Then build and start the application:

```sh
npm run build
npm start
```

Open `http://localhost:6173`. On the first launch, the two-step setup wizard asks for the bootstrap token, platform name, optional icon and color palette, initial administrator credentials, public connection protocol, and registration policy. Setup can only be completed once. When registration is enabled, new accounts receive the learner role. Administrators can update branding, protocol, registration access, and the account cap from **Settings**. A limit of `0` means unlimited accounts; a positive limit counts all accounts, including administrators and moderators.

Service monitors can use `/healthz` to check that the HTTP process is responding. `/readyz` reports ready only when SQLite has a schema-migration version, setup is complete (`setup_complete = '1'`), and at least one enabled administrator account exists. It returns HTTP 503 when any readiness check fails or while the server is draining during shutdown.

For local development, run the Vite client and API together:

```sh
npm run dev
```

The development client is available at `http://127.0.0.1:5173` and proxies API and media requests to the Express server on port 6173.

## App version

OpenLearning uses an `x.y` app version, stored in `package.json` as `x.y.0`. The Git pre-commit hook increments `y` for commits that change app behavior or its tests; documentation, tooling, and dependency-only commits do not increment it. `npm install` configures the repository hook automatically while preserving any existing custom Git hook path. To request a new major version, run `npm run version:major`; this increments `x` and resets `y` to zero. The current version appears in administrator settings and is available from the public `GET /api/version` endpoint.

## Checks

Run the automated server utility and persistence checks, then type-check the client source:

```sh
npm test
npm run typecheck
```

The suite uses Node's built-in test runner, in-memory and isolated temporary SQLite databases, and temporary filesystem fixtures. It does not start the application server or use the configured application data directory. `npm run build` runs the strict TypeScript check before creating the production client bundle.

## Roles and permissions

- **Administrator:** Create and manage accounts, roles, passwords, and course activity; manage settings, courses, learning paths, competencies, learner assignments, and access grants.
- **Moderator:** Create and manage courses and learning paths, assign learners, map course competencies, and review course dashboards. Moderators cannot manage accounts, roles, or platform settings.
- **Learner:** Browse and learn from published public courses, plus private courses available through an individual grant or an unlocked step in an assigned learning path.

All course and lesson viewing requires sign-in. Video lessons must be watched through verified playback in the learning player before they can be marked complete. Learners encounter prior-lesson locks; administrators and moderators can open later lessons to review them. Course assignments and learning-path enrollments place eligible courses in a learner's My learning list. Assigned paths can provide access to private courses one step at a time as prerequisites are completed. The course access page distinguishes direct course assignments from private-course access unlocked through an assigned learning path. Revoking a course or path assignment takes effect on the next API or media request. Completion windows appear in the learner calendar and do not block course access.

Administrators can manually create learner, moderator, or administrator accounts, update an account's email or certificate name, change roles or account status, and reset passwords. New certificates use the current account email; issued certificates keep the email recorded when they were issued. New accounts require a unique email address; sign-in still uses the username and password. Administrators can require approval for public registrations and review pending learners from **Users** before they can sign in or use the platform. Account details show the last successful login, and failed sign-in attempts do not update it. From **Settings** → **Registration fields**, administrators can add up to 30 text, date, select-list, or checkbox fields to public signup and choose which are required. Saved learner answers remain on the account if a field is later changed or removed, and administrators can review them on the account-details page. The account list and course-assignment list can search by username or email.

Course dashboards are available to administrators and moderators and show completion rates, lesson completion, quiz participation and scores, plus per-learner progress and attempt details.

## Logs

Administrators can open **Audit log** and **System log** from the management area. The audit log records sign-ins, account and platform changes, course and curriculum edits, moderated learner-comment removals, media uploads, learner assignments, and private-course access grants. The system log records server startup and shutdown, completed startup media-cleanup scan totals, removals, failures and duration, failed sign-ins, authentication rate limits, and unhandled request errors. Failed cleanup attempts include error details. Log records are stored in SQLite and retained up to 10,000 audit entries and 5,000 system entries; the oldest entries are removed as new records arrive. Log tables are included in the regular database backup.

## Configuration

Environment variables can be set in `.env` or in the process environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Accepted values are `development`, `test`, and `production`. Set to `production` for deployment cookies and production security headers. |
| `PORT` | `6173` | HTTP TCP port from 1 to 65535. Invalid values stop startup. |
| `DATA_DIR` | `./data` | Parent directory used to derive database and media paths when their overrides are unset. |
| `DB_PATH` | `./data/openlearning.sqlite` | SQLite database file path. If unset, defaults to `openlearning.sqlite` inside `DATA_DIR`. |
| `MEDIA_ROOT` | `./data/course-media` | Root directory for course media; if unset, defaults to `course-media` inside `DATA_DIR`. Each course gets its own subdirectory. |
| `BACKUP_DIR` | `./backup` | Default server-side destination for backup jobs and the `npm run backup` command. |
| `MAX_UPLOAD_BYTES` | `2147483648` | Maximum size for a single uploaded video, cover, or lesson document, as a positive whole number of bytes. Invalid values stop startup. |
| `REQUEST_TIMEOUT_MS` | `300000` | Maximum time in milliseconds for Node to receive an entire HTTP request, from 1 to 2147483647. Set a larger value for slower large uploads; invalid values stop startup. |
| `SESSION_SECRET` | Development-only value | Session signing secret. Production requires at least 32 characters; use a random secret and keep it private. |
| `SESSION_SECRET_FILE` | Unset | Read the session signing secret from a UTF-8 file, such as a mounted Docker secret. Set either this or `SESSION_SECRET`, not both. |
| `SETUP_TOKEN` | Unset | Private, random first-run administrator bootstrap credential, required only until initial setup succeeds. When set, it must contain 32 to 256 characters. |
| `SETUP_TOKEN_FILE` | Unset | Read the first-run setup token from a UTF-8 file, such as a mounted Docker secret. Set either this or `SETUP_TOKEN`, not both. |
| `TRUST_PROXY` | `false` | Accepts `true` or `false` (case-insensitive). Set `true` only behind a trusted reverse proxy that sets forwarding headers; other non-empty values stop startup. |

`DB_PATH` and `MEDIA_ROOT` are independent overrides. The example leaves them unset so changing `DATA_DIR` moves the database and media together. Set either override explicitly when you need to store it elsewhere.

The media upload accepts MP4 video, JPG, PNG, or WebP course covers, and WebVTT caption tracks up to 5 MB each. A lesson can have one caption track per language; learners can select tracks in the video controls. Lessons can also include HTTP(S) links and downloadable PDF, text, Markdown, RTF, Office, CSV/TSV, or OpenDocument attachments. Caption tracks and lesson documents are stored in that course's media folder and served only to users who can access the course. Videos are stored as uploaded; the server does not transcode them. Use MP4 with codecs supported by the browsers your learners use. Select the public connection protocol in setup or **Settings**. Selecting HTTPS enables secure session cookies; it does not provision a TLS certificate. Terminate TLS on Node or a reverse proxy, and set `TRUST_PROXY=true` when a reverse proxy handles HTTPS.

## Back up and restore

Administrators can open **Settings** → **Backups** to create independent daily or weekly jobs for the SQLite database, the complete course-media root, or both. Each job has its own UTC run time, existing writable server-side destination, and retention count. New jobs default to daily at 02:00 UTC and retain the newest 14 successful backup artifacts. The panel shows next and last run status, recent history and output location, and supports **Run now**. Media and full backups pause data-changing requests while media files are copied; course reads remain available. Missed schedules are not replayed after downtime; the next run waits for its normal schedule. Removing a job keeps its previous backup files and run history.

Full backups include both SQLite and the complete media root. Platform identity, connection, and registration settings and the optional icon are stored in SQLite, so they are included in database backups. The app also includes a portable online-backup command that uses the same `DATA_DIR`, `DB_PATH`, and `MEDIA_ROOT` configuration as the server; `npm run backup` continues to create a full backup:

```sh
npm run backup
```

Each CLI run creates a new timestamped directory under `./backup` containing `openlearning.sqlite`, `course-media`, and a manifest describing the selected components. Set `BACKUP_DIR` to use another destination root; for example, in PowerShell run `$env:BACKUP_DIR = '.\backups'` before `npm run backup`. The command reads the project `.env` file and resolves relative paths from the same working directory used by OpenLearning. It uses the bundled SQLite driver, so the SQLite CLI is not required. Before copying media or reporting success, it verifies the SQLite snapshot with `quick_check`; if the check fails, incomplete output is removed. The database snapshot can run while the app is online; pause course edits and uploads during the media copy so the database and files describe the same point in time. The command rejects backup destinations inside the media root and removes incomplete output when a backup fails.

To restore, stop OpenLearning, choose a timestamped backup directory, restore its database to `DB_PATH` and its media tree to `MEDIA_ROOT`, then start the app again. Keep the directory layout and course folders intact. Restoring only one of the database or media tree can leave course records without their uploaded files, or files without their course records.

## License

OpenLearning is distributed under the MIT License. See [LICENSE](LICENSE).
