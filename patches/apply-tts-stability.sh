#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/opt/auto-video-gen/base}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPELINE="$BASE_DIR/src/pipeline.ts"
VIENEU_CLIENT="$BASE_DIR/src/tts/vieneu-client.ts"

[[ -f "$PIPELINE" ]] || { echo "Khong tim thay $PIPELINE" >&2; exit 1; }
[[ -f "$BASE_DIR/src/tts/tts-client.ts" ]] || { echo "Khong tim thay tts-client.ts" >&2; exit 1; }

cp "$SCRIPT_DIR/vieneu-client.ts" "$VIENEU_CLIENT"

python3 - "$PIPELINE" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
s = p.read_text(encoding='utf-8')

# Add rm() to fs/promises import so suspicious cached audio can be removed.
m = re.search(r'import\s*\{([^}]*)\}\s*from\s*["\']node:fs/promises["\'];', s)
if not m:
    raise SystemExit('Khong tim thay import node:fs/promises trong pipeline.ts')
items = [x.strip() for x in m.group(1).split(',') if x.strip()]
if 'rm' not in items:
    items.append('rm')
    replacement = 'import { ' + ', '.join(items) + ' } from "node:fs/promises";'
    s = s[:m.start()] + replacement + s[m.end():]

marker = 'PREVIEW_2_5_1_REUSE_AUDIO_GUARD'
if marker not in s:
    helper = '''\n// PREVIEW_2_5_1_REUSE_AUDIO_GUARD: do not reuse truncated/corrupted TTS files.\nfunction ttsWordCount(text: string): number {\n  return String(text || "").trim().split(/\\s+/).filter(Boolean).length;\n}\nfunction ttsMinReusableDurationSec(text: string): number {\n  const words = ttsWordCount(text);\n  return words ? Math.max(0.65, words / 5.5) : 0;\n}\nfunction ttsMaxReusableDurationSec(text: string): number {\n  const words = ttsWordCount(text);\n  return words ? Math.max(6, words / 1.35 + 4) : Number.POSITIVE_INFINITY;\n}\n\n'''
    const_anchor = re.search(r'const\s+SCENE_GAP_SEC\s*=.*?;\s*', s)
    if not const_anchor:
        raise SystemExit('Khong tim thay SCENE_GAP_SEC de chen helper')
    pos = const_anchor.end()
    s = s[:pos] + helper + s[pos:]
elif 'function ttsMaxReusableDurationSec' not in s:
    # Upgrade an existing 2.5.1/2.6.1 minimum-only reuse guard.
    min_fn = re.search(
        r'function\s+ttsMinReusableDurationSec\(text:\s*string\):\s*number\s*\{.*?\n\}',
        s, re.S
    )
    if not min_fn:
        raise SystemExit('Co reuse guard cu nhung khong tim thay ttsMinReusableDurationSec')
    helper = '''\nfunction ttsMaxReusableDurationSec(text: string): number {\n  const words = ttsWordCount(text);\n  return words ? Math.max(6, words / 1.35 + 4) : Number.POSITIVE_INFINITY;\n}\n'''
    s = s[:min_fn.end()] + helper + s[min_fn.end():]

# Original upstream idempotent reuse block.
pattern = re.compile(
    r'''\s*if\s*\(existsSync\(out\)\)\s*\{\s*'''
    r'''const\s+dur\s*=\s*await\s+getDurationSec\(out\);\s*'''
    r'''log\.info\(`\s*scene\s+\$\{scene\.id\}:\s*REUSE\s+existing\s+mp3\s*\(\$\{dur\.toFixed\(2\)\}s\).*?`\);\s*'''
    r'''return\s*\{\s*id:\s*scene\.id,\s*path:\s*out,\s*durationSec:\s*dur\s*\};\s*\}''',
    re.S,
)
replacement = '''\n      if (existsSync(out)) {\n        try {\n          const dur = await getDurationSec(out);\n          const minimum = ttsMinReusableDurationSec(scene.voiceText);\n          const maximum = ttsMaxReusableDurationSec(scene.voiceText);\n          if (dur + 0.05 >= minimum && dur <= maximum) {\n            log.info(`  scene ${scene.id}: REUSE existing mp3 (${dur.toFixed(2)}s) — delete to force re-TTS`);\n            return { id: scene.id, path: out, durationSec: dur };\n          }\n          const reason = dur + 0.05 < minimum\n            ? `quá ngắn (min ${minimum.toFixed(2)}s)`\n            : `quá dài (max ${maximum.toFixed(2)}s; nghi có khoảng lặng)`;\n          log.warn(`  scene ${scene.id}: cached audio ${dur.toFixed(2)}s cho ${ttsWordCount(scene.voiceText)} từ ${reason} → tạo lại`);\n        } catch (error) {\n          log.warn(`  scene ${scene.id}: cached audio lỗi/không đọc được → tạo lại`);\n        }\n        await rm(out, { force: true });\n      }'''

s2, count = pattern.subn(replacement, s, count=1)
if count == 1:
    s = s2
else:
    # Upgrade the already-patched minimum-only guard from Preview 2.5.1/2.6.1.
    old_cond = 'if (dur + 0.05 >= minimum) {'
    if old_cond in s and 'const maximum = ttsMaxReusableDurationSec(scene.voiceText);' not in s:
        s=s.replace(
            'const minimum = ttsMinReusableDurationSec(scene.voiceText);\n          '+old_cond,
            'const minimum = ttsMinReusableDurationSec(scene.voiceText);\n          const maximum = ttsMaxReusableDurationSec(scene.voiceText);\n          if (dur + 0.05 >= minimum && dur <= maximum) {',
            1,
        )
        old_warn = 'log.warn(`  scene ${scene.id}: cached audio ${dur.toFixed(2)}s quá ngắn cho ${ttsWordCount(scene.voiceText)} từ (min ${minimum.toFixed(2)}s) → tạo lại`);'
        if old_warn in s:
            new_warn = '''const reason = dur + 0.05 < minimum\n            ? `quá ngắn (min ${minimum.toFixed(2)}s)`\n            : `quá dài (max ${maximum.toFixed(2)}s; nghi có khoảng lặng)`;\n          log.warn(`  scene ${scene.id}: cached audio ${dur.toFixed(2)}s cho ${ttsWordCount(scene.voiceText)} từ ${reason} → tạo lại`);'''
            s=s.replace(old_warn,new_warn,1)
    elif 'const maximum = ttsMaxReusableDurationSec(scene.voiceText);' not in s:
        print('WARN: Khong tim thay block REUSE mp3 de nang cap; VieNeu client moi van trim silence cho audio moi.')

p.write_text(s, encoding='utf-8')
print('Da ap dung VieNeu trim-silence/retry/audio validation va cache min-max guard.')
PY

cd "$BASE_DIR"
npx tsc --noEmit

echo "Da kiem tra TypeScript thanh cong."
