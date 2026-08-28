import { parseVoiceDefinitions } from "./connection-store.js";
import { discoverGenericVoiceConnection } from "./voice-bridge.js";

function clean(value) { return String(value ?? "").trim(); }
function stripSlash(value) { return clean(value).replace(/\/+$/, ""); }
function splitModels(value) {
  if (Array.isArray(value)) return [...new Set(value.map(clean).filter(Boolean))];
  return [...new Set(clean(value).split(/[\n,;]+/).map(clean).filter(Boolean))];
}
function normalizeGender(value) {
  const raw = clean(value).toLocaleLowerCase("vi");
  if (raw.includes("nữ") || raw.includes("female") || /(^|[^a-z])nu([^a-z]|$)/.test(raw)) return "Nữ";
  if (raw.includes("nam") || raw.includes("male")) return "Nam";
  return "Khác";
}
function classifyModel(id) {
  const value = clean(id).toLowerCase();
  if (/deepseek-r1|\/o1(?:-|$)|\/o3(?:-|$)|\/o4(?:-|$)|reasoning/.test(value)) return "reasoning";
  if (/vision|multimodal/.test(value)) return "vision";
  if (/codestral|coder|code/.test(value)) return "code";
  return "general";
}
function scoreModel(detail) {
  let score = 0;
  if (detail.rateLimitTier === "low") score += 35;
  else if (detail.rateLimitTier === "high") score += 20;
  else if (detail.rateLimitTier === "custom") score -= 10;
  if (/mini|nano|small|instruct|chat|command/i.test(detail.id)) score += 15;
  if (detail.kind === "general") score += 12;
  if ((detail.maxInputTokens || 0) >= 128000) score += 5;
  if ((detail.maxOutputTokens || 0) >= 16000) score += 5;
  if (detail.kind === "reasoning") score -= 15;
  return score;
}
function normalizeGitHubModel(model) {
  const id = clean(model?.id || model?.name);
  if (!id) return null;
  const limits = model?.limits || {};
  const detail = {
    id,
    name: clean(model?.display_name || model?.displayName || id),
    publisher: typeof model?.publisher === "string" ? model.publisher : clean(model?.publisher?.name || id.split("/")[0]),
    summary: clean(model?.summary || model?.description),
    rateLimitTier: clean(model?.rate_limit_tier || model?.rateLimitTier || "unknown").toLowerCase(),
    maxInputTokens: Number(limits.max_input_tokens ?? limits.maxInputTokens ?? 0) || null,
    maxOutputTokens: Number(limits.max_output_tokens ?? limits.maxOutputTokens ?? 0) || null,
    kind: classifyModel(id),
  };
  detail.score = scoreModel(detail);
  detail.recommended = detail.score >= 45;
  return detail;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

async function readJson(response) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { raw }; }
  if (!response.ok) {
    const detail = data?.detail || data?.error?.message || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
    const error = new Error(String(detail).slice(0, 1200));
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

function chatEndpoint(baseUrl, adapter) {
  const defaultBase = adapter === "github-models" ? "https://models.github.ai/inference"
    : adapter === "openai" ? "https://api.openai.com/v1"
    : "";
  const base = stripSlash(baseUrl || defaultBase);
  if (!base) return "";
  if (/\/chat\/completions$/i.test(base)) return base;
  return `${base}/chat/completions`;
}

function endpointUrl(baseUrl, endpoint, fallbackPath = "") {
  const raw = clean(endpoint || fallbackPath);
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = stripSlash(baseUrl);
  if (!base) return "";
  if (!raw) return base;
  return `${base}/${raw.replace(/^\/+/, "")}`;
}

function valueAtPath(root, rawPath) {
  const path = clean(rawPath);
  if (!path) return root;
  const tokens = path.replace(/\[(\d+)\]/g, ".$1").split(".").map(clean).filter(Boolean);
  let value = root;
  for (const token of tokens) {
    if (value == null) return undefined;
    value = value[/^\d+$/.test(token) ? Number(token) : token];
  }
  return value;
}

function customAiHeaders(connection, apiKey) {
  if (!apiKey) return {};
  const header = clean(connection.apiHeader) || "Authorization";
  const prefix = String(connection.settings?.aiAuthPrefix ?? "Bearer ");
  return { [header]: `${prefix}${apiKey}` };
}

export function bootstrapConnectionsFromLegacyConfig(config) {
  const connections = [];
  for (const provider of config.providers || []) {
    if (!provider?.available) continue;
    const adapter = provider.id === "github" ? "github-models"
      : provider.id === "anthropic" ? "anthropic"
      : provider.id === "gemini" ? "gemini"
      : provider.id === "openai" ? "openai"
      : "openai-compatible";
    let baseUrl = provider.endpoint || "";
    if (["github-models", "openai", "openai-compatible"].includes(adapter)) baseUrl = baseUrl.replace(/\/chat\/completions$/i, "");
    connections.push({
      id: `ai-${provider.id}`,
      category: "ai",
      name: provider.label,
      adapter,
      baseUrl,
      apiKey: provider.apiKey,
      models: provider.models,
      defaultModel: provider.defaultModel,
      enabled: true,
      settings: { apiVersion: provider.apiVersion || "" },
    });
  }
  if (config.vieneuBaseUrl && config.vieneuApiKey) {
    connections.push({
      id: "voice-vieneu",
      category: "voice",
      name: "VieNeu-TTS Local",
      adapter: "vieneu",
      baseUrl: config.vieneuBaseUrl,
      apiKey: config.vieneuApiKey,
      apiHeader: config.vieneuApiHeader || "x-api-key",
      defaultVoice: config.vieneuDefaultVoice || "",
      enabled: true,
    });
  }
  if (config.lucyApiKey && config.lucyVoices?.length) {
    connections.push({
      id: "voice-lucylab",
      category: "voice",
      name: "LucyLab",
      adapter: "lucylab",
      baseUrl: process.env.LUCYLAB_ENDPOINT || "https://api.lucylab.io/json-rpc",
      apiKey: config.lucyApiKey,
      voices: config.lucyVoices.map((voice) => ({ id: voice.key, name: voice.name, gender: voice.gender, voiceId: voice.voiceId })),
      defaultVoice: config.defaultLucyVoiceKey || "",
      enabled: true,
    });
  }
  return connections;
}

export function applyConnectionsToConfig(config, runtimeConnections) {
  const aiConnections = runtimeConnections.filter((item) => item.category === "ai" && item.enabled !== false);
  const providers = aiConnections.map((item) => {
    const apiKey = clean(item.secret?.apiKey);
    const models = splitModels(item.models);
    const adapter = item.adapter;
    let kind = "openai-chat";
    let endpoint = "";
    let apiVersion = clean(item.settings?.apiVersion);
    if (adapter === "github-models") {
      endpoint = chatEndpoint(item.baseUrl, adapter);
      apiVersion ||= "2026-03-10";
    } else if (adapter === "anthropic") {
      kind = "anthropic-messages";
      endpoint = stripSlash(item.baseUrl || "https://api.anthropic.com") + "/v1/messages";
      apiVersion ||= "2023-06-01";
    } else if (adapter === "gemini") {
      kind = "gemini-generate-content";
      endpoint = stripSlash(item.baseUrl || "https://generativelanguage.googleapis.com/v1beta");
    } else if (adapter === "custom-ai") {
      kind = "custom-rest";
      endpoint = endpointUrl(item.baseUrl, item.settings?.aiChatEndpoint);
    } else {
      endpoint = chatEndpoint(item.baseUrl, adapter);
    }
    const modelDetails = Array.isArray(item.settings?.modelDetails) ? item.settings.modelDetails : models.map((id) => ({
      id, name: id, publisher: id.split("/")[0] || item.name, summary: "", rateLimitTier: "unknown", maxInputTokens: null, maxOutputTokens: null,
      kind: classifyModel(id), recommended: false, score: 0,
    }));
    return {
      id: item.id,
      label: item.name,
      adapter,
      kind,
      apiKey,
      endpoint,
      apiVersion,
      models,
      modelDetails,
      defaultModel: models.includes(item.defaultModel) ? item.defaultModel : models[0] || "",
      custom: adapter === "custom-ai" ? {
        apiHeader: clean(item.apiHeader) || "Authorization",
        authPrefix: String(item.settings?.aiAuthPrefix ?? "Bearer "),
        requestMode: clean(item.settings?.aiRequestMode) || "messages",
        modelField: clean(item.settings?.aiModelField) || "model",
        messagesField: clean(item.settings?.aiMessagesField) || "messages",
        promptField: clean(item.settings?.aiPromptField) || "prompt",
        responsePath: clean(item.settings?.aiResponsePath) || "choices.0.message.content",
        extraJson: String(item.settings?.aiExtraJson || "").trim(),
      } : null,
      available: Boolean(endpoint && models.length && (apiKey || !["github-models", "openai", "gemini", "anthropic"].includes(adapter))),
      catalog: item.lastTest ? { enabled: true, source: "connections", loadedAt: item.lastTest.at, count: models.length, totalCount: models.length, stale: !item.lastTest.ok, error: item.lastTest.ok ? "" : item.lastTest.message } : null,
    };
  });
  config.providers = providers;
  config.availableProviders = providers.filter((provider) => provider.available);
  config.defaultProvider = config.availableProviders[0]?.id || "";
  config.defaultFallbackProvider = "";
  config.aiAutoFallback = false;

  config.voiceConnections = runtimeConnections.filter((item) => item.category === "voice" && item.enabled !== false).map((item) => ({
    ...item,
    apiKey: clean(item.secret?.apiKey),
  }));
  config.ttsDefaultConnectionId = config.voiceConnections[0]?.id || "";

  const lucy = config.voiceConnections.find((item) => item.adapter === "lucylab");
  if (lucy) {
    config.lucyApiKey = lucy.apiKey;
    config.lucyVoices = (lucy.voices || []).map((voice) => ({ key: voice.id, name: voice.name, gender: voice.gender || "Khác", voiceId: voice.voiceId || voice.id }));
    config.defaultLucyVoiceKey = lucy.defaultVoice || config.lucyVoices[0]?.key || "";
    config.lucyVoiceId = config.lucyVoices.find((voice) => voice.key === config.defaultLucyVoiceKey)?.voiceId || config.lucyVoices[0]?.voiceId || "";
  }
  const vieneu = config.voiceConnections.find((item) => item.adapter === "vieneu");
  if (vieneu) {
    config.vieneuBaseUrl = stripSlash(vieneu.baseUrl);
    config.vieneuApiKey = vieneu.apiKey;
    config.vieneuApiHeader = vieneu.apiHeader || "x-api-key";
    config.vieneuDefaultVoice = vieneu.defaultVoice || "";
  }
  return config;
}

export function getVoiceConnection(config, connectionId) {
  const id = clean(connectionId);
  return (config.voiceConnections || []).find((item) => item.id === id) || null;
}

export async function discoverConnection(connection, timeoutMs = 45000) {
  const apiKey = clean(connection.secret?.apiKey);
  const adapter = connection.adapter;
  const baseUrl = stripSlash(connection.baseUrl);
  const headers = {};
  let models = connection.models || [];
  let voices = connection.voices || [];
  let modelDetails = connection.settings?.modelDetails || [];
  let message = "Kết nối thành công";

  if (connection.category === "ai") {
    if (!apiKey && ["github-models", "openai", "gemini", "anthropic"].includes(adapter)) throw new Error("Chưa nhập API key");
    if (adapter === "github-models") {
      const url = clean(connection.settings?.catalogUrl) || "https://models.github.ai/catalog/models";
      const data = await readJson(await fetchWithTimeout(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${apiKey}`, "X-GitHub-Api-Version": clean(connection.settings?.apiVersion) || "2026-03-10" } }, timeoutMs));
      const list = Array.isArray(data) ? data : data?.models || [];
      modelDetails = list.map(normalizeGitHubModel).filter(Boolean).sort((a, b) => (b.recommended - a.recommended) || (b.score - a.score) || a.id.localeCompare(b.id));
      models = modelDetails.map((item) => item.id);
      message = `${models.length} model khả dụng`;
    } else if (adapter === "gemini") {
      const url = `${baseUrl || "https://generativelanguage.googleapis.com/v1beta"}/models`;
      const data = await readJson(await fetchWithTimeout(url, { headers: { "x-goog-api-key": apiKey } }, timeoutMs));
      const preferred = [
        "gemini-3.6-flash",
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.5-pro",
      ];
      const rank = new Map(preferred.map((id, index) => [id, index]));
      const geminiItems = (data?.models || []).filter((item) => {
        const id = clean(item?.name).replace(/^models\//, "");
        const methods = Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : [];
        return id.startsWith("gemini-") && (!methods.length || methods.includes("generateContent"));
      });
      geminiItems.sort((a, b) => {
        const aid = clean(a?.name).replace(/^models\//, "");
        const bid = clean(b?.name).replace(/^models\//, "");
        const ar = rank.has(aid) ? rank.get(aid) : 999;
        const br = rank.has(bid) ? rank.get(bid) : 999;
        return ar - br || aid.localeCompare(bid);
      });
      models = geminiItems.map((item) => clean(item.name).replace(/^models\//, "")).filter(Boolean);
      modelDetails = models.map((id) => ({ id, name: id, publisher: "Google", summary: "", rateLimitTier: "unknown", maxInputTokens: null, maxOutputTokens: null, kind: "general", recommended: rank.has(id) && rank.get(id) < 3, score: rank.has(id) ? 100 - rank.get(id) : 0 }));
      message = `${models.length} model Gemini tạo nội dung`;
    } else if (adapter === "anthropic") {
      const url = `${baseUrl || "https://api.anthropic.com"}/v1/models`;
      const data = await readJson(await fetchWithTimeout(url, { headers: { "x-api-key": apiKey, "anthropic-version": clean(connection.settings?.apiVersion) || "2023-06-01" } }, timeoutMs));
      models = (data?.data || []).map((item) => clean(item.id)).filter(Boolean);
      message = `${models.length} model khả dụng`;
    } else if (adapter === "custom-ai") {
      if (!baseUrl) throw new Error("Chưa nhập URL Custom AI REST");
      const modelsEndpoint = clean(connection.settings?.aiModelsEndpoint);
      if (modelsEndpoint) {
        const url = endpointUrl(baseUrl, modelsEndpoint);
        const data = await readJson(await fetchWithTimeout(url, { headers: customAiHeaders(connection, apiKey) }, timeoutMs));
        const listValue = valueAtPath(data, connection.settings?.aiModelsListPath || "data");
        const list = Array.isArray(listValue) ? listValue : Array.isArray(data) ? data : [];
        const idField = clean(connection.settings?.aiModelIdField) || "id";
        const nameField = clean(connection.settings?.aiModelNameField) || "name";
        const details = list.map((item) => {
          if (typeof item === "string") return { id: clean(item), name: clean(item) };
          const id = clean(valueAtPath(item, idField) ?? item?.id ?? item?.name);
          const name = clean(valueAtPath(item, nameField) ?? item?.name ?? id);
          return id ? { id, name } : null;
        }).filter(Boolean);
        models = details.map((item) => item.id);
        modelDetails = details.map((item) => ({ id: item.id, name: item.name, publisher: connection.name, summary: "", rateLimitTier: "unknown", maxInputTokens: null, maxOutputTokens: null, kind: classifyModel(item.id), recommended: false, score: 0 }));
        message = `${models.length} model từ Custom AI REST`;
      } else {
        models = splitModels(connection.models);
        message = `${models.length} model thủ công`;
      }
    } else {
      const standardBase = baseUrl || (adapter === "openai" ? "https://api.openai.com/v1" : "");
      if (!standardBase) throw new Error("Chưa nhập URL AI server");
      const url = `${standardBase}/models`;
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const data = await readJson(await fetchWithTimeout(url, { headers }, timeoutMs));
      models = (data?.data || data?.models || []).map((item) => clean(item?.id || item?.name)).filter(Boolean);
      message = `${models.length} model khả dụng`;
    }
    if (!models.length) throw new Error("Server không trả về danh sách model");
  } else if (adapter === "vieneu") {
    if (!baseUrl) throw new Error("Chưa nhập URL VieNeu-TTS");
    const auth = apiKey ? { [clean(connection.apiHeader) || "x-api-key"]: apiKey } : {};
    const [health, data] = await Promise.all([
      readJson(await fetchWithTimeout(`${baseUrl}/api/health`, { headers: auth }, timeoutMs)).catch(() => ({})),
      readJson(await fetchWithTimeout(`${baseUrl}/api/voices`, { headers: auth }, timeoutMs)),
    ]);
    const list = Array.isArray(data) ? data : data?.voices || [];
    voices = list.map((voice) => {
      const id = clean(voice?.id || voice?.name);
      const name = clean(voice?.name || voice?.id);
      const description = clean(voice?.description);
      return id && name ? { id, name, voiceId: id, gender: normalizeGender(`${description} ${name}`), description } : null;
    }).filter(Boolean);
    if (!voices.length) throw new Error("VieNeu-TTS không trả về danh sách giọng");
    message = `${voices.length} giọng · model ${health?.model_ready === false ? "chưa sẵn sàng" : "sẵn sàng"}`;
  } else if (adapter === "lucylab") {
    if (!apiKey) throw new Error("Chưa nhập API key LucyLab");
    voices = Array.isArray(connection.voices) ? connection.voices : [];
    if (!voices.length) throw new Error("LucyLab cần khai báo ít nhất một giọng");
    message = `${voices.length} giọng đã cấu hình`;
  } else if (["openai-tts", "custom-voice"].includes(adapter)) {
    const result = await discoverGenericVoiceConnection({ ...connection, apiKey }, timeoutMs);
    voices = result.voices;
    message = result.message;
  } else {
    throw new Error(`Adapter chưa hỗ trợ: ${adapter}`);
  }

  return { models, voices, modelDetails, message };
}

export async function testAndRefreshConnection(store, id, timeoutMs = 45000) {
  const connection = store.getRuntime(id);
  if (!connection) throw Object.assign(new Error("Không tìm thấy kết nối"), { statusCode: 404 });
  try {
    const result = await discoverConnection(connection, timeoutMs);
    const defaultModel = result.models.includes(connection.defaultModel) ? connection.defaultModel : result.models[0] || "";
    const defaultVoice = result.voices.some((voice) => voice.id === connection.defaultVoice) ? connection.defaultVoice : result.voices[0]?.id || "";
    const updated = await store.upsert({
      ...connection,
      apiKey: undefined,
      models: result.models,
      voices: result.voices,
      defaultModel,
      defaultVoice,
      settings: { ...(connection.settings || {}), modelDetails: result.modelDetails || [] },
      lastTest: { ok: true, at: new Date().toISOString(), message: result.message },
    });
    return updated;
  } catch (error) {
    await store.patchTest(id, { ok: false, at: new Date().toISOString(), message: error.message });
    throw error;
  }
}

export function normalizeConnectionInput(body = {}, existing = null) {
  const category = body.category === "voice" ? "voice" : "ai";
  const adapter = clean(body.adapter || existing?.adapter || (category === "voice" ? "vieneu" : "openai-compatible"));
  const voices = Array.isArray(body.voices) ? body.voices : parseVoiceDefinitions(body.voiceDefinitions || "");
  return {
    id: body.id || existing?.id,
    category,
    name: clean(body.name || existing?.name),
    adapter,
    baseUrl: clean(body.baseUrl ?? existing?.baseUrl),
    apiKey: body.apiKey === "__KEEP__" ? undefined : body.apiKey,
    apiHeader: clean(body.apiHeader ?? existing?.apiHeader),
    enabled: body.enabled === undefined ? existing?.enabled !== false : Boolean(body.enabled),
    models: splitModels(body.models ?? existing?.models),
    defaultModel: clean(body.defaultModel ?? existing?.defaultModel),
    voices: voices.length ? voices : existing?.voices || [],
    defaultVoice: clean(body.defaultVoice ?? existing?.defaultVoice),
    settings: {
      ...(existing?.settings || {}),
      apiVersion: clean(body.apiVersion ?? existing?.settings?.apiVersion),
      catalogUrl: clean(body.catalogUrl ?? existing?.settings?.catalogUrl),
      aiAuthPrefix: String(body.aiAuthPrefix ?? existing?.settings?.aiAuthPrefix ?? ""),
      aiModelsEndpoint: clean(body.aiModelsEndpoint ?? existing?.settings?.aiModelsEndpoint),
      aiChatEndpoint: clean(body.aiChatEndpoint ?? existing?.settings?.aiChatEndpoint),
      aiModelsListPath: clean(body.aiModelsListPath ?? existing?.settings?.aiModelsListPath),
      aiModelIdField: clean(body.aiModelIdField ?? existing?.settings?.aiModelIdField),
      aiModelNameField: clean(body.aiModelNameField ?? existing?.settings?.aiModelNameField),
      aiRequestMode: clean(body.aiRequestMode ?? existing?.settings?.aiRequestMode),
      aiModelField: clean(body.aiModelField ?? existing?.settings?.aiModelField),
      aiMessagesField: clean(body.aiMessagesField ?? existing?.settings?.aiMessagesField),
      aiPromptField: clean(body.aiPromptField ?? existing?.settings?.aiPromptField),
      aiResponsePath: clean(body.aiResponsePath ?? existing?.settings?.aiResponsePath),
      aiExtraJson: String(body.aiExtraJson ?? existing?.settings?.aiExtraJson ?? "").trim(),
      authPrefix: String(body.authPrefix ?? existing?.settings?.authPrefix ?? ""),
      voicesEndpoint: clean(body.voicesEndpoint ?? existing?.settings?.voicesEndpoint),
      ttsEndpoint: clean(body.ttsEndpoint ?? existing?.settings?.ttsEndpoint),
      voiceListPath: clean(body.voiceListPath ?? existing?.settings?.voiceListPath),
      voiceIdField: clean(body.voiceIdField ?? existing?.settings?.voiceIdField),
      voiceNameField: clean(body.voiceNameField ?? existing?.settings?.voiceNameField),
      voiceGenderField: clean(body.voiceGenderField ?? existing?.settings?.voiceGenderField),
      voiceDescriptionField: clean(body.voiceDescriptionField ?? existing?.settings?.voiceDescriptionField),
      textField: clean(body.textField ?? existing?.settings?.textField),
      voiceField: clean(body.voiceField ?? existing?.settings?.voiceField),
      filenameField: clean(body.filenameField ?? existing?.settings?.filenameField),
      responseMode: clean(body.responseMode ?? existing?.settings?.responseMode),
      responsePath: clean(body.responsePath ?? existing?.settings?.responsePath),
      ttsModel: clean(body.ttsModel ?? existing?.settings?.ttsModel),
      audioFormat: clean(body.audioFormat ?? existing?.settings?.audioFormat),
      extraJson: String(body.extraJson ?? existing?.settings?.extraJson ?? "").trim(),
    },
  };
}
