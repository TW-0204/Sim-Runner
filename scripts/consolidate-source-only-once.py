from pathlib import Path
import re
import shutil

ROOT = Path('.')
PATCH_ARCHIVE = ROOT / 'archive' / 'legacy-patches'
PATCH_ARCHIVE.mkdir(parents=True, exist_ok=True)

for path in sorted((ROOT / 'scripts').glob('apply-*.py')):
    shutil.move(str(path), str(PATCH_ARCHIVE / path.name))
for name in ['apply-v3-stack.sh', 'run-balance-rework-v3.py']:
    path = ROOT / 'scripts' / name
    if path.exists():
        shutil.move(str(path), str(PATCH_ARCHIVE / path.name))

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

They are retained for audit and rollback archaeology only. Current smoke tests, precision runs, and simulations execute canonical `src/` directly.

Do not add new `stall-fixes-v*.py` patches and do not restore these files to the runtime path.
''', encoding='utf-8')

violations = []
for scan_root in [ROOT / 'AGENTS.md', ROOT / 'scripts', ROOT / 'src']:
    paths = [scan_root] if scan_root.is_file() else [p for p in scan_root.rglob('*') if p.is_file()]
    for path in paths:
        if path.name in {'consolidate-source-only-once.py', 'consolidate-canonical-once.py', 'refactor-critical-force-once.py'}:
            continue
        try:
            body = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        if 'scripts/apply-v3-stack.sh' in body or re.search(r'python scripts/apply-[^\s]+\.py', body):
            violations.append(str(path))
if violations:
    raise SystemExit('Active source patch dependencies remain: ' + ', '.join(sorted(set(violations))))

print('Source-only canonical consolidation prepared successfully.')
