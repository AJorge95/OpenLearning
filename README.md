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
- Native Node deployment: one Express process serves the API and production web client. Docker is not required.

## Requirements

- Node.js 24 LTS
- npm

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

All course and lesson viewing requires sign-in. Video lessons must be watched through verified playback in the learning player before they can be marked complete. Learners encounter prior-lesson locks; administrators and moderators can open later lessons to review them. Course assignments and learning-path enrollments place eligible courses in a learner's My learning list. Assigned paths can provide access to private courses one step at a time as prerequisites are completed. Revoking a course or path assignment takes effect on the next API or media request. Completion windows appear in the learner calendar and do not block course access.

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
| `MAX_UPLOAD_BYTES` | `2147483648` | Maximum size for a single uploaded video, cover, or lesson document, as a positive whole number of bytes. Invalid values stop startup. |
| `REQUEST_TIMEOUT_MS` | `300000` | Maximum time in milliseconds for Node to receive an entire HTTP request, from 1 to 2147483647. Set a larger value for slower large uploads; invalid values stop startup. |
| `SESSION_SECRET` | Development-only value | Session signing secret. Production requires at least 32 characters; use a random secret and keep it private. |
| `SETUP_TOKEN` | Unset | Private, random first-run administrator bootstrap credential, required only until initial setup succeeds. When set, it must contain 32 to 256 characters. |
| `TRUST_PROXY` | `false` | Accepts `true` or `false` (case-insensitive). Set `true` only behind a trusted reverse proxy that sets forwarding headers; other non-empty values stop startup. |

`DB_PATH` and `MEDIA_ROOT` are independent overrides. The example leaves them unset so changing `DATA_DIR` moves the database and media together. Set either override explicitly when you need to store it elsewhere.

The media upload accepts MP4 video, JPG, PNG, or WebP course covers, and WebVTT caption tracks up to 5 MB each. A lesson can have one caption track per language; learners can select tracks in the video controls. Lessons can also include HTTP(S) links and downloadable PDF, text, Markdown, RTF, Office, CSV/TSV, or OpenDocument attachments. Caption tracks and lesson documents are stored in that course's media folder and served only to users who can access the course. Videos are stored as uploaded; the server does not transcode them. Use MP4 with codecs supported by the browsers your learners use. Select the public connection protocol in setup or **Settings**. Selecting HTTPS enables secure session cookies; it does not provision a TLS certificate. Terminate TLS on Node or a reverse proxy, and set `TRUST_PROXY=true` when a reverse proxy handles HTTPS.

## Back up and restore

Back up both the SQLite database and the complete media root. Platform identity, connection, and registration settings and the optional icon are stored in SQLite, so they are included in the database backup. The app includes a portable online-backup command that uses the same `DATA_DIR`, `DB_PATH`, and `MEDIA_ROOT` configuration as the server:

```sh
npm run backup
```

Each run creates a new timestamped directory under `./backup` containing `openlearning.sqlite` and `course-media`. Set `BACKUP_DIR` to use another destination root; for example, in PowerShell run `$env:BACKUP_DIR = '.\backups'` before `npm run backup`. The command reads the project `.env` file and resolves relative paths from the same working directory used by OpenLearning. It uses the bundled SQLite driver, so the SQLite CLI is not required. Before copying media or reporting success, it verifies the SQLite snapshot with `quick_check`; if the check fails, incomplete output is removed. The database snapshot can run while the app is online; pause course edits and uploads during the media copy so the database and files describe the same point in time. The command rejects backup destinations inside the media root and removes incomplete output when a backup fails.

To restore, stop OpenLearning, choose a timestamped backup directory, restore its database to `DB_PATH` and its media tree to `MEDIA_ROOT`, then start the app again. Keep the directory layout and course folders intact. Restoring only one of the database or media tree can leave course records without their uploaded files, or files without their course records.

## License

OpenLearning is distributed under the MIT License. See [LICENSE](LICENSE).
