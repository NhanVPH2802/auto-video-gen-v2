function clean(value) {
  return String(value ?? "").trim();
}

function statusFrom(error) {
  const direct = Number(error?.httpStatus || error?.statusCode || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = clean(error?.message).match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : 0;
}

function includesAny(text, values) {
  const source = text.toLocaleLowerCase("vi");
  return values.some((item) => source.includes(String(item).toLocaleLowerCase("vi")));
}

export function presentError(error, context = {}) {
  const raw = clean(error?.message || error || "Lỗi không xác định");
  const status = statusFrom(error);
  const phase = clean(context.phase);
  const provider = clean(context.providerLabel || context.provider || "AI");
  const model = clean(context.model);
  const voiceServer = clean(context.voiceServer || context.ttsProviderLabel || "Voice Server");
  const voiceName = clean(context.voiceName);
  const lower = raw.toLocaleLowerCase("vi");

  const result = {
    title: phase === "render" ? "Render gặp lỗi" : "Tạo kịch bản gặp lỗi",
    message: raw,
    hint: "Mở Chi tiết / Log để xem thông tin kỹ thuật.",
    code: status ? `HTTP_${status}` : "APP_ERROR",
    status,
  };

  if ((phase !== "render" || includesAny(raw, ["nguồn ai", "provider", "model"]))
    && includesAny(raw, ["chưa được cấu hình", "không có nguồn ai", "chưa có nguồn ai", "nguồn ai đã bị xóa"])) {
    return {
      ...result,
      title: "Chưa kết nối API AI",
      message: "Chưa có nguồn AI khả dụng để tạo kịch bản.",
      hint: "Mở Set API → AI, thêm kết nối, nhập API Key/URL và bấm Test kết nối.",
      code: "AI_NOT_CONFIGURED",
    };
  }

  if (includesAny(raw, ["chưa nhập api key", "thiếu api key"]) && phase !== "render") {
    return {
      ...result,
      title: "Thiếu API Key AI",
      message: `${provider} chưa có API Key hợp lệ.`,
      hint: "Mở Set API → AI, cập nhật API Key rồi Test kết nối lại.",
      code: "AI_API_KEY_MISSING",
    };
  }

  if (status === 401 || includesAny(raw, ["unauthorized", "invalid api key", "api key không hợp lệ", "api key khong hop le"])) {
    if (phase === "render" || includesAny(raw, ["voice", "vieneu", "lucylab", "tts"])) {
      return {
        ...result,
        title: "API Voice Server không hợp lệ",
        message: `${voiceServer} từ chối xác thực${voiceName ? ` cho giọng ${voiceName}` : ""}.`,
        hint: "Mở Set API → Voice, kiểm tra API Key/Header rồi Test kết nối lại.",
        code: "VOICE_AUTH_ERROR",
      };
    }
    return {
      ...result,
      title: "API AI không hợp lệ",
      message: `${provider} từ chối xác thực${model ? ` khi gọi model ${model}` : ""}.`,
      hint: "Mở Set API → AI, kiểm tra API Key rồi Test kết nối lại.",
      code: "AI_AUTH_ERROR",
    };
  }

  if (status === 403) {
    return {
      ...result,
      title: phase === "render" ? "Voice Server không cho phép truy cập" : "AI không cho phép truy cập",
      message: phase === "render"
        ? `${voiceServer} trả về HTTP 403.`
        : `${provider}${model ? ` / ${model}` : ""} trả về HTTP 403.`,
      hint: "Kiểm tra quyền của API Key, gói dịch vụ/quota và quyền truy cập model hoặc voice.",
      code: phase === "render" ? "VOICE_FORBIDDEN" : "AI_FORBIDDEN",
    };
  }

  if (status === 404 || includesAny(raw, ["model is no longer available", "model not found", "không tìm thấy model", "not_found"])) {
    return {
      ...result,
      title: "Model AI không khả dụng",
      message: `${provider}${model ? ` / ${model}` : ""} không tồn tại, đã ngừng hỗ trợ hoặc không khả dụng với tài khoản hiện tại.`,
      hint: "Bấm Sửa dự án, chọn model khác hoặc mở Set API → AI → Test kết nối để tải lại danh sách model.",
      code: "AI_MODEL_NOT_FOUND",
    };
  }

  if (status === 429 || includesAny(raw, ["too many requests", "rate limit", "quota exceeded", "resource_exhausted"])) {
    return {
      ...result,
      title: "AI đang giới hạn lượt gọi",
      message: `${provider}${model ? ` / ${model}` : ""} đang bị giới hạn request (HTTP 429).`,
      hint: "Chờ một lúc rồi bấm Tạo lại kịch bản, hoặc chọn model/API khác nếu cần.",
      code: "AI_RATE_LIMIT",
    };
  }

  if (status === 503 || includesAny(raw, ["high demand", "currently experiencing high demand", "unavailable"])) {
    return {
      ...result,
      title: "Model AI đang quá tải",
      message: `${provider}${model ? ` / ${model}` : ""} hiện đang quá tải hoặc tạm thời không khả dụng (HTTP 503).`,
      hint: "Hệ thống đã tự thử lại. Nếu vẫn lỗi, bấm Tạo lại kịch bản sau ít phút hoặc Sửa dự án để chọn model khác.",
      code: "AI_TEMPORARILY_UNAVAILABLE",
    };
  }

  if ([500, 502, 504].includes(status)) {
    return {
      ...result,
      title: phase === "render" ? "Voice Server đang lỗi tạm thời" : "AI Server đang lỗi tạm thời",
      message: phase === "render"
        ? `${voiceServer} trả về HTTP ${status}.`
        : `${provider}${model ? ` / ${model}` : ""} trả về HTTP ${status}.`,
      hint: "Hệ thống đã tự thử lại với lỗi tạm thời. Nếu vẫn lỗi, kiểm tra server hoặc thử lại sau.",
      code: phase === "render" ? "VOICE_SERVER_ERROR" : "AI_SERVER_ERROR",
    };
  }

  if (includesAny(raw, ["nguồn giọng đã bị xóa", "nguồn giọng đã chọn không còn tồn tại", "chưa chọn nguồn giọng", "không có nguồn giọng"])) {
    return {
      ...result,
      title: "Chưa kết nối API Voice Server",
      message: "Nguồn giọng đã chọn không còn tồn tại hoặc chưa được cấu hình.",
      hint: "Mở Set API → Voice, thêm/kích hoạt Voice Server và bấm Test kết nối.",
      code: "VOICE_NOT_CONFIGURED",
    };
  }

  if (includesAny(raw, ["thiếu url hoặc api key", "thiếu url/api key", "chưa sẵn sàng", "không tải được giọng"])) {
    return {
      ...result,
      title: "Voice Server chưa sẵn sàng",
      message: `${voiceServer} chưa sẵn sàng để tạo giọng.`,
      hint: "Kiểm tra URL, API Key, trạng thái server và bấm Test kết nối trong Set API → Voice.",
      code: "VOICE_NOT_READY",
    };
  }

  if (includesAny(raw, ["không có giọng phù hợp", "không tìm thấy giọng", "voice not found"])) {
    return {
      ...result,
      title: "Giọng đọc không tồn tại",
      message: `${voiceServer}${voiceName ? ` không tìm thấy giọng ${voiceName}` : " không tìm thấy giọng đã chọn"}.`,
      hint: "Tải lại danh sách giọng hoặc chọn một giọng khác trước khi Render.",
      code: "VOICE_NOT_FOUND",
    };
  }

  if (includesAny(raw, ["audio ngắn bất thường", "audio qua ngan", "chunk", "không đầy đủ", "khong day du"]) && phase === "render") {
    return {
      ...result,
      title: "Giọng đọc không đầy đủ",
      message: `${voiceServer}${voiceName ? ` / ${voiceName}` : ""} tạo audio ngắn bất thường hoặc một đoạn lời đọc chưa hoàn chỉnh.`,
      hint: "Hệ thống đã tự chia nhỏ lời đọc và tạo lại đoạn lỗi. Nếu vẫn thất bại, kiểm tra Chi tiết / Log để biết scene/chunk cụ thể rồi Render lại.",
      code: "VOICE_AUDIO_INCOMPLETE",
    };
  }

  if (includesAny(raw, ["vieneu-tts create error", "tts create error", "tạo giọng thất bại", "tao giong that bai"])) {
    return {
      ...result,
      title: "Voice Server tạo giọng thất bại",
      message: `${voiceServer} không tạo được audio${voiceName ? ` với giọng ${voiceName}` : ""}.`,
      hint: "Kiểm tra Voice Server, giọng đã chọn, API Key và nội dung cảnh trong Chi tiết / Log rồi Render lại.",
      code: "VOICE_CREATE_FAILED",
    };
  }

  if (includesAny(raw, ["fetch failed", "econnrefused", "enotfound", "connection error", "network error", "socket hang up"])) {
    return {
      ...result,
      title: phase === "render" ? "Không kết nối được Voice Server" : "Không kết nối được AI Server",
      message: phase === "render"
        ? `Không thể kết nối tới ${voiceServer}.`
        : `Không thể kết nối tới ${provider}${model ? ` khi gọi ${model}` : ""}.`,
      hint: phase === "render"
        ? "Kiểm tra IP/URL, port, firewall và trạng thái Voice Server trong Set API → Voice."
        : "Kiểm tra URL/API, Internet hoặc trạng thái AI server trong Set API → AI.",
      code: phase === "render" ? "VOICE_CONNECTION_ERROR" : "AI_CONNECTION_ERROR",
    };
  }

  if (includesAny(raw, ["timeout", "aborterror", "timed out"])) {
    return {
      ...result,
      title: phase === "render" ? "Voice Server phản hồi quá lâu" : "AI phản hồi quá lâu",
      message: phase === "render" ? `${voiceServer} bị timeout.` : `${provider}${model ? ` / ${model}` : ""} bị timeout.`,
      hint: "Kiểm tra tải của server hoặc thử lại sau. Nếu dùng server local, kiểm tra CPU/RAM/GPU và mạng LAN.",
      code: phase === "render" ? "VOICE_TIMEOUT" : "AI_TIMEOUT",
    };
  }

  // Remove long technical tails from the card; complete details remain in Log.
  const concise = raw
    .replace(/\s+at\s+[\s\S]*$/m, "")
    .replace(/npm notice[\s\S]*$/i, "")
    .trim();
  result.message = concise.slice(0, 700) || result.message;
  return result;
}

export function applyPresentedError(target, presented) {
  target.error = presented.message;
  target.errorTitle = presented.title;
  target.errorHint = presented.hint;
  target.errorCode = presented.code;
  return target;
}
