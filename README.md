# OpenLearning

OpenLearning is a lightweight, self-hosted learning platform for a single organization. It provides a searchable course catalog, video lessons, module quizzes, learner progress, course access grants, and role-based course management.

## Features

- Required username-and-password sign-in, open learner registration, and a one-time first-run setup for the initial administrator.
- Administrator, moderator, and learner roles.
- Public courses for signed-in learners and private courses available through individual access grants.
- Courses organized into ordered modules, video lessons, and optional single-answer quizzes.
- Manual lesson completion, saved quiz attempts, unlimited retries, and course completion tracking.
- SQLite application data and local course media stored in a separate directory for each course.
- MP4 video upload with browser upload progress and authenticated byte-range delivery for seeking.
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

The example secret is rejected in production. If HTTPS is terminated by a reverse proxy, set `TRUST_PROXY=true` so secure session cookies work through that proxy. Then build and start the application:

```sh
npm run build
npm start
```

Open `http://localhost:3000`. On the first launch, the setup wizard asks for the platform name and the initial administrator username and password. Setup can only be completed once. After setup, users can register with a username and password; new accounts have the learner role.

For local development, run the Vite client and API together:

```sh
npm run dev
```

The development client is available at `http://127.0.0.1:5173` and proxies API and media requests to the Express server on port 3000.

## Roles and permissions

- **Administrator:** Manage settings, accounts, roles, courses, and private-course access grants.
- **Moderator:** Create and manage all courses, including private-course access grants. Moderators cannot manage accounts, roles, or platform settings.
- **Learner:** Browse and learn from published public courses, plus private courses for which they have an active grant.

All course and lesson viewing requires sign-in. Revoking a private-course grant takes effect on the next API or media request.

## Configuration

Environment variables can be set in `.env` or in the process environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` for deployment cookies and production security headers. |
| `PORT` | `3000` | HTTP listen port. |
| `DATA_DIR` | `./data` | Default location for application data. |
| `DB_PATH` | `./data/openlearning.sqlite` | SQLite database file path. |
| `MEDIA_ROOT` | `./data/course-media` | Root directory for course media; each course gets its own subdirectory. |
| `MAX_UPLOAD_BYTES` | `2147483648` | Maximum size for a single uploaded media file, in bytes. |
| `SESSION_SECRET` | Development-only value | Session signing secret. Production requires at least 32 characters; use a random secret and keep it private. |
| `TRUST_PROXY` | `false` | Set `true` only when the app is behind a trusted reverse proxy that sets forwarding headers. |

The media upload accepts MP4 video and JPG, PNG, or WebP course covers. Videos are stored as uploaded; the server does not transcode them. Use MP4 with codecs supported by the browsers your learners use. Put the app behind HTTPS for production so secure session cookies are enabled.

## Back up and restore

Back up both the SQLite database and the complete media root. SQLite uses write-ahead logging, so use SQLite's online backup command or stop the application and include any `-wal` and `-shm` files when making a raw file copy.

Example online backup while the app is running:

```sh
mkdir -p ./backup
sqlite3 ./data/openlearning.sqlite ".backup './backup/openlearning.sqlite'"
cp -a ./data/course-media ./backup/course-media
```

Pause course edits and uploads while copying the media tree so the database backup and media files describe the same point in time. The `sqlite3` command is the SQLite CLI; the app itself uses its bundled Node SQLite driver.

To restore, stop OpenLearning, restore the database to `DB_PATH` and the media tree to `MEDIA_ROOT`, then start the app again. Keep the directory layout and course folders intact. Restoring only one of the database or media tree can leave course records without their uploaded files, or files without their course records.

## License

OpenLearning is distributed under the MIT License. See [LICENSE](LICENSE).
