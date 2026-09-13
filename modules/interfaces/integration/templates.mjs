import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CONTEXT_PROTOCOL } from '../../knowledge/context/protocol.mjs';

export const packageRoot = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const packageInfo = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
export const TEMPLATE_VERSION = '0.1-integration-template';
export const RECEIPT_VERSION = '0.1-integration';
export const RECEIPT = '.waxwing/integration.json';
export const JOURNAL = '.waxwing/integration.journal.json';
export const BEGIN = '<!-- waxwing:begin -->';
export const END = '<!-- waxwing:end -->';
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Commands referenced by generated files. Tests assert each is a real CLI command.
export const TEMPLATE_COMMANDS = ['context', 'read', 'doctor', 'guide', 'validate', 'build-site', 'prepare', 'review-update', 'query', 'workspace', 'scan'];
export const installCommand = () => `npm install -g ${packageInfo.name}@${packageInfo.version}`;

export const HOSTS = {
  codex: { title: 'Codex', skillDirectory: '.agents/skills/waxwing', instructionCandidates: ['AGENTS.override.md', 'AGENTS.md'], createInstruction: 'AGENTS.md', activeFirstExisting: true, maxInstructionBytes: 32768 },
  claude: { title: 'Claude Code', skillDirectory: '.claude/skills/waxwing', instructionCandidates: ['CLAUDE.md', '.claude/CLAUDE.md'], createInstruction: 'CLAUDE.md', activeFirstExisting: false },
};
export const hostName = name => ({ 'claude-code': 'claude' })[name] ?? name;

export function instructionBlock(eol = '\n') {
  const lines = [BEGIN,
    '## Waxwing project knowledge',
    '',
    'Waxwing can retrieve available project explanations, source relationships and documentation. For a new investigation of repository behavior or system flow, run `waxwing context --question "<question>" --format json` (add `--clue` for a known symbol, path or error), then `waxwing read <ref> --format json`. Check scope and freshness, and verify consequential claims with source or runtime evidence.',
    '',
    `If \`waxwing\` is unavailable (\`${installCommand()}\`) or context is irrelevant, continue with normal tools. Do not repeat an unchanged failed lookup or start a full scan merely to satisfy this instruction. Follow the waxwing skill for detailed operations.`,
    END];
  return lines.join(eol);
}

// Portable skill files invoke `waxwing` on PATH instead of an absolute package binding.
export function portableSkillFiles() {
  const files = new Map();
  const template = fs.readFileSync(new URL('./templates/SKILL.md', import.meta.url), 'utf8');
  files.set('SKILL.md', template.replaceAll('{{install}}', installCommand()).replaceAll('{{protocol}}', CONTEXT_PROTOCOL));
  for (const name of ['investigate', 'create', 'update']) {
    const text = fs.readFileSync(path.join(packageRoot, 'skills/waxwing/references', `${name}.md`), 'utf8')
      .replaceAll('node "<skill>/scripts/waxwing.mjs"', 'waxwing')
      .replaceAll("through the adapter's `guide` command", 'with `waxwing guide <topic>`')
      .replaceAll('Commands use the adapter described in `SKILL.md`:', 'Commands use the installed `waxwing` runtime:');
    if (text.includes('<skill>')) throw new Error(`Packaged reference ${name}.md still refers to the bound skill adapter.`);
    files.set(`references/${name}.md`, text);
  }
  return files;
}
