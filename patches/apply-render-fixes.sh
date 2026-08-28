#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/opt/auto-video-gen/base}"
TPL_DIR="$BASE_DIR/src/render/templates"
ANIM="$TPL_DIR/animations.js"

[[ -f "$ANIM" ]] || { echo "Khong tim thay $ANIM" >&2; exit 1; }

python3 - "$ANIM" "$TPL_DIR" <<'PY'
from pathlib import Path
import sys,re
anim=Path(sys.argv[1]); tpl=Path(sys.argv[2])
s=anim.read_text(encoding='utf-8')
# Remove old xPercent centering patches. Preview 2.7 centers using left/right + auto margins,
# so GSAP can own transform completely without pushing the card off-screen.
s=re.sub(r'\s*// PREVIEW_2_6_2_TT_CARD_CENTER:[^\n]*\n\s*gsap\.set\(ttCard,\s*\{\s*xPercent:\s*-50\s*\}\);?', '', s)
s=re.sub(r'\s*gsap\.set\(ttCard,\s*\{\s*xPercent:\s*-50\s*\}\);?', '', s)
if 'PREVIEW_2_7_TT_CARD_CENTER' not in s:
    m=re.search(r'(if\s*\(ttCard\)\s*\{)',s)
    if not m:
        raise SystemExit('Khong tim thay block ttCard trong animations.js')
    s=s[:m.end()]+'''\n      // PREVIEW_2_7_TT_CARD_CENTER: horizontal centering is handled by CSS auto margins; GSAP only animates Y/scale.''' + s[m.end():]
anim.write_text(s,encoding='utf-8')

block = '''\n\n/* PREVIEW_2_7_TT_CARD_SAFE_AREA */
.tt-card {
  left: 0 !important;
  right: 0 !important;
  margin-left: auto !important;
  margin-right: auto !important;
  width: min(840px, calc(100% - 120px)) !important;
  max-width: none !important;
  box-sizing: border-box !important;
  transform-origin: center center !important;
  overflow: hidden !important;
}
.tt-profile-info {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  max-width: none !important;
}
.tt-display-name {
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  overflow-wrap: normal !important;
}
.tt-follow-btn {
  flex: 0 0 230px !important;
  width: 230px !important;
  min-width: 230px !important;
  max-width: 230px !important;
  padding-left: 28px !important;
  padding-right: 28px !important;
  justify-content: center !important;
  box-sizing: border-box !important;
}
'''
for p in tpl.glob('styles*.css'):
    css=p.read_text(encoding='utf-8')
    original=css
    # Strip earlier preview blocks to avoid competing rules.
    css=re.sub(r'\n?/\* PREVIEW_2_6_2_TT_CARD_SAFE_AREA \*/.*?(?=\n/\*|\Z)', '\n', css, flags=re.S)
    css=re.sub(r'\n?/\* PREVIEW_2_6_3_TT_CARD_SAFE_AREA \*/.*?(?=\n/\*|\Z)', '\n', css, flags=re.S)
    css=re.sub(r'\n?/\* PREVIEW_2_7_TT_CARD_SAFE_AREA \*/.*?(?=\n/\*|\Z)', '\n', css, flags=re.S)
    # Remove transform-based horizontal centering from initial CSS state.
    css=css.replace('translate(-50%, 300px)', 'translateY(300px)')
    css=css.replace('translateX(-50%) translateY(300px)', 'translateY(300px)')
    css=css.replace('translateX(-50%)', 'none')
    css += block
    if css != original:
        p.write_text(css,encoding='utf-8')
        print('Da can giua follow card va gioi han safe-area:', p.name)
PY

node --check "$ANIM"
cd "$BASE_DIR"
npx tsc --noEmit

echo "Da fix follow card bang CSS auto-margin, khong con phu thuoc translateX/xPercent."
