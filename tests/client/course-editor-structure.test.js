import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const editorPath = path.join(sourceDirectory, 'pages-manage.tsx');

function jsxAttribute(element, name) {
  const attribute = element.openingElement.attributes.properties.find((item) =>
    ts.isJsxAttribute(item) && item.name.getText() === name);
  return attribute && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null;
}

test('course details form is exposed as a named region', () => {
  const source = fs.readFileSync(editorPath, 'utf8');
  const sourceFile = ts.createSourceFile(editorPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sections = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'section'
      && jsxAttribute(node, 'className')?.split(/\s+/).includes('course-details-form')) {
      sections.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(sections.length, 1, 'expected one course details section');
  assert.equal(jsxAttribute(sections[0], 'aria-label'), 'Course details');
});

test('the empty-course action distinguishes adding the first module', () => {
  const source = fs.readFileSync(editorPath, 'utf8');

  assert.match(source, /title="Start with a module"[\s\S]*?Add first module<\/Button>/);
  assert.match(source, /className="curriculum-editor-actions"[\s\S]*?aria-expanded=\{addingModule\}[\s\S]*?Add module<\/Button>/);
});

test('quiz editor actions include quiz and question context in accessible names', () => {
  const source = fs.readFileSync(editorPath, 'utf8');
  const sourceFile = ts.createSourceFile(editorPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'QuizEditor');

  assert.ok(declaration, 'expected to find the quiz editor component');
  const quizEditor = declaration.getText(sourceFile);
  assert.match(quizEditor, /const quizContext = .*module\.position \+ 1/);
  const ariaLabels = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'aria-label') {
      ariaLabels.push(node.initializer?.getText(sourceFile) || '');
    }
    ts.forEachChild(node, visit);
  }
  visit(declaration);
  assert.ok(ariaLabels.some((label) => label.includes('Add question to ${quizContext}')));
  assert.ok(ariaLabels.some((label) => label.includes('Add answer choice to question ${questionIndex + 1} in ${quizContext}')));
  assert.ok(ariaLabels.some((label) => label.includes('Save quiz ${quizContext}')));
  assert.ok(ariaLabels.some((label) => label.includes('No changes to ${quizContext}')));
  assert.ok(ariaLabels.some((label) => label.includes('Remove question ${questionIndex + 1} from ${quizContext}')));
});

test('course details grid changes to two columns before tablet overflow', () => {
  const styles = fs.readFileSync(path.join(sourceDirectory, 'styles.css'), 'utf8');
  const tabletLayout = styles.match(/@media\s*\(max-width:\s*1140px\)\s*\{([^}]*)\}/);
  const mobileRule = '.editor-field-grid { display: flex; flex-direction: column;';
  const mobileRuleIndex = styles.indexOf(mobileRule);
  const mobileBreakpointIndex = styles.lastIndexOf('@media (max-width: 720px)', mobileRuleIndex);

  assert.ok(tabletLayout, 'expected a tablet breakpoint for the course details grid');
  assert.match(tabletLayout[1], /\.editor-field-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.ok(mobileBreakpointIndex >= 0, 'expected the existing phone layout override');
  assert.ok(mobileRuleIndex > mobileBreakpointIndex, 'expected the phone override inside its breakpoint');
});
