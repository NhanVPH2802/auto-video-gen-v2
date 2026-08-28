#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="${1:-/opt/auto-video-gen/base}"
PIPELINE="$BASE_DIR/src/pipeline.ts"
TPL_DIR="$BASE_DIR/src/render/templates"

[[ -f "$PIPELINE" ]] || { echo "Khong tim thay $PIPELINE" >&2; exit 1; }
[[ -f "$TPL_DIR/styles.css" ]] || { echo "Khong tim thay $TPL_DIR/styles.css" >&2; exit 1; }

# Rebuild extra themes from the current stable stylesheet so upgrades remain idempotent.
cp "$TPL_DIR/styles.css" "$TPL_DIR/styles.tech-blue.css"
cat >> "$TPL_DIR/styles.tech-blue.css" <<'CSS'

/* PREVIEW_2_6_2_THEME_TECH_BLUE */
:root { --accent:#26c6ff; --accent-2:#5f8cff; --primary:#26c6ff; --secondary:#5f8cff; }
html, body, #stage, .shell-bg,
.bg.gradient-news-dark, .bg.gradient-outro-purple {
  background: radial-gradient(circle at 75% 14%, rgba(38,198,255,.28), transparent 38%),
              radial-gradient(circle at 15% 78%, rgba(95,140,255,.22), transparent 42%),
              linear-gradient(160deg,#04131f 0%,#063852 55%,#07192b 100%) !important;
}
.layout-outro {
  background: linear-gradient(180deg, rgba(6,56,82,.78) 0%, rgba(4,19,31,.92) 100%) !important;
}
.brand-icon { background:linear-gradient(135deg,#26c6ff,#2563eb) !important; box-shadow:0 4px 28px rgba(38,198,255,.45) !important; }
.brand-tag,.hook-subhead,.stat-value,.callout-tag,.feat-dot,.brand-shell-keyword span,.out-source,.tt-handle { color:#26c6ff !important; }
.feat-title,.cmp-card.color-purple .cmp-value { color:#5f8cff !important; }
.layout-hook::before,.layout-stat-hero::before { background:radial-gradient(circle,rgba(38,198,255,.34) 0%,transparent 66%) !important; }
CSS

cp "$TPL_DIR/styles.css" "$TPL_DIR/styles.ubuntu.css"
cat >> "$TPL_DIR/styles.ubuntu.css" <<'CSS'

/* PREVIEW_2_6_2_THEME_UBUNTU */
:root { --accent:#e95420; --accent-2:#772953; --primary:#e95420; --secondary:#772953; }
html, body, #stage, .shell-bg,
.bg.gradient-news-dark, .bg.gradient-outro-purple {
  background: radial-gradient(circle at 18% 12%, rgba(233,84,32,.30), transparent 38%),
              radial-gradient(circle at 82% 74%, rgba(119,41,83,.38), transparent 44%),
              linear-gradient(160deg,#160b14 0%,#32162d 52%,#130a12 100%) !important;
}
.layout-outro {
  background: linear-gradient(180deg, rgba(119,41,83,.72) 0%, rgba(22,11,20,.94) 100%) !important;
}
.brand-icon { background:linear-gradient(135deg,#e95420,#772953) !important; box-shadow:0 4px 28px rgba(233,84,32,.42) !important; }
.brand-tag,.hook-subhead,.stat-value,.callout-tag,.feat-dot,.brand-shell-keyword span,.out-source,.tt-handle { color:#f47b4b !important; }
.feat-title,.cmp-card.color-purple .cmp-value { color:#e95420 !important; }
.layout-hook::before,.layout-stat-hero::before { background:radial-gradient(circle,rgba(233,84,32,.34) 0%,transparent 66%) !important; }
CSS

python3 - "$PIPELINE" <<'PY'
from pathlib import Path
import re, sys
p=Path(sys.argv[1])
s=p.read_text(encoding='utf-8')

legacy='const themeFile = cfg.videoTheme === "light-pro" ? "styles.light-pro.css" : "styles.css";'
unsafe='const themeFile = cfg.videoTheme === "light-pro" ? "styles.light-pro.css" : cfg.videoTheme === "tech-blue" ? "styles.tech-blue.css" : cfg.videoTheme === "ubuntu" ? "styles.ubuntu.css" : "styles.css";'
safe='const videoTheme = String(process.env.VIDEO_THEME || cfg.videoTheme || "dark-neon");\n  const themeFile = videoTheme === "light-pro" ? "styles.light-pro.css" : videoTheme === "tech-blue" ? "styles.tech-blue.css" : videoTheme === "ubuntu" ? "styles.ubuntu.css" : "styles.css";'
if unsafe in s:
    s=s.replace(unsafe,safe,1)
elif legacy in s:
    s=s.replace(legacy,safe,1)
elif 'const videoTheme = String(process.env.VIDEO_THEME' not in s:
    s,n=re.subn(r'const\s+themeFile\s*=\s*cfg\.videoTheme\s*===\s*["\']light-pro["\']\s*\?\s*["\']styles\.light-pro\.css["\']\s*:\s*["\']styles\.css["\'];',safe,s,count=1)
    if n!=1: raise SystemExit('Khong tim thay themeFile trong pipeline.ts')

marker='PREVIEW_2_6_VIDEO_APPEARANCE'
# Upgrade the runtime background rules from 2.6.0/2.6.1 even when the marker already exists.
old_gradient='backgroundRule = `html,body{background:${gradients[backgroundPreset] || gradients.aurora} !important;}`;'
new_gradient='const gradient = gradients[backgroundPreset] || gradients.aurora;\n      backgroundRule = `.shell-bg,.bg.gradient-news-dark,.bg.gradient-outro-purple,.layout-outro{background:${gradient} !important;}`;'
if old_gradient in s:
    s=s.replace(old_gradient,new_gradient,1)
old_image='backgroundRule = `body{position:relative;isolation:isolate;background:#07111f !important;}body::before{content:"";position:fixed;inset:-${blurPx + 4}px;background:url("./${assetName}") center/cover no-repeat;filter:blur(${blurPx}px);z-index:-3;}body::after{content:"";position:fixed;inset:0;background:rgba(0,0,0,${(overlayPercent/100).toFixed(2)});z-index:-2;pointer-events:none;}`;'
new_image='const opacity = (overlayPercent/100).toFixed(2);\n      backgroundRule = `.shell-bg{background:url("./${assetName}") center/cover no-repeat !important;filter:blur(${blurPx}px) scale(${blurPx ? 1.035 : 1});}.bg.gradient-news-dark,.bg.gradient-outro-purple,.layout-outro{background:rgba(0,0,0,${opacity}) !important;}`;'
if old_image in s:
    s=s.replace(old_image,new_image,1)

# Existing 2.6.0/2.6.1 blocks did not log the effective appearance. Add one line for diagnostics.
append_line='await (await import("node:fs/promises")).appendFile(join(outputDir, "styles.css"), extraCss, "utf8");'
if append_line in s and 'Video appearance: theme=${videoTheme}' not in s:
    s=s.replace(append_line, append_line+'\n    log.info(`  Video appearance: theme=${videoTheme}; background=${backgroundType}${backgroundType === "gradient" ? `/${backgroundPreset}` : ""}`);',1)

if marker not in s:
    patterns=[
      r'await\s+copyFile\(\s*join\(TPL_DIR,\s*themeFile\)\s*,\s*outputStylePath\s*\)\s*;',
      r'await\s+copyFile\(\s*join\(TPL_DIR,\s*themeFile\)\s*,\s*join\(outputDir,\s*["\']styles\.css["\']\)\s*\)\s*;'
    ]
    anchor=None
    for pattern in patterns:
      anchor=re.search(pattern,s)
      if anchor: break
    if not anchor: anchor=re.search(r'await\s+copyFile\([^;]*themeFile[^;]*\)\s*;',s)
    if not anchor: raise SystemExit('Khong tim thay lenh copy theme stylesheet trong pipeline.ts')

    code=r'''

  // PREVIEW_2_6_VIDEO_APPEARANCE: per-project theme/background.
  {
    const backgroundType = String(process.env.VIDEO_BACKGROUND_TYPE || "theme");
    const backgroundPreset = String(process.env.VIDEO_BACKGROUND_PRESET || "aurora");
    const backgroundPath = String(process.env.VIDEO_BACKGROUND_PATH || "").trim();
    const overlayPercent = Math.max(0, Math.min(80, Number(process.env.VIDEO_BACKGROUND_OVERLAY || "35") || 35));
    const blurPx = Math.max(0, Math.min(20, Number(process.env.VIDEO_BACKGROUND_BLUR || "0") || 0));

    const gradients: Record<string, string> = {
      aurora: "radial-gradient(circle at 20% 20%, #304ffe55, transparent 38%), radial-gradient(circle at 80% 72%, #00e5ff44, transparent 42%), linear-gradient(160deg, #07111f, #10233d)",
      ocean: "radial-gradient(circle at 75% 18%, #00d4ff55, transparent 40%), radial-gradient(circle at 12% 78%, #2563eb44, transparent 42%), linear-gradient(160deg, #02131f, #064665 58%, #062238)",
      sunset: "radial-gradient(circle at 18% 16%, #ff6d0055, transparent 38%), radial-gradient(circle at 82% 72%, #aa00ff44, transparent 42%), linear-gradient(160deg, #211020, #3d1c3c)",
      graphite: "radial-gradient(circle at 50% 15%, #607d8b44, transparent 38%), linear-gradient(160deg, #101418, #252c32)"
    };

    let backgroundRule = "";
    if (backgroundType === "gradient") {
      const gradient = gradients[backgroundPreset] || gradients.aurora;
      backgroundRule = `.shell-bg,.bg.gradient-news-dark,.bg.gradient-outro-purple,.layout-outro{background:${gradient} !important;}`;
    } else if (backgroundType === "image" && backgroundPath && existsSync(backgroundPath)) {
      const ext = (backgroundPath.match(/\.[A-Za-z0-9]+$/)?.[0] || ".png").toLowerCase();
      const assetName = `video-background${ext}`;
      await copyFile(backgroundPath, join(outputDir, assetName));
      const opacity = (overlayPercent/100).toFixed(2);
      backgroundRule = `.shell-bg{background:url("./${assetName}") center/cover no-repeat !important;filter:blur(${blurPx}px) scale(${blurPx ? 1.035 : 1});}.bg.gradient-news-dark,.bg.gradient-outro-purple,.layout-outro{background:rgba(0,0,0,${opacity}) !important;}`;
    }

    const extraCss = `\n/* PREVIEW_2_6_VIDEO_APPEARANCE_RUNTIME */\n${backgroundRule}\n`;
    await (await import("node:fs/promises")).appendFile(join(outputDir, "styles.css"), extraCss, "utf8");
    log.info(`  Video appearance: theme=${videoTheme}; background=${backgroundType}${backgroundType === "gradient" ? `/${backgroundPreset}` : ""}`);
  }
'''
    s=s[:anchor.end()]+code+s[anchor.end():]

p.write_text(s,encoding='utf-8')
print('Da cap nhat theme/background renderer trong pipeline.ts')
PY

cd "$BASE_DIR"
npx tsc --noEmit

echo "Da cai video appearance renderer Preview 2.6.2 va kiem tra TypeScript thanh cong."
