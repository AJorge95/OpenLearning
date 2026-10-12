import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function jsxTagName(tagName) {
  return ts.isIdentifier(tagName) ? tagName.text : '';
}

function labelWrappedAppSelects(sourceFile) {
  const violations = [];

  function visit(node, insideLabel = false) {
    if (ts.isJsxElement(node)) {
      const tagName = jsxTagName(node.openingElement.tagName);
      if (tagName === 'AppSelect' && insideLabel) violations.push(node.openingElement);
      const childIsInsideLabel = insideLabel || tagName === 'label';
      node.children.forEach((child) => visit(child, childIsInsideLabel));
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      if (jsxTagName(node.tagName) === 'AppSelect' && insideLabel) violations.push(node);
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideLabel));
  }

  visit(sourceFile);
  return violations;
}

function stringJsxAttribute(openingElement, name) {
  const attribute = openingElement.attributes.properties.find((property) => (
    ts.isJsxAttribute(property) && property.name.text === name
  ));
  return attribute && ts.isJsxAttribute(attribute) && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text : '';
}

function catalogFilterLabels(sourceFile) {
  const controls = [];

  function visit(node) {
    if (ts.isJsxElement(node)) {
      const classNames = stringJsxAttribute(node.openingElement, 'className').split(/\s+/);
      if (classNames.includes('catalog-filter-control')) {
        const label = node.children.find((child) => ts.isJsxElement(child)
          && stringJsxAttribute(child.openingElement, 'className') === 'catalog-filter-label');
        const select = node.children.find((child) => ts.isJsxSelfClosingElement(child)
          && jsxTagName(child.tagName) === 'AppSelect');
        if (label && select) {
          controls.push({
            visibleLabel: label.children.filter(ts.isJsxText).map((child) => child.text.trim()).join(' ').trim(),
            accessibleName: stringJsxAttribute(select, 'ariaLabel'),
          });
        }
        return;
      }
      node.children.forEach(visit);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return controls;
}

function appSelectFieldLabels(sourceFile) {
  const controls = [];

  function visit(node) {
    if (ts.isJsxElement(node)) {
      const classNames = stringJsxAttribute(node.openingElement, 'className').split(/\s+/);
      if (classNames.includes('app-select-field')) {
        const label = node.children.find((child) => ts.isJsxElement(child)
          && jsxTagName(child.openingElement.tagName) === 'span');
        const select = node.children.find((child) => ts.isJsxSelfClosingElement(child)
          && jsxTagName(child.tagName) === 'AppSelect');
        if (label && select) {
          const ariaLabel = select.attributes.properties.find((property) => (
            ts.isJsxAttribute(property) && property.name.text === 'ariaLabel'
          ));
          let expression = ariaLabel && ts.isJsxAttribute(ariaLabel) ? ariaLabel.initializer : undefined;
          if (expression && ts.isJsxExpression(expression)) expression = expression.expression;
          let accessibleName = '';
          if (expression && ts.isStringLiteralLike(expression)) accessibleName = expression.text;
          else if (expression && ts.isTemplateExpression(expression)) {
            accessibleName = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join('');
          }
          controls.push({
            visibleLabel: label.children.filter(ts.isJsxText).map((child) => child.text).join(' ').replace(/\s+/g, ' ').trim(),
            accessibleName,
            location: `${path.basename(sourceFile.fileName)}:${sourceFile.getLineAndCharacterOfPosition(select.getStart(sourceFile)).line + 1}`,
          });
        }
        return;
      }
      node.children.forEach(visit);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return controls;
}

function accountRoleControls(sourceFile) {
  const controls = [];

  function findRoleSelect(node) {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === 'AppSelect') return node.openingElement;
    if (ts.isJsxSelfClosingElement(node) && jsxTagName(node.tagName) === 'AppSelect') return node;
    let found;
    ts.forEachChild(node, (child) => {
      if (!found) found = findRoleSelect(child);
    });
    return found;
  }

  function visit(node) {
    if (ts.isJsxElement(node)) {
      const rowClasses = stringJsxAttribute(node.openingElement, 'className').split(/\s+/);
      if (rowClasses.includes('account-control-row')) {
        const field = node.children.find((child) => ts.isJsxElement(child)
          && stringJsxAttribute(child.openingElement, 'className').split(/\s+/).includes('account-role-control'));
        const label = field?.children.find((child) => ts.isJsxElement(child)
          && jsxTagName(child.openingElement.tagName) === 'span');
        const select = field && findRoleSelect(field);
        if (label && select) {
          controls.push({
            container: jsxTagName(field.openingElement.tagName),
            visibleLabel: label.children.filter(ts.isJsxText).map((child) => child.text).join(' ').trim(),
            labelId: stringJsxAttribute(label.openingElement, 'id'),
            controlId: stringJsxAttribute(select, 'controlId'),
            accessibleName: stringJsxAttribute(select, 'ariaLabelledBy') === 'account-platform-role-label' ? 'Platform role' : '',
            labelledBy: stringJsxAttribute(select, 'ariaLabelledBy'),
            matchTriggerWidth: select.attributes.properties.some((property) => (
              ts.isJsxAttribute(property) && property.name.text === 'matchTriggerWidth'
            )),
          });
        }
        return;
      }
      node.children.forEach(visit);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return controls;
}

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

test('the AppSelect label guard detects a wrapped custom control', () => {
  const source = ts.createSourceFile(
    'fixture.tsx',
    'const field = <label>Role <AppSelect ariaLabel="Role" /></label>;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.equal(labelWrappedAppSelects(source).length, 1);
});

test('AppSelect controls are not nested inside native labels', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return labelWrappedAppSelects(sourceFile).map((node) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      return `${path.relative(sourceDirectory, filePath)}:${line + 1}`;
    });
  });

  assert.deepEqual(violations, [], `AppSelect must use a separate field container instead of a wrapping label:\n${violations.join('\n')}`);
});

test('AppSelect ignores pointer clicks forwarded from outside its trigger', () => {
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');
  const activationSource = fs.readFileSync(path.join(sourceDirectory, 'app-select-activation.ts'), 'utf8');

  assert.match(componentSource, /const pointerStartedWithinTrigger = isAppSelectPointerDownWithinTrigger\(event\.currentTarget\);/);
  assert.match(componentSource, /if \(!isAppSelectActivationWithinTrigger\(event\.nativeEvent, event\.currentTarget\.getBoundingClientRect\(\), pointerStartedWithinTrigger\)\) return;/);
  assert.match(componentSource, /useEffect\(\(\) => subscribeToAppSelectPointerTracking\(\), \[\]\);/);
  assert.match(componentSource, /clearAppSelectPointerDownTarget\(\);/);
  assert.match(activationSource, /document\.addEventListener\('pointerdown', rememberPointerDown, true\)/);
  assert.match(activationSource, /pointerTrackingSubscribers === 0/);
});

test('the administrator role selector keeps its custom trigger and menu at the visible field width', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const sourceFile = ts.createSourceFile('pages-manage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = accountRoleControls(sourceFile);
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.deepEqual(controls, [{
    container: 'div',
    visibleLabel: 'Platform role',
    labelId: 'account-platform-role-label',
    controlId: 'account-platform-role',
    accessibleName: 'Platform role',
    labelledBy: 'account-platform-role-label',
    matchTriggerWidth: true,
  }]);
  assert.match(pageSource, /<AppSelect<Role> controlId="account-platform-role" ariaLabel="Platform role" ariaLabelledBy="account-platform-role-label"/);
  assert.match(pageSource, /onChange=\{\(role\) => updateAccount\(\{ role \}\)\}/);
  assert.match(pageSource, /const ACCOUNT_ROLE_OPTIONS: AppSelectOption<Role>\[\] = \[\s*\{ value: 'learner', label: 'Learner' \},\s*\{ value: 'moderator', label: 'Moderator' \},\s*\{ value: 'admin', label: 'Administrator' \},\s*\];/);
  assert.match(componentSource, /app-select-menu--match-trigger/);
  assert.match(componentSource, /aria-labelledby=\{ariaLabelledBy\}/);
  assert.match(styles, /\.account-role-control\s*\{[^}]*flex:\s*0\s+0\s+8\.5rem;[^}]*width:\s*8\.5rem;/);
  assert.match(styles, /\.account-role-control\s*\{[^}]*pointer-events:\s*none;/);
  assert.match(styles, /\.account-role-select-control\s*\{[^}]*width:\s*8\.5rem;[^}]*pointer-events:\s*none;/);
  assert.match(styles, /\.account-role-select-control \.app-select\s*\{[^}]*width:\s*100%;[^}]*pointer-events:\s*none;/);
  assert.match(styles, /\.account-role-select-control \.app-select-trigger\s*\{[^}]*pointer-events:\s*auto;/);
  assert.match(styles, /\.account-control-row \.account-role-select-control, \.account-control-row \.account-role-select-control \.app-select \{\s*width:\s*100%;\s*max-width:\s*none;\s*\}/);
});

test('account details explain and disable controls for the last active administrator', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');

  assert.match(pageSource, /isLastActiveAdmin: boolean/);
  assert.equal((pageSource.match(/disabled=\{saving \|\| user\.isLastActiveAdmin\}/g) || []).length, 2);
  assert.match(pageSource, /ariaLabelledBy="account-platform-role-label" describedBy=\{user\.isLastActiveAdmin \? lastAdminHelpId : undefined\}/);
  assert.match(pageSource, /disabled=\{saving \|\| user\.isLastActiveAdmin\} onChange=\{\(role\) => updateAccount\(\{ role \}\)\}/);
  assert.match(pageSource, /user\.isLastActiveAdmin && <p className="account-admin-protection" id=\{lastAdminHelpId\}>This is the only active administrator\./);
});

test('user list explains and disables inline changes for the last active administrator', () => {
  const pageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const typeSource = fs.readFileSync(path.join(sourceDirectory, 'types.ts'), 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.match(typeSource, /isLastActiveAdmin\?: boolean/);
  assert.match(pageSource, /describedBy=\{user\.isLastActiveAdmin \? lastAdminHelpId : undefined\} value=\{user\.role\} disabled=\{savingIds\.has\(user\.id\) \|\| user\.isLastActiveAdmin\}/);
  assert.match(pageSource, /aria-describedby=\{user\.isLastActiveAdmin \? lastAdminHelpId : undefined\} disabled=\{savingIds\.has\(user\.id\) \|\| user\.isLastActiveAdmin\} onClick=\{\(\) => updateUser\(user, \{ disabled: !user\.disabled \}\)\}/);
  assert.match(pageSource, /className="last-active-admin-note" id=\{lastAdminHelpId\}>This is the only active administrator\./);
  assert.match(pageSource, /changes\.role !== undefined \|\| \(changes\.disabled !== undefined && user\.role === 'admin'\)/);
  assert.match(pageSource, /cause instanceof ApiError && cause\.code === 'last_admin'[\s\S]*?await load\(currentListState\.page, currentListState\.query, currentListState\.roleFilter, currentListState\.approvalFilter\)\) setError\(cause\.message\)/);
  assert.match(styles, /\.last-active-admin-note\s*\{[^}]*white-space:\s*normal;/);
});

test('AppSelect disables its trigger and popup when no enabled options remain', () => {
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');

  assert.match(componentSource, /isAppSelectUnavailable\(options, disabled\)/);
  assert.match(componentSource, /const menuOpen = open && !unavailable/);
  assert.match(componentSource, /disabled=\{unavailable\}/);
  assert.match(componentSource, /\{menuOpen && createPortal/);
});

test('AppSelect resolves dynamic active options before announcing or choosing them', () => {
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');

  assert.match(componentSource, /resolveAppSelectActiveIndex\(options, activeValue, selectedIndex\)/);
  assert.match(componentSource, /setActiveValue\(option\.value\)/);
  assert.match(componentSource, /choose\(activeOptionIndex\)/);
  assert.match(componentSource, /aria-activedescendant=\{menuOpen \? `\$\{menuId\}-option-\$\{activeOptionIndex\}` : undefined\}/);
});

test('catalog filter accessible names contain their visible labels', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-learner.tsx'), 'utf8');
  const sourceFile = ts.createSourceFile('pages-learner.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const controls = catalogFilterLabels(sourceFile);

  assert.equal(controls.length, 2);
  for (const { visibleLabel, accessibleName } of controls) {
    assert.ok(accessibleName.toLocaleLowerCase().includes(visibleLabel.toLocaleLowerCase()),
      `The “${visibleLabel}” filter is announced as “${accessibleName}”.`);
  }
});

test('form AppSelect accessible names contain their visible field labels', () => {
  const controls = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return appSelectFieldLabels(sourceFile);
  });

  assert.ok(controls.length > 0, 'Expected to find AppSelect controls in labeled form fields.');
  for (const { visibleLabel, accessibleName, location } of controls) {
    assert.ok(accessibleName.toLocaleLowerCase().includes(visibleLabel.toLocaleLowerCase()),
      `${location}: the “${visibleLabel}” field is announced as “${accessibleName}”.`);
  }
});
