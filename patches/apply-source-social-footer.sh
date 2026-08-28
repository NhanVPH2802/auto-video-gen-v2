#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/opt/auto-video-gen/base}"
RENDER_DIR="$BASE_DIR/src/render"

[[ -d "$RENDER_DIR" ]] || { echo "Khong tim thay $RENDER_DIR" >&2; exit 1; }

python3 - "$RENDER_DIR" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
changed=[]
for p in root.rglob('*'):
    if not p.is_file() or p.suffix.lower() not in {'.ts','.html','.tmpl','.css'}:
        continue
    try:
        s=p.read_text(encoding='utf-8')
    except Exception:
        continue
    original=s
    # Outro previously rendered "Nguồn: <source>". Preview 2.5.3 reuses the
    # source field as a social footer, so remove only the visible Vietnamese label.
    if 'Nguồn:' in s:
        s=s.replace('Nguồn:', '')
    # Older base builds validate outro.templateData.source at 40 chars. The
    # social footer can contain Facebook + YouTube + TikTok, so raise only
    # the source field limit while keeping the rest of the schema unchanged.
    if p.name == 'script-schema.ts' and 'source' in s and '.max(' in s:
        import re
        s = re.sub(r'(source\s*:\s*z\.string\(\)(?:\.[A-Za-z]+\([^)]*\))*?\.max\()\d+(\))', r'\g<1>120\2', s)
    # Preserve line breaks in the social footer while leaving normal one-line
    # source chips unchanged (they contain no newline characters).
    if p.suffix.lower()=='.css' and 'PREVIEW_2_5_3_SOCIAL_SOURCE' not in s:
        s += '''\n\n/* PREVIEW_2_5_3_SOCIAL_SOURCE: allow multiline outro social footer. */\n[class*="source"] { white-space: pre-line; }\n'''
    if s != original:
        p.write_text(s,encoding='utf-8')
        changed.append(str(p))
print('Da cap nhat renderer source/social footer:')
for item in changed:
    print(' -', item)
if not changed:
    print('WARN: Khong tim thay literal Nguon/CSS can sua; metadata source van duoc cap nhat.')
PY

cd "$BASE_DIR"
npx tsc --noEmit

echo "Da kiem tra TypeScript renderer thanh cong."
