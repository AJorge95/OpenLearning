export function isReadyToServe(database, shuttingDown) {
  if (shuttingDown) return false;
  try {
    const schemaVersion = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version;
    const setupState = database.prepare("SELECT value FROM app_settings WHERE key = 'setup_complete'").get()?.value;
    const administrator = database.prepare("SELECT 1 FROM users WHERE role = 'admin' AND disabled = 0 LIMIT 1").get();
    return Number.isSafeInteger(schemaVersion) && schemaVersion >= 1 && setupState === '1' && Boolean(administrator);
  } catch {
    return false;
  }
}
