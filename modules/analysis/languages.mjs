const extensions = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  kt: 'kotlin', kts: 'kotlin', java: 'java', py: 'python', go: 'go',
  m: 'objective-c', mm: 'objective-c++', sql: 'sql', json: 'json', sh: 'shell', bash: 'shell', lean: 'lean4',
};
export const supportedSourceLanguages = Object.freeze(['javascript', 'typescript']);
export const sourceLanguage = path => extensions[path.split('.').pop().toLowerCase()] ?? 'unknown';
