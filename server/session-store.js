import session from 'express-session';

const ONE_DAY = 24 * 60 * 60 * 1000;

export class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.getStmt = database.prepare('SELECT session_data, expires_at FROM sessions WHERE sid = ?');
    this.setStmt = database.prepare(`
      INSERT INTO sessions (sid, session_data, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET session_data = excluded.session_data, expires_at = excluded.expires_at
    `);
    this.deleteStmt = database.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = database.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?');
    this.clearExpiredStmt = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    this.cleanupTimer = setInterval(() => this.clearExpiredStmt.run(Date.now()), ONE_DAY);
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
      return callback(null, JSON.parse(row.session_data));
    } catch (error) {
      return callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + ONE_DAY;
      this.setStmt.run(sid, JSON.stringify(sessionData), expiresAt);
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
      this.touchStmt.run(expiresAt, sid);
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
