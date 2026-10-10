import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { textSearchPredicate, unicodeContains } from '../../server/sql.js';

function withSearchDatabase(run) {
  const database = new Database(':memory:');
  database.function('unicode_contains', unicodeContains);
  try {
    run(database);
  } finally {
    database.close();
  }
}

test('non-ASCII search matches case and canonical Unicode variants', () => {
  withSearchDatabase((database) => {
    database.exec('CREATE TABLE search_fixture (value TEXT)');
    const insert = database.prepare('INSERT INTO search_fixture (value) VALUES (?)');
    insert.run('École dArt');
    insert.run('Cafe\u0301 lessons');

    const accentedSearch = textSearchPredicate(['value'], 'école');
    assert.match(accentedSearch.sql, /unicode_contains/);
    assert.deepEqual(
      database.prepare(`SELECT value FROM search_fixture WHERE ${accentedSearch.sql}`).all(...accentedSearch.params),
      [{ value: 'École dArt' }],
    );

    const normalizedSearch = textSearchPredicate(['value'], 'CAFÉ');
    assert.deepEqual(
      database.prepare(`SELECT value FROM search_fixture WHERE ${normalizedSearch.sql}`).all(...normalizedSearch.params),
      [{ value: 'Cafe\u0301 lessons' }],
    );
  });
});

test('ASCII search keeps SQLite LIKE and treats wildcard characters literally', () => {
  withSearchDatabase((database) => {
    database.exec('CREATE TABLE search_fixture (value TEXT)');
    const insert = database.prepare('INSERT INTO search_fixture (value) VALUES (?)');
    insert.run('100%_! course');
    insert.run('100XX! course');

    const search = textSearchPredicate(['value'], '%_!');
    assert.match(search.sql, /LIKE/);
    assert.doesNotMatch(search.sql, /unicode_contains/);
    assert.deepEqual(
      database.prepare(`SELECT value FROM search_fixture WHERE ${search.sql}`).all(...search.params),
      [{ value: '100%_! course' }],
    );
  });
});

test('unicode search function safely rejects non-text database values', () => {
  assert.equal(unicodeContains(null, 'course'), 0);
  assert.equal(unicodeContains('course', null), 0);
});
