#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/auto-video-gen}"
DASHBOARD="$APP_ROOT/dashboard"
SERVICE="${SERVICE_NAME:-auto-video-gen}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="$APP_ROOT/backups/v2-preview2.7.0-$STAMP"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)/app"
RUN_USER="$(systemctl show "$SERVICE" -p User --value 2>/dev/null || true)"
RUN_GROUP="$(systemctl show "$SERVICE" -p Group --value 2>/dev/null || true)"
RUN_USER="${RUN_USER:-autovideo}"
RUN_GROUP="${RUN_GROUP:-$RUN_USER}"

cleanup() {
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "Cai dat gap loi. Dang rollback Preview 2.7.0..." >&2
    if [ -d "$BACKUP/dashboard" ]; then
      rm -rf "$DASHBOARD"
      mkdir -p "$DASHBOARD"
      cp -a "$BACKUP/dashboard/." "$DASHBOARD/" || true
    fi
    if [ -f "$BACKUP/base-src/pipeline.ts" ]; then
      cp -a "$BACKUP/base-src/pipeline.ts" "$APP_ROOT/base/src/pipeline.ts" || true
    fi
    if [ -f "$BACKUP/base-src/config.ts" ]; then
      cp -a "$BACKUP/base-src/config.ts" "$APP_ROOT/base/src/config.ts" || true
    fi
    if [ -f "$BACKUP/base-src/tts/vieneu-client.ts" ]; then
      cp -a "$BACKUP/base-src/tts/vieneu-client.ts" "$APP_ROOT/base/src/tts/vieneu-client.ts" || true
    fi
    if [ -d "$BACKUP/base-src/render" ]; then
      rm -rf "$APP_ROOT/base/src/render"
      cp -a "$BACKUP/base-src/render" "$APP_ROOT/base/src/render" || true
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl start "$SERVICE" >/dev/null 2>&1 || true
    echo "Da rollback tu: $BACKUP" >&2
  fi
  exit "$code"
}
trap cleanup EXIT

systemctl stop "$SERVICE" >/dev/null 2>&1 || true

mkdir -p "$BACKUP" \
  "$APP_ROOT/data/uploads" \
  "$APP_ROOT/downloads" \
  "$APP_ROOT/output" \
  "$APP_ROOT/base/output" \
  "$APP_ROOT/branding"

if [ -d "$DASHBOARD" ]; then
  cp -a "$DASHBOARD" "$BACKUP/dashboard"
fi

ENV_TMP=""
if [ -f "$DASHBOARD/.env.local" ]; then
  ENV_TMP="$(mktemp)"
  cp "$DASHBOARD/.env.local" "$ENV_TMP"
fi

rm -rf "$DASHBOARD"
mkdir -p "$DASHBOARD"
cp -a "$SOURCE_DIR/." "$DASHBOARD/"

if [ -n "$ENV_TMP" ] && [ -f "$ENV_TMP" ]; then
  cp "$ENV_TMP" "$DASHBOARD/.env.local"
  rm -f "$ENV_TMP"
elif [ ! -f "$DASHBOARD/.env.local" ]; then
  cp "$DASHBOARD/.env.example" "$DASHBOARD/.env.local"
fi

# Preview 2.7.0: backup and patch base VieNeu-TTS engine for stable speech.
if [ -d "$APP_ROOT/base/src/tts" ] && [ -f "$APP_ROOT/base/src/pipeline.ts" ]; then
  mkdir -p "$BACKUP/base-src/tts"
  cp -a "$APP_ROOT/base/src/pipeline.ts" "$BACKUP/base-src/pipeline.ts"
  [ -f "$APP_ROOT/base/src/config.ts" ] && cp -a "$APP_ROOT/base/src/config.ts" "$BACKUP/base-src/config.ts" || true
  [ -f "$APP_ROOT/base/src/tts/vieneu-client.ts" ] && cp -a "$APP_ROOT/base/src/tts/vieneu-client.ts" "$BACKUP/base-src/tts/vieneu-client.ts" || true
  [ -d "$APP_ROOT/base/src/render" ] && cp -a "$APP_ROOT/base/src/render" "$BACKUP/base-src/render" || true
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-tts-stability.sh" "$APP_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-source-social-footer.sh" "$APP_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-theme-validator.sh" "$APP_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-video-appearance.sh" "$APP_ROOT/base"
  bash "$(cd "$(dirname "$0")" && pwd)/patches/apply-render-fixes.sh" "$APP_ROOT/base"
else
  echo "Khong tim thay base/src de ap dung TTS stability patch." >&2
  exit 1
fi

cd "$DASHBOARD"
npm install --omit=dev --no-audit --no-fund
npm run check

# Source is read-only for the service; runtime folders belong to service user.
chown -R root:root "$DASHBOARD" 2>/dev/null || true
for dir in \
  "$APP_ROOT/data" \
  "$APP_ROOT/downloads" \
  "$APP_ROOT/output" \
  "$APP_ROOT/base/output" \
  "$APP_ROOT/branding"
do
  chown -R "$RUN_USER:$RUN_GROUP" "$dir" 2>/dev/null || true
  chmod -R u+rwX,g+rwX "$dir" 2>/dev/null || true
done

SERVICE_FILE="/etc/systemd/system/$SERVICE.service"
if [ -f "$SERVICE_FILE" ] && grep -q '^EnvironmentFile=[^-]' "$SERVICE_FILE"; then
  sed -i 's#^EnvironmentFile=#EnvironmentFile=-#' "$SERVICE_FILE" || true
  systemctl daemon-reload
fi

systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE"

trap - EXIT
cat <<MSG

Da cai Auto Video Gen 2.0 Preview 2.7.0.
- Backup: $BACKUP
- Sua loi updateTtsSource is not defined.
- Voice list duoc load ngay sau khi Save/Test ket noi.
- Form Nguon tao kich ban chi con AI + Model.
- Connection Manager: Ten/URL/API dong nhat kieu khung; Ten ket noi moi de trong.
- Local AI va OpenAI-compatible la 2 Adapter rieng; ca hai ho tro API chuan OpenAI.
- Gemini chi nap model ho tro generateContent va uu tien model hien hanh.
- Tac vu loi co nut Sua du an de nap lai thong tin vao form, sua va tao lai kich ban tren cung job.
- AI Adapter mo rong: GitHub Models, Gemini, Claude/Anthropic, OpenAI, Local AI, OpenAI-compatible, Custom AI REST.
- Custom AI REST co endpoint/mapping de them server AI moi ma khong can hard-code nha cung cap.
- Voice Adapter mo rong: VieNeu-compatible, LucyLab, OpenAI-compatible TTS, Custom Voice REST.
- Custom Voice REST co Voices endpoint/TTS endpoint/mapping de them OmniVoice hoac server moi ma khong can hard-code ten nha cung cap.
- Voice bridge noi bo giup base pipeline tiep tuc dung VieNeu-compatible contract ma khong can sua base engine.
- Loi AI/Voice duoc hien thi truc quan: API chua ket noi, key sai, model 404, rate limit 429, model qua tai 503, Voice Server mat ket noi/tao giong that bai.
- VieNeu-TTS 2.6.0: tự chia lời đọc thành chunk ngắn, retry lỗi tạm thời và tự tạo lại chunk audio ngắn bất thường.
- Audio chỉ được ghi thành scene MP3 sau khi đã kiểm tra hợp lệ; tránh reuse file dở/thiếu lời.
- Scene đã tạo thành công vẫn được cache; khi một scene lỗi chỉ xử lý lại phần cần thiết.
- Ghép chunk có khoảng nghỉ ngắn để lời thoại tự nhiên hơn; thời lượng scene vẫn lấy từ audio thực tế.
- AI tu retry loi tam thoi 429/5xx/timeout toi da 4 lan voi backoff.
- Them Thong tin kenh / Branding: Ten trang, YouTube, TikTok, Facebook; @TikTok tu dong lay tu URL.
- Ten trang va @TikTok duoc truyen vao template render theo tung du an.
- Branding 2.6.0 duoc luu ben vung trong data/branding.json va tu dong nap lai cho du an moi.
- Nguon da duyet trong frame Outro duoc dung lam nhan nguon tren toan bo video, khong con hien direct-text/local-input.
- Outro thay dong Nguon bang Facebook/YouTube/TikTok lay tu Branding; ho tro hien thi nhieu dong.
- Logo/avatar moi duoc luu version trong thu muc branding; du an cu giu dung snapshot da su dung, khong bi doi theo mac dinh moi.
- Khi sua thong tin kenh hoac upload logo/avatar moi, gia tri moi tro thanh mac dinh cho cac du an tiep theo.
- Neu nang cap tu 2.5.1 ma chua co branding.json, he thong tu lay Branding tu du an gan nhat va migrate logo/avatar cu.
- Bao ve .env.local khi cap nhat; EnvironmentFile systemd duoc dat optional de tranh service chet neu file bi thieu.
- Giao dien video 2.6: 4 theme Dark Neon / Light Pro / Tech Blue / Ubuntu.
- Hotfix 2.7.0: mo rong VideoTheme union va runtime validator cua base config.ts de Tech Blue/Ubuntu render duoc, khong con loi VIDEO_THEME chi chap nhan dark-neon/light-pro.
- Fix 2.7.0: Tech Blue/Ubuntu va Gradient ap truc tiep len shell-bg/bg/layout-outro, khong con bi nen purple cu che mat.
- Fix 2.7.0: Follow card can giua bang left/right + auto margin, khong con phu thuoc translateX/xPercent khi GSAP animate; nut Follow nam tron trong khung.
- Fix 2.7.0: VieNeu trim silence dau/cuoi moi chunk, loai cache audio qua dai bat thuong de tranh frame dung im/khong co tieng lau truoc frame ke.
- Background: theo theme, gradient preset hoac upload anh rieng; co overlay va blur.
- Chuyen canh nhe: None / Fade / Slide Left / Zoom; tuy chon thoi gian 0.25-0.8s.
- Motion noi dung: Auto / Static / Fade Up / Zoom In.
- Noi dung dan vao ha nguong toi thieu tu 80 xuong 20 ky tu de AI co the phat trien chu de ngan.
- Duyet kich ban 2.7.0: 5 nut Tao kich ban khac / Sua thiet lap / Khoi phuc ban truoc / Luu nhap / Chot kich ban nam cung mot hang sticky.
- Tao kich ban khac giu nguyen toan bo thiet lap, chi goi lai AI va luu script.previous.json.
- Sua thiet lap nap lai cung job vao form de doi thoi luong, AI/model, phong cach, voice, theme va tao lai.
- Khoi phuc ban truoc ho tro doi qua lai 1 cap script hien tai/previous; reconfigure van giu ban rollback.
- Dong bo validation Dan noi dung 20 ky tu o ca server va input-reader.
- Danh sach du an mac dinh 5 du an/trang; co the chon 5/10/20/Tat ca va chuyen trang de trang khong keo dai khi co nhieu du an.
- Nut Xoa hien cho moi du an khong dang chay/khong trong hang doi; xoa ca kich ban, log, video va file rieng cua du an.
- Runtime permissions: $RUN_USER:$RUN_GROUP.

Dich vu: active (running)
MSG
