import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const pagePath = path.join(sourceDirectory, 'pages-manage.tsx');

function jsxAttribute(element, name) {
  return element.openingElement.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

test('certificate-name save is disabled when normalized names are unchanged', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const profileForms = [];
  const saveButtons = [];

  function visit(node, insideProfileForm = false) {
    if (ts.isJsxElement(node)) {
      const tagName = node.openingElement.tagName.getText();
      const formClass = jsxAttribute(node, 'className')?.initializer;
      const isProfileForm = tagName === 'form' && ts.isStringLiteral(formClass)
        && formClass.text === 'account-profile-form form-stack';
      const submitType = jsxAttribute(node, 'type')?.initializer;
      const isProfileButton = tagName === 'Button' && insideProfileForm
        && ts.isStringLiteral(submitType) && submitType.text === 'submit';
      if (isProfileForm) profileForms.push(node);
      if (isProfileButton) saveButtons.push(node);
      node.children.forEach((child) => visit(child, insideProfileForm || isProfileForm));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideProfileForm));
  }

  visit(sourceFile);
  assert.equal(profileForms.length, 1, 'expected one certificate-name form');
  assert.equal(saveButtons.length, 1, 'expected one certificate-name submit button');
  assert.equal(jsxAttribute(saveButtons[0], 'disabled')?.initializer?.expression?.getText(sourceFile),
    'saving || !certificateNameReady || !certificateNameChanged');
  assert.match(saveButtons[0].getText(sourceFile), /!certificateNameReady \? 'Loading…' : certificateNameChanged \? 'Save certificate name' : 'No changes'/);
  assert.match(source, /const certificateNameReady = profileNamesUserId === user\.id/);
  assert.match(source, /normalizeAccountName\(profileFirstName\).*user\.firstName/);
  assert.match(source, /normalizeAccountName\(profileLastName\).*user\.lastName/);
});

test('account course activity renders the explicit assignment source', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /type AdminAccountCourse = Course & \{[^}]*learningPathEnrolled: boolean/s);
  assert.match(source, /accountCourseAssignmentLabel\(course\)/);
});

test('account overview is a named level-two section heading', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');

  assert.match(source, /<article className="account-detail-card account-overview-card" aria-labelledby="account-overview-heading">[\s\S]*?<h2 id="account-overview-heading" className="account-overview-title">Account overview<\/h2>/);
  assert.match(source, /<h3>Certificate name<\/h3>/);
  assert.match(styles, /\.account-detail-card-heading\s+\.account-overview-title\s*\{\s*margin:\s*0;[^}]*font-size:\s*11px;/);
});

test('last-admin conflicts refresh account details before showing the server explanation', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminUserDetailsPage');
  assert.ok(component, 'expected to find the admin user details page');
  let updateAccount;

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'updateAccount') updateAccount = node.getText(sourceFile);
    ts.forEachChild(node, visit);
  }
  visit(component);

  assert.match(updateAccount, /cause instanceof ApiError && cause\.code === 'last_admin'/);
  assert.match(updateAccount, /api\.get<AdminAccountDetails>\(`\/api\/admin\/users\/\$\{requestedUserId\}\?page=\$\{page\}`\)/);
  assert.match(updateAccount, /setAccount\(refreshedAccount\);[\s\S]*?setError\(cause\.message\)/);
  assert.match(updateAccount, /setCanRetryLoad\(!\(refreshCause instanceof ApiError\)[\s\S]*?refreshCause\.status >= 500\)/);
});
