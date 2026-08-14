const CACHE_TTL_MS = 60_000;
const cache = new Map();

function clean(value) { return String(value ?? "").trim(); }
function normalizeGender(value) {
  const raw = clean(value).toLocaleLowerCase("vi");
  if (raw.includes("nữ") || raw.includes("female") || /(^|[^a-z])nu([^a-z]|$)/.test(raw)) return "Nữ";
  if (raw.includes("nam") || raw.includes("male")) return "Nam";
  return "Khác";
}
function joinUrl(base, pathname) { return `${clean(base).replace(/\/+$/, "")}${pathname}`; }

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const detail = data?.detail || data?.error || data?.message || data?.raw || `HTTP ${response.status}`;
      throw new Error(String(detail));
    }
    return data;
  } finally { clearTimeout(timer); }
}

function publicVoice(voice) {
  return { id: voice.id, name: voice.name, gender: voice.gender || "Khác", description: voice.description || "" };
}

async function fetchVieNeuConnectionVoices(config, connection, { refresh = false } = {}) {
  const cached = cache.get(connection.id);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (!connection.baseUrl || !connection.apiKey) return { ready: false, error: "Thiếu URL hoặc API key", voices: [] };
  const headers = { [connection.apiHeader || "x-api-key"]: connection.apiKey };
  try {
    const [health, data] = await Promise.all([
      requestJson(joinUrl(connection.baseUrl, "/api/health"), { headers }, config.vieneuTimeoutMs).catch(() => ({})),
      requestJson(joinUrl(connection.baseUrl, "/api/voices"), { headers }, config.vieneuTimeoutMs),
    ]);
    const list = Array.isArray(data) ? data : Array.isArray(data?.voices) ? data.voices : [];
    const voices = list.map((voice) => {
      const id = clean(voice?.id || voice?.name);
      const name = clean(voice?.name || voice?.id);
      const description = clean(voice?.description);
      return id && name ? { id, name, voiceId: id, gender: normalizeGender(`${description} ${name}`), description } : null;
    }).filter(Boolean);
    const value = {
      ready: voices.length > 0 && health?.model_ready !== false,
      error: voices.length ? (health?.model_ready === false ? "Model VieNeu chưa sẵn sàng" : "") : "VieNeu-TTS không trả về danh sách giọng",
      voices,
      modelReady: health?.model_ready !== false,
      gradioOnline: health?.gradio_online !== false,
    };
    cache.set(connection.id, { at: Date.now(), value });
    return value;
  } catch (error) {
    const value = { ready: false, error: `Không tải được giọng: ${error.message}`, voices: [] };
    cache.set(connection.id, { at: Date.now(), value });
    return value;
  }
}

export async function getPublicTtsConfig(config, { refresh = false } = {}) {
  const sources = [];
  for (const connection of config.voiceConnections || []) {
    if (connection.enabled === false) continue;
    if (connection.adapter === "vieneu") {
      const state = await fetchVieNeuConnectionVoices(config, connection, { refresh });
      const preferred = state.voices.find((voice) => voice.id === connection.defaultVoice)
        || state.voices.find((voice) => voice.name === connection.defaultVoice)
        || state.voices[0];
      sources.push({
        id: connection.id,
        adapter: "vieneu",
        label: connection.name,
        ready: state.ready,
        error: state.error,
        status: state.ready ? `Sẵn sàng · ${state.voices.length} giọng` : state.error,
        voices: state.voices.map(publicVoice),
        defaultVoiceKey: preferred?.id || "",
      });
    } else if (["lucylab", "openai-tts", "custom-voice"].includes(connection.adapter)) {
      const voices = (connection.voices || []).map((voice) => ({
        id: voice.id,
        name: voice.name,
        gender: voice.gender || "Khác",
        description: voice.description || (connection.adapter === "lucylab" ? "Giọng LucyLab đã cấu hình" : "Giọng Voice server đã cấu hình"),
      }));
      const keyRequired = connection.adapter === "lucylab";
      const ready = Boolean(connection.baseUrl && voices.length && (!keyRequired || connection.apiKey));
      sources.push({
        id: connection.id,
        adapter: connection.adapter,
        label: connection.name,
        ready,
        error: ready ? "" : "Thiếu URL/API key hoặc danh sách giọng",
        status: ready ? `Sẵn sàng · ${voices.length} giọng` : "Chưa sẵn sàng",
        voices,
        defaultVoiceKey: connection.defaultVoice || voices[0]?.id || "",
      });
    }
  }
  const readySources = sources.filter((source) => source.ready && source.voices.length);
  const requested = clean(config.ttsDefaultConnectionId);
  const defaultTtsProvider = readySources.some((source) => source.id === requested) ? requested : readySources[0]?.id || sources[0]?.id || "";
  return { ttsSources: sources, defaultTtsProvider };
}

export async function resolveVoice(config, connectionId, voiceKey) {
  const connection = (config.voiceConnections || []).find((item) => item.id === clean(connectionId));
  if (!connection) throw new Error("Nguồn giọng đã bị xóa hoặc chưa được cấu hình");
  let voices = connection.voices || [];
  if (connection.adapter === "vieneu") {
    const state = await fetchVieNeuConnectionVoices(config, connection, { refresh: true });
    if (!state.ready) throw new Error(state.error || "VieNeu-TTS chưa sẵn sàng");
    voices = state.voices;
  }
  const key = clean(voiceKey || connection.defaultVoice);
  const voice = voices.find((item) => item.id === key)
    || voices.find((item) => item.name === key)
    || voices[0];
  if (!voice) throw new Error(`Nguồn ${connection.name} không có giọng phù hợp`);
  return {
    connection,
    key: voice.id,
    voiceId: voice.voiceId || voice.id,
    name: voice.name,
    gender: voice.gender || "Khác",
    description: voice.description || "",
  };
}
