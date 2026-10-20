const personalLogFieldNames = new Set([
  'userid', 'userids', 'username', 'useremail', 'actorid', 'actorusername', 'actoruserid',
  'ownerid', 'ownerusername', 'authorid', 'authorusername', 'learnerid', 'learnerusername',
  'recipientid', 'recipientemail', 'memberid', 'accountid', 'accountusername', 'createdby',
  'accountemail', 'updatedby', 'requestedby', 'deletedby', 'invitedby', 'changedby', 'assignee', 'assignedto',
  'email', 'emailaddress', 'phone', 'phonenumber',
  'mobile', 'ip', 'ipaddress', 'remoteaddress', 'clientip', 'firstname', 'lastname', 'fullname',
  'displayname', 'name', 'address', 'streetaddress', 'postalcode', 'zipcode', 'useragent', 'login',
  'dateofbirth', 'birthdate', 'nationalid', 'taxid', 'ssn', 'socialsecuritynumber', 'passportnumber',
  'driverlicensenumber',
]);
const credentialLogFieldPattern = /password|secret|token|cookie|session|authorization|api[_-]?key|private[_-]?key|credential/i;
const credentialLogTextPattern = /((?:"|')?(?:password|secret|token|cookie|session|authorization|api[_-]?key|private[_-]?key|credential)(?:"|')?\s*[=:]\s*)(?:(?:Bearer|Basic)\s+)?("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi;
const emailLogTextPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ipv4LogTextPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function normalizedFieldName(key: string) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isPersonalField(key: string) {
  const normalized = normalizedFieldName(key);
  // Normalize aliases so camelCase, snake_case, and hyphenated fields share the same redaction.
  return personalLogFieldNames.has(normalized)
    || /(?:user|actor|owner|author|learner|recipient|member)(?:id|ids|username|email|phone|name)$/.test(normalized)
    || /(?:email|phone|phonenumber|ipaddress|remoteaddress|postalcode|zipcode)$/.test(normalized);
}

function isPersonalContainer(key: string) {
  return /(?:user|person|profile|actor|account|owner|author|learner|recipient|member)s?$/.test(normalizedFieldName(key));
}

function isSensitiveField(key: string) {
  return isPersonalField(key) || credentialLogFieldPattern.test(key) || isPersonalContainer(key);
}

function collectPersonalValues(value: unknown, key: string, values: Set<string>, inPersonalContainer = false) {
  const collectAllNestedValues = inPersonalContainer || isPersonalContainer(key);
  if (key && (isPersonalField(key) || collectAllNestedValues)) {
    const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (text.length >= 2 && !/^(?:\[redacted\]|system|unknown)$/i.test(text)) values.add(text);
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPersonalValues(item, key, values, collectAllNestedValues));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([nestedKey, nestedValue]) => collectPersonalValues(nestedValue, nestedKey, values, collectAllNestedValues));
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactText(value: string, personalValues: Set<string>) {
  let redacted = value
    .replace(emailLogTextPattern, '[redacted]')
    .replace(ipv4LogTextPattern, '[redacted]')
    .replace(credentialLogTextPattern, (_match, prefix: string, credential: string) => {
      const replacement = credential.startsWith('"') ? '"[redacted]"' : credential.startsWith("'") ? "'[redacted]'" : '[redacted]';
      return `${prefix}${replacement}`;
    });
  personalValues.forEach((personalValue) => {
    // Log messages and summaries often repeat the actor or target alongside structured fields.
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(personalValue)}(?=$|[^\\p{L}\\p{N}_])`, 'giu');
    redacted = redacted.replace(pattern, '$1[redacted]');
  });
  return redacted;
}

function redactValue(value: unknown, key: string, personalValues: Set<string>): unknown {
  if (key && isSensitiveField(key)) return '[redacted]';
  if (typeof value === 'string') return redactText(value, personalValues);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, '', personalValues));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
      nestedKey,
      redactValue(nestedValue, nestedKey, personalValues),
    ]));
  }
  return value;
}

export function redactLogEntryForCopy(entry: object) {
  const entryRecord = entry as Record<string, unknown>;
  const personalValues = new Set<string>();
  collectPersonalValues(entryRecord, '', personalValues);
  const entityType = typeof entryRecord.entityType === 'string' ? entryRecord.entityType : '';
  const hasPersonEntity = /user|person|account|learner|member/i.test(entityType);
  if (hasPersonEntity && typeof entryRecord.entityId === 'string') personalValues.add(entryRecord.entityId);
  const redacted = redactValue(entryRecord, '', personalValues) as Record<string, unknown>;
  if (hasPersonEntity) redacted.entityId = entryRecord.entityId ? '[redacted]' : null;
  return redacted;
}

export function formatRedactedLogJson(entry: object) {
  return JSON.stringify(redactLogEntryForCopy(entry), null, 2);
}
