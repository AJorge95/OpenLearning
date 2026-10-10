import { db } from './db.js';

const maxAuditRows = 10_000;
const maxSystemRows = 5_000;
const auditRetention = { table: 'audit_logs', maximum: maxAuditRows, count: null, trimStatement: null };
const systemRetention = { table: 'system_logs', maximum: maxSystemRows, count: null, trimStatement: null };
const credentialAssignmentPattern = /((?:"|')?(?:password|secret|token|cookie|session|authorization|api[_-]?key|private[_-]?key)(?:"|')?\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi;

function insertRetainedRow(retention, insert) {
  const nestedInCallerTransaction = db.inTransaction;
  const persist = db.transaction(() => {
    if (retention.count === null) {
      retention.count = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${retention.table}`).get().count);
    }

    const result = insert();
    retention.count += 1;
    if (retention.count > retention.maximum) {
      retention.trimStatement ??= db.prepare(`DELETE FROM ${retention.table} WHERE id = (SELECT MIN(id) FROM ${retention.table})`);
      while (retention.count > retention.maximum) {
        const { changes } = retention.trimStatement.run();
        if (!changes) break;
        retention.count -= changes;
      }
    }
    return result;
  });
  let persisted = false;
  try {
    const result = persist();
    persisted = true;
    return result;
  } finally {
    if (nestedInCallerTransaction || !persisted) retention.count = null;
  }
}

function redactCredentialText(value) {
  return String(value).replace(credentialAssignmentPattern, (_match, prefix, credential) => {
    const redactedCredential = credential.startsWith('"') ? '"[redacted]"' : credential.startsWith("'") ? "'[redacted]'" : '[redacted]';
    return `${prefix}${redactedCredential}`;
  });
}

function safeDetails(value, redactCredentialValues = false) {
  const redact = (item) => {
    if (Array.isArray(item)) return item.slice(0, 100).map(redact);
    if (typeof item === 'string') return redactCredentialValues ? redactCredentialText(item) : item;
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.entries(item).slice(0, 100).map(([key, entry]) => [
      key,
      /password|secret|token|cookie|session|authorization|api[_-]?key|private[_-]?key|credential/i.test(key) ? '[redacted]' : redact(entry),
    ]));
  };
  try {
    const json = JSON.stringify(redact(value ?? {}));
    return json.length <= 12_000 ? json : JSON.stringify({ truncated: true });
  } catch {
    return '{}';
  }
}

export function writeAuditLog({ actor = null, action, entityType, entityId = null, summary, details = {} }) {
  try {
    const result = insertRetainedRow(auditRetention, () => db.prepare(`INSERT INTO audit_logs
      (actor_user_id, actor_username, action, entity_type, entity_id, summary, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(actor?.id || null, String(actor?.username || 'System').slice(0, 80), String(action).slice(0, 80),
        String(entityType).slice(0, 80), entityId === null ? null : String(entityId).slice(0, 120),
        String(summary).slice(0, 500), safeDetails(details)));
    return Number(result.lastInsertRowid);
  } catch (error) {
    console.error('Unable to persist audit entry:', error?.message || error);
    return null;
  }
}

export function writeSystemLog(level, source, message, details = {}) {
  try {
    const safeMessage = redactCredentialText(message);
    const result = insertRetainedRow(systemRetention, () => db.prepare(`INSERT INTO system_logs (level, source, message, details_json)
      VALUES (?, ?, ?, ?)`)
      .run(['info', 'warn', 'error'].includes(level) ? level : 'info', String(source).slice(0, 80),
        safeMessage.slice(0, 1000), safeDetails(details, true)));
    return Number(result.lastInsertRowid);
  } catch (error) {
    console.error('Unable to persist system log entry:', error?.message || error);
    return null;
  }
}
