// This catalog declares tested extraction profiles, not every grammar installed
// in the dependency. Adding an extension alone must never claim support.
const entries = [
  ['javascript', ['js','jsx','mjs','cjs'], null],
  ['typescript', ['ts','tsx','mts','cts'], null],
  ['kotlin', ['kt','kts'], 'kotlin'], ['java', ['java'], 'java'],
  ['python', ['py','pyi'], 'python'], ['go', ['go'], 'go'],
  ['objective-c', ['m'], 'objc'], ['objective-c++', ['mm'], 'objc'],
  ['sql', ['sql'], 'sql'], ['json', ['json'], 'json'], ['shell', ['sh','bash'], 'bash'],
  ['c', ['c','h'], 'c'], ['cpp', ['cc','cpp','cxx','hpp','hh','hxx'], 'cpp'],
  ['csharp', ['cs'], 'c_sharp'], ['rust', ['rs'], 'rust'],
  ['ruby', ['rb'], 'ruby'], ['swift', ['swift'], 'swift'],
];
export const sourceLanguageProfiles = Object.freeze(Object.fromEntries(entries.map(([language, extensions, grammar]) => [language,
  Object.freeze({ language, extensions: Object.freeze(extensions), backend: grammar ? 'tree-sitter' : 'typescript', ...(grammar ? { grammar } : {}) })])));
const extensions = Object.fromEntries(entries.flatMap(([language, exts]) => exts.map(ext => [ext, language])));
extensions.lean = 'lean4';
export const supportedSourceLanguages = Object.freeze(Object.keys(sourceLanguageProfiles));
export const sourceLanguage = path => extensions[path.split('.').pop().toLowerCase()] ?? 'unknown';
