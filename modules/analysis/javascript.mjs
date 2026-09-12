import path from 'node:path';
import ts from 'typescript';
import { sourceRecordId } from '../knowledge/source/model.mjs';

export const producer = Object.freeze({ name: 'typescript', version: ts.version, adapterVersion: '0.2.0',
  configuration: 'ESNext; bundler resolution; every input is a module; noLib; no project configuration, plugins, emit or semantic diagnostics.' });
const prefix = '/__waxwing__/';
const normalize = name => path.posix.normalize(name);
const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force, allowJs: true, checkJs: false, noLib: true, noEmit: true, skipLibCheck: true,
  jsx: ts.JsxEmit.Preserve, allowImportingTsExtensions: true, allowNonTsExtensions: true };

function declarationKind(node) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) return 'function';
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return 'class';
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node)) return 'method';
  if (ts.isVariableDeclaration(node)) return node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? 'function' : 'variable';
  if (ts.isBindingElement(node)) {
    let root = node.parent;
    while (root && (ts.isObjectBindingPattern(root) || ts.isArrayBindingPattern(root) || ts.isBindingElement(root))) root = root.parent;
    return root && ts.isParameter(root) ? 'parameter' : 'variable';
  }
  if (ts.isParameter(node)) return 'parameter';
  if (ts.isTypeParameterDeclaration(node)) return 'type-parameter';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) return 'property';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type-alias';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isEnumMember(node)) return 'enum-member';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  if (ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) return 'import-binding';
  return null;
}
function span(source, start, end) {
  const position = offset => { const p = source.getLineAndCharacterOfPosition(offset); return { offset, line: p.line + 1, column: p.character + 1 }; };
  return { start: position(start), end: position(end) };
}
const occurrenceSpan = (source, node) => span(source, node.getStart(source), node.getEnd());
function visit(root, fn) {
  // Iterative traversal also handles deeply nested user source without our own recursion.
  const stack = [root];
  while (stack.length) {
    const node = stack.pop(); fn(node);
    const children = []; ts.forEachChild(node, child => { children.push(child); });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

export function analyzeJavaScript(inputs) {
  const entries = new Map(inputs.map(input => [prefix + input.file.path, input]));
  const trees = new Map(), directories = new Set([prefix.slice(0, -1)]);
  for (const name of entries.keys()) for (let dir = path.posix.dirname(name); dir !== '/'; dir = path.posix.dirname(dir)) directories.add(dir);
  // Deliberately do not delegate to ts.sys or a default compiler host. All source
  // and resolution reads stay within the supplied snapshot, including /// refs.
  const host = {
    getSourceFile(name, languageVersion) {
      name = normalize(name);
      if (!entries.has(name)) return undefined;
      if (!trees.has(name)) {
        const input = entries.get(name), extension = path.posix.extname(name).toLowerCase();
        const kind = extension === '.tsx' ? ts.ScriptKind.TSX : extension === '.jsx' ? ts.ScriptKind.JSX : input.file.language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        trees.set(name, ts.createSourceFile(name, input.content, languageVersion, true, kind));
      }
      return trees.get(name);
    },
    getDefaultLibFileName: () => prefix + '__no_lib__.d.ts', writeFile: () => { throw new Error('Source analysis must not emit files.'); },
    getCurrentDirectory: () => prefix, getCanonicalFileName: normalize, useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n', fileExists: name => entries.has(normalize(name)),
    readFile: name => entries.get(normalize(name))?.content,
    directoryExists: name => directories.has(normalize(name)),
    getDirectories: name => [...directories].filter(dir => path.posix.dirname(dir) === normalize(name)),
    realpath: normalize,
  };
  const program = ts.createProgram([...entries.keys()], options, host), checker = program.getTypeChecker();
  const declarations = [], references = [], diagnostics = [], declarationNodes = new Map(), definitionNames = new Set();
  const owner = (node, file) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (declarationNodes.has(parent)) return declarationNodes.get(parent).id;
    return file.id;
  };
  // Index declarations across all files before resolving any occurrences.
  for (const [filename, { file }] of entries) {
    const source = program.getSourceFile(filename);
    const errors = program.getSyntacticDiagnostics(source);
    file.parseStatus = errors.length ? 'errors' : 'parsed';
    for (const error of errors) diagnostics.push({ code: `typescript/${error.code}`, message: ts.flattenDiagnosticMessageText(error.messageText, '\n'), fileRef: file.id,
      span: span(source, error.start ?? 0, Math.min(source.text.length, (error.start ?? 0) + (error.length ?? 0))) });
    visit(source, node => {
      const kind = declarationKind(node), name = node.name;
      if (!kind || !name || !(ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) || !name.text.trim()) return;
      const range = occurrenceSpan(source, node);
      const record = { id: sourceRecordId('decl', file, range, kind), fileRef: file.id, containerRef: owner(node, file), kind, name: name.text, span: range };
      declarationNodes.set(node, record); declarations.push(record);
      if (!ts.isShorthandPropertyAssignment(node)) definitionNames.add(name);
    });
  }
  const unresolved = reason => ({ status: 'unresolved', targets: [], reason });
  const bound = (targets, reason) => ({ status: targets.length === 1 ? 'resolved' : 'ambiguous', targets, reason: targets.length === 1 ? reason : 'multiple-declarations' });
  function resolveSymbol(node, file) {
    if (file.parseStatus === 'errors') return unresolved('syntax-errors');
    let symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
    if (!symbol) return unresolved('unbound');
    return resolveCompilerSymbol(symbol);
  }
  function resolveCompilerSymbol(symbol) {
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const targets = [];
    for (const declaration of symbol?.declarations ?? []) {
      const targetFile = entries.get(declaration.getSourceFile().fileName)?.file;
      if (targetFile?.parseStatus === 'errors') return unresolved('syntax-errors');
      const target = declarationNodes.get(declaration)?.id ?? (ts.isSourceFile(declaration) ? targetFile?.id : undefined);
      if (target && !targets.includes(target)) targets.push(target);
    }
    return targets.length ? bound(targets.sort(), 'compiler-binding') : unresolved('unindexed-or-external-symbol');
  }
  function moduleBoundary(name) {
    if (name.startsWith('node:')) return 'external-builtin';
    if (name.startsWith('.')) return 'missing-internal-module';
    if (/^(?:@[^/]+\/)?[a-zA-Z0-9_-]+(?:\/[^:]*)?$/.test(name)) return 'external-package-specifier';
    return 'unconfigured-module-specifier';
  }
  // Writes are detected by lexical symbol identity, including invalid writes to
  // const. We do not attempt control-flow proof that a particular call is safe.
  const written = new Set();
  function markWrite(node) {
    if (!node) return;
    if (ts.isIdentifier(node)) {
      const symbol = ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node);
      for (const d of symbol?.declarations ?? []) written.add(d);
    } else if (ts.isParenthesizedExpression(node)) markWrite(node.expression);
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(markWrite);
    else if (ts.isObjectLiteralExpression(node)) node.properties.forEach(p => markWrite(ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : p.expression));
    else if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) markWrite(node.expression);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) markWrite(node.left);
  }
  for (const source of trees.values()) visit(source, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) markWrite(node.left);
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) markWrite(node.operand);
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) markWrite(node.initializer);
  });
  // A checker can choose one export in an invalid star collision. Collect star
  // candidates independently of that choice, retaining ambiguity and cycles.
  function exportResolution(source, name, active = new Set()) {
    if (active.has(source)) return unresolved('cyclic-export');
    if (entries.get(source.fileName)?.file.parseStatus === 'errors') return unresolved('syntax-errors');
    const next = new Set(active).add(source), moduleSymbol = checker.getSymbolAtLocation(source);
    const direct = moduleSymbol?.exports?.get(ts.escapeLeadingUnderscores(name));
    if (direct) {
      // Follow named re-export syntax before asking the checker to collapse an
      // alias; otherwise a facade can conceal a star-export collision.
      for (const declaration of direct.declarations ?? []) {
        if (!ts.isExportSpecifier(declaration)) continue;
        const statement = declaration.parent.parent;
        if (declaration.isTypeOnly || statement.isTypeOnly) return unresolved('type-only-export');
        if (statement.moduleSpecifier) {
          const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, source.fileName, options, host).resolvedModule;
          const target = resolved && program.getSourceFile(resolved.resolvedFileName);
          return target ? exportResolution(target, (declaration.propertyName ?? declaration.name).text, next) : unresolved('unresolved-re-export');
        }
        const local = checker.getExportSpecifierLocalTargetSymbol(declaration);
        // Local import aliases require the same care. Other alias forms remain
        // unproven rather than selecting a value from an incomplete module.
        for (const imported of local?.declarations ?? []) {
          if (!ts.isImportSpecifier(imported) && !ts.isImportClause(imported)) continue;
          const clause = ts.isImportSpecifier(imported) ? imported.parent.parent : imported;
          const statement = clause.parent;
          if (imported.isTypeOnly || clause.isTypeOnly) return unresolved('type-only-export');
          const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, source.fileName, options, host).resolvedModule;
          const target = resolved && program.getSourceFile(resolved.resolvedFileName);
          const importedName = ts.isImportSpecifier(imported) ? (imported.propertyName ?? imported.name).text : 'default';
          return target ? exportResolution(target, importedName, next) : unresolved('unresolved-re-export');
        }
      }
      return resolveCompilerSymbol(direct);
    }
    if (name === 'default') return unresolved('missing-export');
    const targets = new Set(); let uncertainty;
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || statement.exportClause || !statement.moduleSpecifier || statement.isTypeOnly) continue;
      const resolved = ts.resolveModuleName(statement.moduleSpecifier.text, source.fileName, options, host).resolvedModule;
      const target = resolved && program.getSourceFile(resolved.resolvedFileName);
      const result = target ? exportResolution(target, name, next) : unresolved('unresolved-re-export');
      result.targets.forEach(id => targets.add(id));
      if (result.status === 'unresolved' && !['missing-export', 'cyclic-export'].includes(result.reason)) uncertainty = result.reason;
    }
    if (uncertainty) return unresolved(uncertainty);
    return targets.size ? bound([...targets].sort(), 'export-binding') : unresolved('missing-export');
  }
  function addImportProvenance() {
    const refs = new Map(references.map(r => [r.id, r]));
    const nodes = new Map([...declarationNodes].map(([node, record]) => [record.id, node]));
    for (const [node, record] of declarationNodes) {
      if (!ts.isBindingElement(node)) continue;
      let root = node.parent;
      while (root && (ts.isBindingElement(root) || ts.isObjectBindingPattern(root) || ts.isArrayBindingPattern(root))) root = root.parent;
      if (!root || !ts.isVariableDeclaration(root) || !root.initializer || !ts.isAwaitExpression(root.initializer)) continue;
      const call = root.initializer.expression;
      if (!ts.isCallExpression(call) || call.expression.kind !== ts.SyntaxKind.ImportKeyword || !call.arguments.length) continue;
      const source = node.getSourceFile(), file = entries.get(source.fileName).file, specifier = call.arguments[0];
      const moduleRef = sourceRecordId('ref', file, occurrenceSpan(source, specifier), 'dynamic-import');
      const module = refs.get(moduleRef);
      const name = node.propertyName ?? node.name;
      const supported = node.parent === root.name && ts.isObjectBindingPattern(root.name) && ts.isIdentifier(node.name) && !node.dotDotDotToken && !node.initializer && (ts.isIdentifier(name) || ts.isStringLiteral(name));
      let resolution;
      if (file.parseStatus === 'errors') resolution = unresolved('syntax-errors');
      else if (!supported) resolution = unresolved('unsupported-binding-pattern');
      else if (!(root.parent.flags & ts.NodeFlags.Const)) resolution = unresolved('mutable-binding');
      else if (written.has(node)) resolution = unresolved('written-binding');
      else if (module.resolution.status !== 'resolved') resolution = { ...module.resolution, targets: [] };
      else {
        const targetFile = inputs.find(i => i.file.id === module.resolution.targets[0]).file;
        resolution = exportResolution(program.getSourceFile(prefix + targetFile.path), name.text);
        if (resolution.status === 'resolved') resolution.reason = 'export-binding';
        if (resolution.targets.some(id => {
          const target = nodes.get(id);
          return target && (written.has(target) || ts.isVariableDeclaration(target) && !(target.parent.flags & ts.NodeFlags.Const) || ts.isBindingElement(target));
        })) resolution = unresolved('mutable-export');
      }
      record.valueProvenance = { kind: 'await-import', moduleRef, ...(supported ? { importedName: name.text } : {}), resolution };
    }
  }
  for (const [filename, { file }] of entries) {
    const source = program.getSourceFile(filename);
    const add = (node, kind, name, resolution) => {
      const range = occurrenceSpan(source, node);
      references.push({ id: sourceRecordId('ref', file, range, kind), fileRef: file.id, containerRef: owner(node, file), kind, name, span: range, resolution });
    };
    const module = (node, kind) => {
      const literal = ts.isStringLiteralLike(node);
      let resolution = unresolved(literal ? moduleBoundary(node.text) : 'dynamic-module');
      if (literal && file.parseStatus === 'errors') resolution = unresolved('syntax-errors');
      else if (literal) {
        const result = ts.resolveModuleName(node.text, filename, options, host).resolvedModule;
        const target = result && entries.get(result.resolvedFileName)?.file;
        if (target) resolution = target.parseStatus === 'errors' ? unresolved('syntax-errors') : bound([target.id], 'module-path');
      }
      add(node, kind, literal && node.text.trim() ? node.text : '(dynamic)', resolution);
    };
    visit(source, node => {
      if (ts.isImportDeclaration(node)) module(node.moduleSpecifier, 'import');
      else if (ts.isExportDeclaration(node) && node.moduleSpecifier) module(node.moduleSpecifier, 're-export');
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) module(node.moduleReference.expression, 'require');
      else if (ts.isCallExpression(node) && node.arguments.length) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) module(node.arguments[0], 'dynamic-import');
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && !checker.getSymbolAtLocation(node.expression)?.declarations?.length) module(node.arguments[0], 'require');
      }
      if (!(ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) || definitionNames.has(node) || !node.text.trim()) return;
      // Labels and non-shorthand literal object keys are not binding uses.
      if ((ts.isLabeledStatement(node.parent) || ts.isBreakStatement(node.parent) || ts.isContinueStatement(node.parent)) && node.parent.label === node) return;
      let expression = node;
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) expression = node.parent;
      const kind = ts.isCallExpression(expression.parent) && expression.parent.expression === expression ? 'call' :
        ts.isNewExpression(expression.parent) && expression.parent.expression === expression ? 'construct' : 'reference';
      add(node, kind, node.text, resolveSymbol(node, file));
    });
  }
  addImportProvenance();
  return { declarations, references, diagnostics };
}
