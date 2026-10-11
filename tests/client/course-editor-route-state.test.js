import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('changing course routes resets publication-only options', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseEditorPage');
  assert.ok(editor, 'expected to find the course editor');

  const routeEffect = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect'
      && ts.isArrayLiteralExpression(node.arguments[1])
      && node.arguments[1].elements.some((dependency) => dependency.getText(sourceFile) === 'route.courseId')) {
      routeEffect.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(editor);

  assert.equal(routeEffect.length, 1, 'expected one effect keyed to the course route');
  const effectCallback = routeEffect[0].arguments[0];
  assert.ok(ts.isArrowFunction(effectCallback) && ts.isBlock(effectCallback.body), 'expected a block route effect');
  const initialStateResets = effectCallback.body.statements
    .filter((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression))
    .slice(0, 2)
    .map((statement) => {
      const call = statement.expression;
      return [call.expression.getText(sourceFile), call.arguments[0]?.getText(sourceFile)];
    });

  assert.deepEqual(initialStateResets, [
    ['setRequiresRecompletion', 'false'],
    ['setChangeNote', "''"],
  ]);
});
