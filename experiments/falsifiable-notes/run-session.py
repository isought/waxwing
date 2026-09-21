"""Run one isolated, read-only experimental subject; preserve raw evidence."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--checkout', type=Path, required=True)
p.add_argument('--prompt', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--budget', default='12')
p.add_argument('--expected-revision', default='5036306fcbd95180135a9ce0dc16b574f032936b')
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=False)
command = [
    'claude', '-p', '--output-format', 'stream-json', '--verbose',
    '--model', 'claude-sonnet-4-6', '--effort', 'high',
    '--tools', 'Grep,Glob,Read', '--allowedTools', 'Grep,Glob,Read',
    '--permission-mode', 'dontAsk', '--disable-slash-commands',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--setting-sources', 'project', '--settings', '{"disableAllHooks":true}',
    '--no-chrome', '--no-session-persistence', '--max-budget-usd', a.budget,
    '--system-prompt',
    'You are a coding agent conducting an independent read-only source investigation. '
    'Use the available text search and file reading tools to inspect the repository in the current working directory. '
    'Reason carefully about conditions and data flow. Cite source locations for consequential claims, '
    'separate inference from observed execution, and do not claim exhaustive coverage. '
    'Read only files within the current repository. Do not seek instructions, memories, solutions, '
    'or artifacts outside it. Do not edit code or execute tests.',
]
env = os.environ.copy()
env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'] = '1'
env['CLAUDE_CODE_MAX_OUTPUT_TOKENS'] = '16000'
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=a.checkout, text=True).strip()
assert revision == a.expected_revision, revision
assert not subprocess.check_output(['git', 'diff', 'HEAD', '--name-only'], cwd=a.checkout, text=True).strip()
metadata = {'command': command, 'checkout': str(a.checkout.resolve()), 'revision': revision,
            'environment_overrides': {k: env[k] for k in ['CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS']},
            'version': subprocess.check_output(['claude', '--version'], text=True).strip()}
(a.output / 'prompt.txt').write_text(a.prompt.read_text())
(a.output / 'invocation.json').write_text(json.dumps(metadata, indent=2))
started = time.time()
with (a.output / 'transcript.jsonl').open('x') as out, (a.output / 'stderr.log').open('x') as err:
    result = subprocess.run(command, input=a.prompt.read_text(), cwd=a.checkout, env=env,
                            text=True, stdout=out, stderr=err, timeout=1200)
metadata.update(exit_code=result.returncode, elapsed_seconds=time.time()-started)
(a.output / 'invocation.json').write_text(json.dumps(metadata, indent=2))
events = [json.loads(line) for line in (a.output / 'transcript.jsonl').read_text().splitlines() if line.strip()]
finals = [e for e in events if e.get('type') == 'result']
if finals:
    (a.output / 'result.json').write_text(json.dumps(finals[-1], indent=2))
    (a.output / 'answer.md').write_text(finals[-1].get('result', ''))
print(json.dumps({'output':str(a.output), 'exit_code':result.returncode, 'elapsed':metadata['elapsed_seconds']}), flush=True)
raise SystemExit(result.returncode)
