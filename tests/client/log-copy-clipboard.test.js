import assert from 'node:assert/strict';
import test from 'node:test';
import { copyTextToClipboard } from '../../src/clipboard.ts';

function createClipboardDocument({ copyResult = true } = {}) {
  const state = { appended: [], removed: false, selected: false, command: null, focused: false };
  const textarea = {
    value: '',
    style: {},
    setAttribute() {},
    select() { state.selected = true; },
    remove() { state.removed = true; },
  };
  const document = {
    activeElement: { focus() { state.focused = true; } },
    body: { appendChild(element) { state.appended.push(element); } },
    createElement(tagName) {
      assert.equal(tagName, 'textarea');
      return textarea;
    },
    execCommand(command) {
      state.command = command;
      return copyResult;
    },
  };
  return { document, state, textarea };
}

test('log JSON copy uses the Clipboard API when available', async () => {
  const copied = [];
  await copyTextToClipboard('{"event":"ready"}', {
    clipboard: { async writeText(text) { copied.push(text); } },
  });

  assert.deepEqual(copied, ['{"event":"ready"}']);
});

test('log JSON copy uses a selection fallback when Clipboard API is unavailable', async () => {
  const { document, state, textarea } = createClipboardDocument();
  const text = '{"event":"ready"}';

  await copyTextToClipboard(text, { clipboard: null, document });

  assert.equal(textarea.value, text);
  assert.equal(state.appended.length, 1);
  assert.equal(state.selected, true);
  assert.equal(state.command, 'copy');
  assert.equal(state.removed, true);
  assert.equal(state.focused, true);
});

test('log JSON copy falls back when Clipboard API rejects access', async () => {
  const { document, state } = createClipboardDocument();

  await copyTextToClipboard('{"event":"ready"}', {
    clipboard: { async writeText() { throw new Error('Clipboard permission denied'); } },
    document,
  });

  assert.equal(state.command, 'copy');
  assert.equal(state.removed, true);
});

test('log JSON copy reports failure when the fallback is rejected and cleans up', async () => {
  const { document, state } = createClipboardDocument({ copyResult: false });

  await assert.rejects(
    copyTextToClipboard('{"event":"ready"}', { clipboard: null, document }),
    /Clipboard copy was rejected/,
  );

  assert.equal(state.removed, true);
  assert.equal(state.focused, true);
});
