"""Extract usage and visible tool activity; does not grade answer correctness."""
import argparse
from collections import Counter
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('results', type=Path)
a = p.parse_args()
summaries = []
for folder in sorted(a.results.iterdir()):
    if not (folder / 'result.json').exists():
        continue
    final = json.loads((folder / 'result.json').read_text())
    invocation = json.loads((folder / 'invocation.json').read_text())
    events = [json.loads(x) for x in (folder / 'transcript.jsonl').read_text().splitlines()]
    calls = []
    errors = []
    texts = []
    for e in events:
        if e.get('type') == 'assistant':
            for b in e.get('message', {}).get('content', []):
                if b.get('type') == 'tool_use':
                    calls.append(b)
                elif b.get('type') == 'text':
                    texts.append(b['text'])
        elif e.get('type') == 'user':
            for b in e.get('message', {}).get('content', []):
                if b.get('type') == 'tool_result' and b.get('is_error'):
                    errors.append(b)
    # De-duplicate tool IDs if streaming repeats an event.
    calls = list({c['id']: c for c in calls}.values())
    root = Path(invocation['checkout'])
    outside = []
    for c in calls:
        for k in ['path', 'file_path']:
            if k in c['input']:
                q = Path(c['input'][k])
                q = (q if q.is_absolute() else root / q).resolve()
                if not q.is_relative_to(root):
                    outside.append(str(q))
    reads = Counter(c['input']['file_path'] for c in calls if c['name'] == 'Read')
    signatures = Counter(json.dumps([c['name'], c['input']], sort_keys=True) for c in calls)
    usage = final.get('usage', {})
    summary = {
        'run': folder.name, 'model_usage': final.get('modelUsage'),
        'elapsed_seconds': invocation.get('elapsed_seconds'),
        'exit_code': invocation.get('exit_code'), 'subtype': final.get('subtype'),
        'is_error': final.get('is_error'), 'usage': usage,
        'accounted_input': sum(usage.get(k, 0) for k in ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']),
        'estimated_usd': final.get('total_cost_usd'),
        'tool_counts': dict(Counter(c['name'] for c in calls)),
        'tool_calls': len(calls), 'unique_read_files': len(reads),
        'repeat_file_reads': sum(n-1 for n in reads.values()),
        'identical_repeat_calls': sum(n-1 for n in signatures.values()),
        'note_reads': sum(n for f,n in reads.items() if f.endswith('/knowledge/checkout-notes.md')),
        'outside_paths': outside, 'tool_errors': len(errors),
        'permission_denials': final.get('permission_denials', []),
    }
    summaries.append(summary)
    (folder / 'tool-calls.json').write_text(json.dumps(calls, indent=2))
    (folder / 'assistant-text.md').write_text('\n\n'.join(texts))
    (folder / 'summary.json').write_text(json.dumps(summary, indent=2))
(a.results / 'summary.json').write_text(json.dumps(summaries, indent=2))
print(json.dumps(summaries, indent=2))
