import session from 'express-session';

const ONE_DAY = 24 * 60 * 60 * 1000;

function sessionUserId(sessionData) {
  return typeof sessionData?.userId === 'string' ? sessionData.userId : null;
}

export class SQLiteSessionStore extends session.Store {
  constructor(database, { onCleanupError = (error) => console.error('Unable to prune expired sessions:', error?.message || error) } = {}) {
    super();
    this.db = database;
    this.onCleanupError = onCleanupError;
    this.getStmt = database.prepare('SELECT session_data, expires_at FROM sessions WHERE sid = ?');
    this.setStmt = database.prepare(`
      INSERT INTO sessions (sid, session_data, expires_at, user_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET session_data = excluded.session_data, expires_at = excluded.expires_at, user_id = excluded.user_id
    `);
    this.deleteStmt = database.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = database.prepare('UPDATE sessions SET expires_at = ?, user_id = ? WHERE sid = ?');
    this.clearExpiredStmt = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    const clearExpired = () => {
      try {
        this.clearExpiredStmt.run(Date.now());
      } catch (error) {
        try {
          this.onCleanupError(error);
        } catch (loggingError) {
          console.error('Unable to report expired-session cleanup failure:', loggingError?.message || loggingError);
        }
      }
    };
    clearExpired();
    this.cleanupTimer = setInterval(clearExpired, ONE_DAY);
    this.cleanupTimer.unref?.();
  }

  get(sid, callback) {
    let sessionData = null;
    try {
      const row = this.getStmt.get(sid);
      if (row) {
        if (row.expires_at <= Date.now()) {
          this.deleteStmt.run(sid);
        } else {
          let parsed;
          let invalidJson = false;
          try {
            parsed = JSON.parse(row.session_data);
          } catch {
            invalidJson = true;
          }
          if (invalidJson || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            this.deleteStmt.run(sid);
          } else sessionData = parsed;
        }
      }
    } catch (error) {
      callback(error);
      return;
    }
    callback(null, sessionData);
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + ONE_DAY;
      this.setStmt.run(sid, JSON.stringify(sessionData), expiresAt, sessionUserId(sessionData));
    } catch (error) {
      callback(error);
      return;
    }
    callback(null);
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + ONE_DAY;
      this.touchStmt.run(expiresAt, sessionUserId(sessionData), sid);
    } catch (error) {
      callback(error);
      return;
    }
    callback(null);
  }

  close() {
    if (!this.cleanupTimer) return;
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteStmt.run(sid);
    } catch (error) {
      callback(error);
      return;
    }
    callback(null);
  }

  clear(callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
    } catch (error) {
      callback(error);
      return;
    }
    callback(null);
  }
}

export function invalidateUserSessions(database, userId, exceptSessionId = null) {
  const result = exceptSessionId === null
    ? database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    : database.prepare('DELETE FROM sessions WHERE user_id = ? AND sid <> ?').run(userId, exceptSessionId);
  return Number(result.changes);
}
