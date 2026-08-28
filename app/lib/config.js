import path from "node:path";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config({ path: process.env.ENV_FILE || ".env.local" });

function intEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(raw);
}

function configuredValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) return "";
  if (/x{4,}|your[_-]|replace[_-]?me|changeme|github_pat_11_x/i.test(value)) return "";
  return value;
}

function parseModels(listValue, singleValue) {
  const values = `${listValue || ""}\n${singleValue || ""}`
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(values)];
}

function normalizeVoiceGender(value) {
  const raw = String(value || "").trim().toLocaleLowerCase("vi");
  if (["nam", "male", "m"].includes(raw)) return "Nam";
  if (["nữ", "nu", "female", "f"].includes(raw)) return "Nữ";
  return String(value || "Khác").trim() || "Khác";
}

function parseLucyVoices(raw, defaultVoiceId) {
  const voices = [];
  const entries = String(raw || "").split(/\r?\n|;/).map((item) => item.trim()).filter(Boolean);
  for (const entry of entries) {
    if (entry.startsWith("#")) continue;
    const parts = entry.split("|").map((item) => item.trim());
    let key;
    let gender;
    let name;
    let voiceId;
    if (parts.length >= 4) [key, gender, name, voiceId] = parts;
    else if (parts.length >= 3) {
      [gender, name, voiceId] = parts;
      key = voiceId;
    } else continue;
    if (!key || !name || !voiceId) continue;
    voices.push({ key, gender: normalizeVoiceGender(gender), name, voiceId });
  }

  if (defaultVoiceId && !voices.some((voice) => voice.voiceId === defaultVoiceId)) {
    voices.unshift({
      key: "default",
      gender: normalizeVoiceGender(process.env.LUCYLAB_DEFAULT_GENDER || "Nam"),
      name: String(process.env.LUCYLAB_DEFAULT_VOICE_NAME || "Giọng mặc định").trim(),
      voiceId: defaultVoiceId,
    });
  }

  const seen = new Set();
  return voices.filter((voice) => {
    if (seen.has(voice.key)) return false;
    seen.add(voice.key);
    return true;
  });
}

function publicVoice(voice) {
  return { id: voice.key, name: voice.name, gender: voice.gender };
}

function publicProvider(provider) {
  return {
    id: provider.id,
    label: provider.label,
    adapter: provider.adapter || provider.kind,
    models: provider.models,
    modelDetails: Array.isArray(provider.modelDetails) ? provider.modelDetails : [],
    defaultModel: provider.defaultModel,
    catalog: provider.catalog || null,
  };
}

function createProviders() {
  const providers = [
    {
      id: "github",
      label: "GitHub Models",
      kind: "openai-chat",
      apiKey: configuredValue("GITHUB_TOKEN"),
      endpoint: configuredValue("GITHUB_MODELS_ENDPOINT") || "https://models.github.ai/inference/chat/completions",
      apiVersion: configuredValue("GITHUB_API_VERSION") || "2026-03-10",
      models: parseModels(process.env.GITHUB_MODELS, process.env.GITHUB_MODEL || "openai/gpt-4.1-mini"),
      modelDetails: [],
      catalog: null,
    },
    {
      id: "anthropic",
      label: "Claude",
      kind: "anthropic-messages",
      apiKey: configuredValue("ANTHROPIC_API_KEY"),
      endpoint: configuredValue("ANTHROPIC_ENDPOINT") || "https://api.anthropic.com/v1/messages",
      apiVersion: configuredValue("ANTHROPIC_VERSION") || "2023-06-01",
      models: parseModels(process.env.ANTHROPIC_MODELS, process.env.ANTHROPIC_MODEL),
    },
    {
      id: "gemini",
      label: "Google Gemini",
      kind: "gemini-generate-content",
      apiKey: configuredValue("GEMINI_API_KEY"),
      endpoint: (configuredValue("GEMINI_ENDPOINT") || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, ""),
      models: parseModels(process.env.GEMINI_MODELS, process.env.GEMINI_MODEL),
    },
    {
      id: "openai",
      label: "OpenAI",
      kind: "openai-chat",
      apiKey: configuredValue("OPENAI_API_KEY"),
      endpoint: (configuredValue("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions",
      models: parseModels(process.env.OPENAI_MODELS, process.env.OPENAI_MODEL),
    },
    {
      id: "openai-compatible",
      label: "OpenAI-compatible",
      kind: "openai-chat",
      apiKey: configuredValue("OPENAI_COMPATIBLE_API_KEY"),
      endpoint: configuredValue("OPENAI_COMPATIBLE_BASE_URL")
        ? configuredValue("OPENAI_COMPATIBLE_BASE_URL").replace(/\/$/, "") + "/chat/completions"
        : "",
      models: parseModels(process.env.OPENAI_COMPATIBLE_MODELS, process.env.OPENAI_COMPATIBLE_MODEL),
    },
  ];

  return providers.map((provider) => ({
    ...provider,
    defaultModel: provider.models[0] || "",
    available: Boolean(provider.apiKey && provider.endpoint && provider.models.length),
  }));
}

export function loadConfig() {
  const baseRepoDir = path.resolve(process.env.BASE_REPO_DIR || "/opt/auto-video-gen/base");
  const dataDir = path.resolve(process.env.DATA_DIR || "/opt/auto-video-gen/data");
  const downloadDir = path.resolve(process.env.DOWNLOAD_OUTPUT_DIR || "/opt/auto-video-gen/downloads");
  const providers = createProviders();
  const availableProviders = providers.filter((provider) => provider.available);
  const configuredLucyVoiceId = configuredValue("VIETNAMESE_VOICEID");
  const lucyVoices = parseLucyVoices(process.env.LUCYLAB_VOICES, configuredLucyVoiceId);
  const requestedVoiceKey = String(process.env.LUCYLAB_DEFAULT_VOICE_KEY || "").trim();
  const defaultLucyVoice = lucyVoices.find((voice) => voice.key === requestedVoiceKey)
    || lucyVoices.find((voice) => voice.voiceId === configuredLucyVoiceId)
    || lucyVoices[0]
    || null;
  const vieneuBaseUrl = configuredValue("VIENEU_BASE_URL").replace(/\/+$/, "");
  const vieneuApiKey = configuredValue("VIENEU_API_KEY");
  const legacyDefault = String(process.env.AI_PROVIDER || "").trim();
  const requestedDefault = String(process.env.AI_DEFAULT_PROVIDER || legacyDefault || "github").trim();
  const defaultProvider = availableProviders.some((provider) => provider.id === requestedDefault)
    ? requestedDefault
    : availableProviders[0]?.id || requestedDefault;
  const requestedFallback = String(process.env.AI_FALLBACK_PROVIDER || "").trim();
  const defaultFallbackProvider = availableProviders.some((provider) => provider.id === requestedFallback)
    ? requestedFallback
    : availableProviders.find((provider) => provider.id !== defaultProvider)?.id || "";

  return {
    host: process.env.HOST || "0.0.0.0",
    port: intEnv("PORT", 3080, 1, 65535),
    dashboardUsername: String(process.env.DASHBOARD_USERNAME || "").trim(),
    dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
    baseRepoDir,
    dataDir,
    uploadDir: path.join(dataDir, "uploads"),
    inputDir: path.join(dataDir, "inputs"),
    jobsFile: path.join(dataDir, "jobs.json"),
    connectionsFile: path.join(dataDir, "connections.json"),
    masterKeyFile: path.join(dataDir, "master.key"),
    downloadDir,
    maxUploadBytes: intEnv("MAX_UPLOAD_MB", 25, 1, 250) * 1024 * 1024,
    maxSourceChars: intEnv("MAX_SOURCE_CHARS", 100000, 10000, 500000),
    aiMaxTokens: intEnv("AI_MAX_TOKENS", 12000, 2000, 64000),
    aiRequestTimeoutMs: intEnv("AI_REQUEST_TIMEOUT_MS", 180000, 30000, 600000),
    aiRateLimitMaxWaitMs: intEnv("AI_RATE_LIMIT_MAX_WAIT_MS", 60000, 0, 300000),
    aiAutoFallback: boolEnv("AI_AUTO_FALLBACK", true),
    githubCatalogEnabled: boolEnv("GITHUB_CATALOG_ENABLED", true),
    githubCatalogUrl: configuredValue("GITHUB_CATALOG_URL") || "https://models.github.ai/catalog/models",
    githubCatalogTtlMs: intEnv("GITHUB_CATALOG_TTL_MINUTES", 360, 5, 10080) * 60 * 1000,
    githubCatalogCacheFile: path.join(dataDir, "github-models-cache.json"),
    scriptRepairAttempts: intEnv("SCRIPT_REPAIR_ATTEMPTS", 3, 0, 6),
    ttsDurationCheck: boolEnv("TTS_DURATION_CHECK", true),
    ttsDurationRepairAttempts: intEnv("TTS_DURATION_REPAIR_ATTEMPTS", 2, 0, 4),
    providers,
    availableProviders,
    defaultProvider,
    defaultFallbackProvider,
    lucyApiKey: configuredValue("VIETNAMESE_API_KEY"),
    lucyVoiceId: defaultLucyVoice?.voiceId || configuredLucyVoiceId,
    lucyVoices,
    defaultLucyVoiceKey: defaultLucyVoice?.key || "",
    ttsDefaultProvider: String(process.env.TTS_DEFAULT_PROVIDER || process.env.TTS_PROVIDER || "lucylab").trim().toLowerCase(),
    vieneuBaseUrl,
    vieneuApiKey,
    vieneuApiHeader: String(process.env.VIENEU_API_HEADER || "x-api-key").trim() || "x-api-key",
    vieneuTimeoutMs: intEnv("VIENEU_TIMEOUT_MS", 600000, 10000, 1800000),
    vieneuPreload: boolEnv("VIENEU_PRELOAD", true),
    vieneuDefaultVoice: String(process.env.VIENEU_DEFAULT_VOICE || "").trim(),
    ttsPronunciationRules: process.env.TTS_PRONUNCIATION_RULES || "OSI=ô ét ai",
    brandLogoPath: configuredValue("VIDEO_BRAND_LOGO_PATH"),
    tiktokAvatarPath: configuredValue("TIKTOK_AVATAR_PATH"),
    brandDisplayName: String(process.env.TIKTOK_DISPLAY_NAME || "").trim(),
    tiktokHandle: String(process.env.TIKTOK_HANDLE || "").trim(),
    defaultTheme: ["dark-neon", "light-pro", "tech-blue", "ubuntu"].includes(String(process.env.VIDEO_THEME || "")) ? String(process.env.VIDEO_THEME) : "dark-neon",
  };
}

export function getProvider(config, providerId) {
  return config.providers.find((provider) => provider.id === providerId) || null;
}

export function resolveProviderSelection(config, providerId, model) {
  const provider = getProvider(config, providerId);
  if (!provider?.available) throw new Error(`Nguồn AI chưa được cấu hình: ${providerId || "không xác định"}`);
  const selectedModel = String(model || provider.defaultModel).trim();
  if (!provider.models.includes(selectedModel)) {
    throw new Error(`Model ${selectedModel || "trống"} không nằm trong cấu hình của ${provider.label}`);
  }
  return { provider, model: selectedModel };
}

export function getPublicAppConfig(config) {
  return {
    providers: config.availableProviders.map(publicProvider),
    defaultProvider: config.defaultProvider,
    defaultFallbackProvider: config.defaultFallbackProvider,
    autoFallbackDefault: config.aiAutoFallback,
    voices: config.lucyVoices.map(publicVoice),
    defaultVoiceKey: config.defaultLucyVoiceKey,
    branding: {
      hasDefaultLogo: Boolean(config.brandLogoPath),
      hasDefaultAvatar: Boolean(config.tiktokAvatarPath),
      pageName: config.brandDisplayName || "",
      tiktokHandle: config.tiktokHandle || "",
    },
    contentStyles: [
      { id: "tutorial", label: "Hướng dẫn sử dụng" },
      { id: "feature-intro", label: "Giới thiệu tính năng" },
      { id: "summary", label: "Tóm tắt nội dung" },
      { id: "explain", label: "Giải thích kiến thức" },
      { id: "compare", label: "So sánh" },
      { id: "review", label: "Review / đánh giá" },
      { id: "news", label: "Tin tức / cập nhật" },
      { id: "listicle", label: "Danh sách / Top" },
    ],
    detailLevels: [
      { id: "concise", label: "Ngắn gọn" },
      { id: "balanced", label: "Cân bằng" },
      { id: "deep", label: "Chuyên sâu" },
    ],
    audiences: [
      { id: "general", label: "Đại chúng" },
      { id: "beginner", label: "Người mới bắt đầu" },
      { id: "intermediate", label: "Đã có kiến thức cơ bản" },
      { id: "expert", label: "Người có chuyên môn" },
    ],
  };
}

export function resolveLucyVoice(config, voiceKey) {
  const selected = config.lucyVoices.find((voice) => voice.key === String(voiceKey || "").trim())
    || config.lucyVoices.find((voice) => voice.voiceId === String(voiceKey || "").trim())
    || config.lucyVoices.find((voice) => voice.key === config.defaultLucyVoiceKey)
    || config.lucyVoices[0];
  if (!selected) throw new Error("Chưa cấu hình giọng đọc LucyLab");
  return selected;
}

export function validateJobConfig(config, selection = null) {
  const errors = [];
  const readyVoices = (config.voiceConnections || []).filter((item) => item.enabled !== false && (
    (item.adapter === "vieneu" && item.baseUrl)
    || (item.adapter === "lucylab" && item.apiKey && item.voices?.length)
    || (["openai-tts", "custom-voice"].includes(item.adapter) && item.baseUrl && item.voices?.length)
  ));
  if (!readyVoices.length) errors.push("Chưa cấu hình nguồn giọng nào trong Set API");
  if (!config.availableProviders.length) errors.push("Chưa cấu hình nguồn AI nào trong Set API");
  if (selection?.ttsConnectionId && !(config.voiceConnections || []).some((item) => item.id === selection.ttsConnectionId && item.enabled !== false)) {
    errors.push("Nguồn giọng đã chọn không còn khả dụng");
  }
  if (selection?.providerId) {
    try { resolveProviderSelection(config, selection.providerId, selection.model); }
    catch (error) { errors.push(error.message); }
  }
  return errors;
}
