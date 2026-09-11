from pathlib import Path
import re
import shutil

ROOT = Path('.')
PATCH_ARCHIVE = ROOT / 'archive' / 'legacy-patches'
WORKFLOW_ARCHIVE = ROOT / 'archive' / 'legacy-workflows'
PATCH_ARCHIVE.mkdir(parents=True, exist_ok=True)
WORKFLOW_ARCHIVE.mkdir(parents=True, exist_ok=True)

# Archive every historical source-rewriting patch. These files are audit-only now.
for path in sorted((ROOT / 'scripts').glob('apply-*.py')):
    shutil.move(str(path), str(PATCH_ARCHIVE / path.name))
for name in ['apply-v3-stack.sh', 'run-balance-rework-v3.py']:
    path = ROOT / 'scripts' / name
    if path.exists():
        shutil.move(str(path), str(PATCH_ARCHIVE / path.name))

legacy_workflows = {
    'apply-s16-nak.yml',
    'augment-rough-balance-v1-90k.yml',
    'augment-rough-balance-v1-smoke.yml',
    'augment-rough-balance-v2-smoke.yml',
    'balance-rework-v3-90k.yml',
    'balance-rework-v3-smoke.yml',
    'confirmed-balance-v1-quick.yml',
    'ideas-batch1-smoke.yml',
    'ideas-batch2-smoke.yml',
    'ideas-batch3-smoke.yml',
    'ideas-batch4-smoke.yml',
    'ideas-batch5-smoke.yml',
    'ideas-batch6-smoke.yml',
    'ideas-batch7-smoke.yml',
    'ideas-batch8-smoke.yml',
    'ideas-batch9-smoke.yml',
    'ideas-batch10-smoke.yml',
    'ideas-batch11-smoke.yml',
    'pretest-rough-tuning-smoke.yml',
    'stall-fixes-v4-smoke.yml',
    'stall-fixes-v5-diagnose.yml',
    'stall-fixes-v5-quick.yml',
    'stall-fixes-v8-smoke.yml',
}
workflows_dir = ROOT / '.github' / 'workflows'
for name in legacy_workflows:
    path = workflows_dir / name
    if path.exists():
        shutil.move(str(path), str(WORKFLOW_ARCHIVE / name))

# Active workflows must execute canonical src directly.
step_patterns = [
    re.compile(r'\n\s*- name: Apply current rule stack\n\s*run: bash scripts/apply-v3-stack\.sh\n'),
    re.compile(r'\n\s*- name: Apply Round 30 draw cap\n\s*run: python scripts/apply-simulation-round-cap\.py\n'),
]
for path in workflows_dir.glob('*.yml'):
    text = path.read_text(encoding='utf-8')
    for pattern in step_patterns:
        text = pattern.sub('\n', text)
    lines = []
    for line in text.splitlines():
        if 'scripts/apply-v3-stack.sh' in line:
            continue
        if 'scripts/apply-' in line:
            continue
        if 'scripts/run-balance-rework-v3.py' in line:
            continue
        lines.append(line)
    path.write_text('\n'.join(lines).rstrip() + '\n', encoding='utf-8')

smoke = ROOT / 'scripts' / 'run-s16-p10-smoke.sh'
if smoke.exists():
    text = smoke.read_text(encoding='utf-8')
    text = text.replace('bash scripts/apply-v3-stack.sh\n\n', '')
    text = text.replace('S16 + P10 + v11 smoke PASS', 'Canonical v11 S16 + P10 smoke PASS')
    smoke.write_text(text, encoding='utf-8')

agents = ROOT / 'AGENTS.md'
text = agents.read_text(encoding='utf-8')
old = '''## Augment source of truth

This repository uses a patch stack. Raw files such as `src/lib/augments/catalog.ts` may contain stale pre-patch values.

For the current effective rules, treat the state after:

```bash
bash scripts/apply-v3-stack.sh
```

as canonical.
'''
new = '''## Augment source of truth

`src/` is the canonical source of truth for the current game and simulation behavior.

Do not apply legacy patch scripts before running tests or simulations. Historical patch machinery is preserved under `archive/legacy-patches/` for audit only and must not be used as an execution dependency.
'''
if old not in text:
    raise SystemExit('AGENTS.md source-of-truth block not found')
agents.write_text(text.replace(old, new, 1), encoding='utf-8')

(PATCH_ARCHIVE / 'README.md').write_text('''# Legacy patch archive

These files are the historical patch stack that produced the effective v11 behavior materialized from commit `dd0021d508a24586e55970b2461f3d5fe266e94f`.

They are retained for audit and rollback archaeology only. Current CI, smoke tests, precision runs, and simulations execute canonical `src/` directly.

Do not add new `stall-fixes-v*.py` patches and do not restore these files to the runtime path.
''', encoding='utf-8')

(WORKFLOW_ARCHIVE / 'README.md').write_text('''# Legacy workflow archive

These workflows belong to historical patch-stack experiments. They are outside `.github/workflows/` intentionally so they cannot execute.

Current workflows run against canonical `src/` without applying legacy patch scripts.
''', encoding='utf-8')

# Refuse to commit if active code still depends on source-rewriting patches.
scan_roots = [ROOT / 'AGENTS.md', ROOT / '.github' / 'workflows', ROOT / 'scripts', ROOT / 'src']
violations = []
for scan_root in scan_roots:
    paths = [scan_root] if scan_root.is_file() else [p for p in scan_root.rglob('*') if p.is_file()]
    for path in paths:
        if path.name == 'consolidate-canonical-once.py':
            continue
        try:
            body = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        if 'scripts/apply-v3-stack.sh' in body or re.search(r'python scripts/apply-[^\s]+\.py', body):
            violations.append(str(path))
if violations:
    raise SystemExit('Active legacy patch dependencies remain: ' + ', '.join(sorted(set(violations))))

print('Canonical layout consolidation prepared successfully.')
