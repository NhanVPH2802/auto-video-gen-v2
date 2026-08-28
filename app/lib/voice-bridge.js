function clean(value) { return String(value ?? "").trim(); }
function stripSlash(value) { return clean(value).replace(/\/+$/, ""); }
function joinUrl(base, pathname) {
  const path = clean(pathname);
  if (/^https?:\/\//i.test(path)) return path;
  if (!path) return stripSlash(base);
  return `${stripSlash(base)}${path.startsWith("/") ? path : `/${path}`}`;
}
function getByPath(value, path) {
  const key = clean(path);
  if (!key) return value;
  return key.split(".").reduce((current, part) => current == null ? undefined : current[part], value);
}
function normalizeGender(value) {
  const raw = clean(value).toLocaleLowerCase("vi");
  if (raw.includes("nữ") || raw.includes("female") || /(^|[^a-z])nu([^a-z]|$)/.test(raw)) return "Nữ";
  if (raw.includes("nam") || raw.includes("male")) return "Nam";
  return "Khác";
}
function authHeaders(connection) {
  const apiKey = clean(connection.apiKey || connection.secret?.apiKey);
  if (!apiKey) return {};
  const header = clean(connection.apiHeader) || "Authorization";
  const prefix = connection.adapter === "openai-tts"
    ? (connection.settings?.authPrefix ?? "Bearer ")
    : (connection.settings?.authPrefix ?? "");
  return { [header]: `${prefix}${apiKey}` };
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function jsonOrError(response) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { raw }; }
  if (!response.ok) {
    const detail = data?.detail || data?.error?.message || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 1600));
  }
  return data;
}
function mapVoices(data, connection) {
  const settings = connection.settings || {};
  let list = getByPath(data, settings.voiceListPath || "voices");
  if (!Array.isArray(list) && Array.isArray(data)) list = data;
  if (!Array.isArray(list)) return [];
  const idField = clean(settings.voiceIdField) || "id";
  const nameField = clean(settings.voiceNameField) || "name";
  const genderField = clean(settings.voiceGenderField) || "gender";
  const descriptionField = clean(settings.voiceDescriptionField) || "description";
  return list.map((item, index) => {
    if (typeof item === "string") return { id: item, name: item, voiceId: item, gender: "Khác", description: "" };
    const id = clean(getByPath(item, idField) ?? item?.voice_id ?? item?.voiceId ?? item?.key ?? `voice-${index + 1}`);
    const name = clean(getByPath(item, nameField) ?? item?.display_name ?? item?.displayName ?? id);
    const rawGender = getByPath(item, genderField) ?? item?.description ?? "";
    const description = clean(getByPath(item, descriptionField) ?? item?.description ?? "");
    return id && name ? { id, name, voiceId: id, gender: normalizeGender(`${rawGender} ${description} ${name}`), description } : null;
  }).filter(Boolean);
}
export async function discoverGenericVoiceConnection(connection, timeoutMs = 120000) {
  const settings = connection.settings || {};
  let voices = Array.isArray(connection.voices) ? connection.voices : [];
  const baseUrl = stripSlash(connection.baseUrl);
  if (!baseUrl) throw new Error("Chưa nhập URL Voice server");

  if (connection.adapter === "openai-tts" && !clean(settings.voicesEndpoint)) {
    if (!voices.length) throw new Error("OpenAI-compatible TTS cần khai báo danh sách giọng thủ công hoặc Voices endpoint");
    return { voices, message: `${voices.length} giọng đã cấu hình` };
  }

  const endpoint = clean(settings.voicesEndpoint);
  if (endpoint) {
    const response = await fetchWithTimeout(joinUrl(baseUrl, endpoint), {
      method: "GET",
      headers: { Accept: "application/json", ...authHeaders(connection) },
    }, timeoutMs);
    const data = await jsonOrError(response);
    const discovered = mapVoices(data, connection);
    if (discovered.length) voices = discovered;
  }
  if (!voices.length) throw new Error("Không tải được danh sách giọng. Hãy nhập Voices endpoint hoặc khai báo giọng thủ công.");
  return { voices, message: `${voices.length} giọng khả dụng` };
}
function parseExtraJson(value) {
  const raw = clean(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error("Extra JSON không hợp lệ");
  }
}
async function readAudioResponse(response, connection) {
  const settings = connection.settings || {};
  if (!response.ok) {
    const raw = await response.text();
    let detail = raw;
    try {
      const data = JSON.parse(raw);
      detail = data?.detail || data?.error?.message || data?.error || data?.message || raw;
    } catch {}
    throw new Error(String(detail || `HTTP ${response.status}`).slice(0, 1600));
  }
  const mode = clean(settings.responseMode || "binary").toLowerCase();
  if (mode === "binary") {
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "audio/wav" };
  }
  const data = await response.json();
  const responsePath = clean(settings.responsePath);
  const value = getByPath(data, responsePath);
  if (mode === "json-base64") {
    if (!value) throw new Error(`Không tìm thấy dữ liệu base64 tại response path: ${responsePath || "(trống)"}`);
    return { buffer: Buffer.from(String(value).replace(/^data:audio\/[\w.+-]+;base64,/, ""), "base64"), contentType: "audio/wav" };
  }
  if (mode === "json-url") {
    if (!value) throw new Error(`Không tìm thấy URL audio tại response path: ${responsePath || "(trống)"}`);
    const audioResponse = await fetchWithTimeout(String(value), { headers: authHeaders(connection) }, 120000);
    if (!audioResponse.ok) throw new Error(`Không tải được audio URL: HTTP ${audioResponse.status}`);
    return { buffer: Buffer.from(await audioResponse.arrayBuffer()), contentType: audioResponse.headers.get("content-type") || "audio/wav" };
  }
  throw new Error(`Response mode chưa hỗ trợ: ${mode}`);
}
export async function generateGenericVoice(connection, { text, voice, filename }, timeoutMs = 600000) {
  const settings = connection.settings || {};
  const baseUrl = stripSlash(connection.baseUrl);
  if (!baseUrl) throw new Error("Chưa nhập URL Voice server");
  const headers = { "Content-Type": "application/json", Accept: "audio/*, application/json", ...authHeaders(connection) };
  let endpoint;
  let body;

  if (connection.adapter === "openai-tts") {
    endpoint = joinUrl(baseUrl, settings.ttsEndpoint || "/audio/speech");
    body = {
      model: clean(settings.ttsModel) || "tts-1",
      input: text,
      voice,
      response_format: clean(settings.audioFormat) || "wav",
      ...parseExtraJson(settings.extraJson),
    };
  } else {
    endpoint = joinUrl(baseUrl, settings.ttsEndpoint || "/tts");
    const textField = clean(settings.textField) || "text";
    const voiceField = clean(settings.voiceField) || "voice";
    const filenameField = clean(settings.filenameField) || "filename";
    body = { ...parseExtraJson(settings.extraJson) };
    body[textField] = text;
    body[voiceField] = voice;
    if (filenameField) body[filenameField] = filename || "speech.wav";
  }

  const response = await fetchWithTimeout(endpoint, { method: "POST", headers, body: JSON.stringify(body) }, timeoutMs);
  return readAudioResponse(response, connection);
}
export function registerVoiceBridge(app, { config, connectionStore }) {
  app.use("/__voice_bridge/:id", (req, res, next) => {
    const token = clean(req.headers["x-bridge-key"]);
    if (!config.voiceBridgeToken || token !== config.voiceBridgeToken) return res.status(401).json({ detail: "Invalid bridge key" });
    const connection = connectionStore.getRuntime(req.params.id);
    if (!connection || connection.category !== "voice" || connection.enabled === false) return res.status(404).json({ detail: "Voice connection not found" });
    req.voiceBridgeConnection = { ...connection, apiKey: clean(connection.secret?.apiKey) };
    return next();
  });

  app.get("/__voice_bridge/:id/api/health", (req, res) => res.json({ status: "ok", model_ready: true, bridge: true }));
  app.get("/__voice_bridge/:id/api/voices", (req, res) => {
    const voices = req.voiceBridgeConnection.voices || [];
    res.json({ count: voices.length, voices: voices.map((item) => ({ id: item.voiceId || item.id, name: item.name || item.id, description: `${item.gender || "Khác"}${item.description ? ` · ${item.description}` : ""}` })) });
  });
  app.post("/__voice_bridge/:id/api/tts", async (req, res, next) => {
    try {
      const result = await generateGenericVoice(req.voiceBridgeConnection, {
        text: clean(req.body?.text), voice: clean(req.body?.voice), filename: clean(req.body?.filename),
      }, config.vieneuTimeoutMs || 600000);
      res.setHeader("Content-Type", result.contentType || "audio/wav");
      res.setHeader("Content-Disposition", `attachment; filename="${clean(req.body?.filename) || "speech.wav"}"`);
      return res.send(result.buffer);
    } catch (error) {
      error.statusCode ||= 400;
      return next(error);
    }
  });
}
