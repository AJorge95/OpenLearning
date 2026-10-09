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
    try {
      const row = this.getStmt.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.deleteStmt.run(sid);
        return callback(null, null);
      }
      let sessionData;
      try {
        sessionData = JSON.parse(row.session_data);
      } catch {
        this.deleteStmt.run(sid);
        return callback(null, null);
      }
      if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) {
        this.deleteStmt.run(sid);
        return callback(null, null);
      }
      return callback(null, sessionData);
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + ONE_DAY;
      this.setStmt.run(sid, JSON.stringify(sessionData), expiresAt, sessionUserId(sessionData));
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + ONE_DAY;
      this.touchStmt.run(expiresAt, sessionUserId(sessionData), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteStmt.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  clear(callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions').run();
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

export function invalidateUserSessions(database, userId, exceptSessionId = null) {
  const result = exceptSessionId === null
    ? database.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
    : database.prepare('DELETE FROM sessions WHERE user_id = ? AND sid <> ?').run(userId, exceptSessionId);
  return Number(result.changes);
}
