import { Parser, Language } from 'web-tree-sitter';
import { getWasmPath } from 'tree-sitter-wasm';
import { sourceRecordId } from '../knowledge/source/model.mjs';
import { sourceLanguageProfiles } from './languages.mjs';
import { treeSitterProfiles } from './tree-sitter-profiles.mjs';

const initialized = Parser.init();
const languages = new Map();
export const treeSitterVersion = '0.27.0';
export const grammarPackageVersion = '2.0.1';
function loadLanguage(grammar) {
  if (!languages.has(grammar)) languages.set(grammar, Language.load(getWasmPath(grammar)));
  return languages.get(grammar);
}
export async function analyzeTreeSitter(inputs) {
  await initialized;
  const declarations = [], references = [], diagnostics = [];
  for (const { file, content } of inputs) {
    const profile = treeSitterProfiles[file.language], grammar = sourceLanguageProfiles[file.language].grammar;
    file.analysis = { backend: 'tree-sitter', version: treeSitterVersion, grammar: `${grammar}@tree-sitter-wasm/${grammarPackageVersion}`, level: 'syntax',
      capabilities: ['declarations', 'containment', 'call-occurrences', 'module-occurrences'].filter(cap => cap !== 'call-occurrences' || Object.keys(profile.calls).length).filter(cap => cap !== 'module-occurrences' || Object.keys(profile.imports).length),
      limitations: ['Selected syntax forms only; no symbol, import, type or call-target resolution. No project configuration, external implementations or runtime execution.'] };
    if (file.language === 'objective-c++') file.analysis.limitations.push('Objective-C grammar only: C++ constructs in .mm files are not covered reliably; recovery is not Objective-C++ support.');
    if (file.language === 'sql') file.analysis.limitations.push('Generic SQL grammar: tables/views and invocation syntax only; dialects, table-reference resolution and schema lineage are not analyzed.');
    if (file.language === 'json') file.analysis.limitations.push('JSON keys and nesting only; values are not interpreted as paths, imports or dependencies.');
    if (file.language === 'shell') file.analysis.limitations.push('Bash grammar: function and command syntax only; expansions, sourced files and command targets are not resolved.');
    const parser = new Parser(); let tree;
    try {
      parser.setLanguage(await loadLanguage(grammar));
      tree = parser.parse(content);
      if (!tree) throw new Error(`Tree-sitter did not produce a tree for ${file.path}.`);
      file.parseStatus = tree.rootNode.hasError ? 'errors' : 'parsed';
      // Web Tree-sitter's string API uses UTF-16 indices. Derive line/column
      // from those indices so every adapter obeys the same source contract.
      const lines = [0]; for (let i = 0; i < content.length; i++) if (content[i] === '\n') lines.push(i + 1);
      const position = offset => { let lo = 0, hi = lines.length; while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (lines[mid] <= offset) lo = mid; else hi = mid; } return { offset, line: lo + 1, column: offset - lines[lo] + 1 }; };
      const span = node => ({ start: position(node.startIndex), end: position(node.endIndex) });
      const stack = [{ node: tree.rootNode, containerRef: file.id }];
      const seen = new Set();
      while (stack.length) {
        const { node, containerRef } = stack.pop();
        let owner = containerRef;
        if (node.type === 'ERROR' || node.isMissing) diagnostics.push({ code: 'tree-sitter/syntax', message: node.isMissing ? `Missing ${node.type}.` : 'Grammar could not parse this source region.', fileRef: file.id, span: span(node) });
        const rule = profile.declarations[node.type], nameNode = rule?.name(node);
        if (nameNode?.text.trim()) {
          let name = nameNode.text;
          if (file.language === 'json') { try { name = JSON.parse(name); } catch { /* Retain recovered syntax. */ } }
          if (typeof name === 'string' && name.trim()) {
            const range = span(node), id = sourceRecordId('decl', file, range, rule.kind);
            if (!seen.has(id)) { declarations.push({ id, fileRef: file.id, containerRef, kind: rule.kind, name, span: range }); seen.add(id); owner = id; }
          }
        }
        for (const [kind, extractor] of [['call', profile.calls[node.type]], ['import', profile.imports[node.type]]]) {
          if (!extractor) continue;
          const extracted = extractor(node); if (!extracted) continue;
          const target = extracted.node ?? extracted, name = extracted.name ?? target.text, referenceKind = extracted.kind ?? kind;
          if (!name?.trim()) continue;
          const range = span(target), id = sourceRecordId('ref', file, range, referenceKind);
          if (!seen.has(id)) { references.push({ id, fileRef: file.id, containerRef: owner, kind: referenceKind, name, span: range,
            resolution: { status: 'unresolved', targets: [], reason: file.parseStatus === 'errors' ? 'syntax-errors' : 'syntax-only-no-resolution' } }); seen.add(id); }
        }
        // Include unnamed missing tokens as diagnostics too.
        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--) if (children[i].isNamed || children[i].isMissing) stack.push({ node: children[i], containerRef: owner });
      }
    } finally { tree?.delete(); parser.delete(); }
  }
  return { declarations, references, diagnostics };
}
