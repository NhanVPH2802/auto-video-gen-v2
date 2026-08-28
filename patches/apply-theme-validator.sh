#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/opt/auto-video-gen/base}"
CONFIG="$BASE_DIR/src/config.ts"

[[ -f "$CONFIG" ]] || { echo "Khong tim thay $CONFIG" >&2; exit 1; }

python3 - "$CONFIG" <<'PY'
from pathlib import Path
import re, sys

p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
original = s

# 1) Extend the VideoTheme union used by older base sources.
# Handles both `export type VideoTheme = ...` and `type VideoTheme = ...`.
pattern_type = re.compile(
    r'(?m)^(?P<prefix>\s*(?:export\s+)?type\s+VideoTheme\s*=\s*)'
    r'(?P<body>[^;]+)(?P<suffix>;\s*)$'
)

m = pattern_type.search(s)
if m:
    body = m.group("body")
    values = re.findall(r'["\']([^"\']+)["\']', body)
    wanted = ["dark-neon", "light-pro", "tech-blue", "ubuntu"]
    if all(v in values for v in ["dark-neon", "light-pro"]):
        merged = []
        for v in values + wanted:
            if v not in merged:
                merged.append(v)
        quote = '"' if '"' in body else "'"
        replacement = m.group("prefix") + " | ".join(f"{quote}{v}{quote}" for v in merged) + m.group("suffix")
        s = s[:m.start()] + replacement + s[m.end():]

# 2) Replace the old two-theme runtime validator.
# This intentionally targets the exact semantic form while tolerating spacing,
# quote style and multiline error strings.
validator = re.compile(
    r'if\s*\(\s*videoTheme\s*!==\s*["\']dark-neon["\']\s*&&\s*'
    r'videoTheme\s*!==\s*["\']light-pro["\']\s*\)\s*\{\s*'
    r'throw\s+new\s+Error\s*\(.*?\)\s*;\s*\}',
    re.S,
)
replacement = '''if (!["dark-neon", "light-pro", "tech-blue", "ubuntu"].includes(videoTheme)) {
    throw new Error(
      `VIDEO_THEME khong hop le: "${videoTheme}". Ho tro: dark-neon, light-pro, tech-blue, ubuntu`,
    );
  }'''
s, n = validator.subn(replacement, s, count=1)

# Fallback for sources where the validator is formatted unusually: update the
# condition and old message independently.
if n == 0:
    old_condition = re.compile(
        r'videoTheme\s*!==\s*["\']dark-neon["\']\s*&&\s*videoTheme\s*!==\s*["\']light-pro["\']'
    )
    s, cond_n = old_condition.subn(
        '!["dark-neon", "light-pro", "tech-blue", "ubuntu"].includes(videoTheme)',
        s,
        count=1,
    )
    old_message = re.compile(
        r'VIDEO_THEME must be ["\']dark-neon["\'] or ["\']light-pro["\'], got ["\']?\$\{videoTheme\}["\']?'
    )
    s = old_message.sub(
        'VIDEO_THEME khong hop le: "${videoTheme}". Ho tro: dark-neon, light-pro, tech-blue, ubuntu',
        s,
        count=1,
    )

# Verification: both new theme names must be present in config.ts and the old
# two-theme-only condition must be gone.
if "tech-blue" not in s or "ubuntu" not in s:
    raise SystemExit("Khong the mo rong VideoTheme trong src/config.ts")
if re.search(r'videoTheme\s*!==\s*["\']dark-neon["\']\s*&&\s*videoTheme\s*!==\s*["\']light-pro["\']', s):
    raise SystemExit("Validator VIDEO_THEME cu van con trong src/config.ts")

if s != original:
    p.write_text(s, encoding="utf-8")
    print("Da mo rong VIDEO_THEME: dark-neon / light-pro / tech-blue / ubuntu")
else:
    print("VIDEO_THEME da ho tro day du 4 theme; khong can sua them")
PY

cd "$BASE_DIR"
npx tsc --noEmit

echo "Da kiem tra TypeScript sau khi cap nhat VIDEO_THEME validator."
