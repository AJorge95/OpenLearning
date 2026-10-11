import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const componentsSource = fs.readFileSync(path.join(sourceRoot, 'components.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(sourceRoot, 'styles.css'), 'utf8');
const dialogStart = componentsSource.indexOf('export function ConfirmationDialog(');
const dialogEnd = componentsSource.indexOf('\ntype PasswordFieldProps', dialogStart);
const dialogSource = componentsSource.slice(dialogStart, dialogEnd);

test('confirmation dialog uses the browser modal layer and names its title and description', () => {
  assert.ok(dialogStart >= 0 && dialogEnd > dialogStart);
  assert.match(dialogSource, /<dialog ref=\{dialogRef\} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby=\{`\$\{dialogId\}-title`\} aria-describedby=\{`\$\{dialogId\}-description`\}/);
  assert.match(dialogSource, /dialog\.showModal\(\)/);
  assert.match(dialogSource, /return \(\) => \{ if \(dialog\.open\) dialog\.close\(\); \}/);
});

test('confirmation dialog cancels on Escape or backdrop click and focuses Cancel by default', () => {
  assert.match(dialogSource, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); onCancel\(\); \}\}/);
  assert.match(dialogSource, /onClick=\{\(event\) => \{ if \(event\.target === event\.currentTarget\) onCancel\(\); \}\}/);
  assert.match(dialogSource, /cancelLabel = 'Cancel'/);
  assert.match(dialogSource, /variant="secondary" autoFocus onClick=\{onCancel\}>\{cancelLabel\}/);
  assert.match(dialogSource, /variant=\{confirmVariant\} disabled=\{confirmDisabled\} onClick=\{onConfirm\}>\{confirmLabel\}/);
});

test('confirmation dialog stays within narrow viewports and preserves app styling', () => {
  assert.match(styles, /\.confirmation-dialog\s*\{[^}]*width:\s*min\(470px, calc\(100vw - 32px\)\);[^}]*max-height:\s*calc\(100dvh - 32px\);/);
  assert.match(styles, /\.confirmation-dialog::backdrop\s*\{\s*background:\s*rgba\(19, 21, 31, \.48\);\s*\}/);
  assert.match(styles, /@media \(max-width: 460px\) \{[\s\S]*?\.confirmation-dialog\s*\{ padding: 20px; \}[\s\S]*?\.confirmation-dialog-actions > \.button \{ width: 100%; \}/);
});
