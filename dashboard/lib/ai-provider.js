import { resolveProviderSelection } from "./config.js";

const TRANSIENT_HTTP_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

function extractOpenAiText(data) {
  const message = data?.choices?.[0]?.message;
  let text = normalizeContent(message?.content);
  if (!text && Array.isArray(message?.tool_calls)) {
    text = message.tool_calls
      .map((call) => call?.function?.arguments)
      .filter((value) => typeof value === "string")
      .join("\n");
  }
  return {
    text: String(text || "").trim(),
    finishReason: data?.choices?.[0]?.finish_reason || "unknown",
  };
}

function extractAnthropicText(data) {
  const text = Array.isArray(data?.content)
    ? data.content.map((part) => part?.type === "text" ? part.text : "").filter(Boolean).join("\n")
    : "";
  return { text: text.trim(), finishReason: data?.stop_reason || "unknown" };
}

function extractGeminiText(data) {
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n") || "";
  return { text: text.trim(), finishReason: data?.candidates?.[0]?.finishReason || "unknown" };
}

function valueAtPath(root, rawPath) {
  const path = String(rawPath || "").trim();
  if (!path) return root;
  const tokens = path.replace(/\[(\d+)\]/g, ".$1").split(".").map((item) => item.trim()).filter(Boolean);
  let value = root;
  for (const token of tokens) {
    if (value == null) return undefined;
    value = value[/^\d+$/.test(token) ? Number(token) : token];
  }
  return value;
}

function parseExtraObject(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Extra Request JSON phải là JSON object");
  return value;
}

function normalizeParsedValue(value) {
  if (typeof value === "string") {
    const nested = value.trim();
    if (nested.startsWith("{") || nested.startsWith("[")) return normalizeParsedValue(JSON.parse(nested));
  }
  if (Array.isArray(value) && value.length === 1 && value[0] && typeof value[0] === "object") return value[0];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON nhận được không phải object");
  return value;
}

function parseCandidate(candidate) {
  const text = String(candidate || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("JSON rỗng");
  try {
    return normalizeParsedValue(JSON.parse(text));
  } catch (firstError) {
    const repaired = text
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");
    if (repaired !== text) return normalizeParsedValue(JSON.parse(repaired));
    throw firstError;
  }
}

function collectBalancedObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth += 1; continue; }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) { objects.push(text.slice(start, index + 1)); start = -1; }
    }
  }
  return objects;
}

export function findJsonObject(input) {
  const original = String(input || "").replace(/^\uFEFF/, "").trim();
  if (!original) throw new Error("AI trả về nội dung rỗng");
  const cleaned = original
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();
  const candidates = [cleaned];
  for (const match of cleaned.matchAll(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
  candidates.push(...collectBalancedObjects(cleaned));
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));

  const seen = new Set();
  const failures = [];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    try { return parseCandidate(normalized); } catch (error) { failures.push(error.message); }
  }
  const error = new Error("AI không trả về JSON hợp lệ");
  error.parseFailures = failures.slice(0, 8);
  error.aiRaw = original;
  throw error;
}

function parseRetryAfterMs(response, attempt, maxWaitMs) {
  const retryAfter = response.headers.get("retry-after");
  let delayMs = 0;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) delayMs = Math.max(0, seconds * 1000);
    else {
      const retryDate = Date.parse(retryAfter);
      if (Number.isFinite(retryDate)) delayMs = Math.max(0, retryDate - Date.now());
    }
  }
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  if (!delayMs && Number.isFinite(reset) && reset > 0) delayMs = Math.max(0, reset * 1000 - Date.now());
  if (!delayMs) delayMs = Math.min(15000 * attempt, 60000);
  return Math.min(delayMs, Math.max(0, maxWaitMs));
}

async function postJson(url, headers, body, timeoutMs, rateLimitMaxWaitMs = 60000) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "auto-video-gen-dashboard/2.0-preview2.4", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        const error = new Error(`AI API HTTP ${response.status}: ${raw.slice(0, 1600)}`);
        error.httpStatus = response.status;
        error.apiRaw = raw;
        error.retryAfter = response.headers.get("retry-after") || "";
        error.rateLimitRemaining = response.headers.get("x-ratelimit-remaining") || "";
        const retryLimit = response.status === 429 ? 2 : 3;
        if (TRANSIENT_HTTP_CODES.has(response.status) && attempt < retryLimit) {
          lastError = error;
          const delayMs = response.status === 429
            ? parseRetryAfterMs(response, attempt, rateLimitMaxWaitMs)
            : 1200 * attempt;
          if (delayMs > 0) await wait(delayMs);
          continue;
        }
        throw error;
      }
      let data;
      try { data = JSON.parse(raw); } catch {
        const error = new Error(`AI API trả về dữ liệu không phải JSON: ${raw.slice(0, 800)}`);
        error.apiRaw = raw;
        throw error;
      }
      return { data, raw };
    } catch (error) {
      lastError = error;
      if (error?.name === "AbortError" && attempt < 3) {
        await wait(1200 * attempt);
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Không gọi được AI API");
}

async function requestOpenAi(provider, model, systemPrompt, userPrompt, strictRetry, config) {
  const baseBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: strictRetry ? 0.05 : 0.2,
    max_tokens: config.aiMaxTokens,
    stream: false,
  };
  const headers = provider.adapter === "github-models"
    ? { Accept: "application/vnd.github+json", Authorization: `Bearer ${provider.apiKey}`, "X-GitHub-Api-Version": provider.apiVersion }
    : provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {};
  try {
    const result = await postJson(provider.endpoint, headers, { ...baseBody, response_format: { type: "json_object" } }, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
    return extractOpenAiText(result.data);
  } catch (error) {
    if (![400, 422].includes(error?.httpStatus)) throw error;
    const result = await postJson(provider.endpoint, headers, baseBody, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
    return extractOpenAiText(result.data);
  }
}

async function requestAnthropic(provider, model, systemPrompt, userPrompt, strictRetry, config) {
  const result = await postJson(provider.endpoint, {
    "x-api-key": provider.apiKey,
    "anthropic-version": provider.apiVersion,
  }, {
    model,
    max_tokens: config.aiMaxTokens,
    temperature: strictRetry ? 0.05 : 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  }, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
  return extractAnthropicText(result.data);
}

async function requestCustomAi(provider, model, systemPrompt, userPrompt, strictRetry, config) {
  const custom = provider.custom || {};
  const body = parseExtraObject(custom.extraJson);
  const modelField = custom.modelField || "model";
  body[modelField] = model;
  if ((custom.requestMode || "messages") === "prompt") {
    body[custom.promptField || "prompt"] = `${systemPrompt}\n\n${userPrompt}`;
  } else {
    body[custom.messagesField || "messages"] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];
  }
  const headers = {};
  if (provider.apiKey) {
    const header = custom.apiHeader || "Authorization";
    const prefix = custom.authPrefix === undefined ? "Bearer " : custom.authPrefix;
    headers[header] = `${prefix}${provider.apiKey}`;
  }
  const result = await postJson(provider.endpoint, headers, body, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
  const value = valueAtPath(result.data, custom.responsePath || "choices.0.message.content");
  return {
    text: normalizeContent(value).trim(),
    finishReason: String(valueAtPath(result.data, "choices.0.finish_reason") || result.data?.finishReason || "unknown"),
  };
}

async function requestGemini(provider, model, systemPrompt, userPrompt, strictRetry, config) {
  const normalizedModel = model.replace(/^models\//, "");
  const url = `${provider.endpoint}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
  const baseBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
      temperature: strictRetry ? 0.05 : 0.2,
      maxOutputTokens: config.aiMaxTokens,
      responseMimeType: "application/json",
    },
  };
  try {
    const result = await postJson(url, { "x-goog-api-key": provider.apiKey }, baseBody, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
    return extractGeminiText(result.data);
  } catch (error) {
    if (![400, 422].includes(error?.httpStatus)) throw error;
    delete baseBody.generationConfig.responseMimeType;
    const result = await postJson(url, { "x-goog-api-key": provider.apiKey }, baseBody, config.aiRequestTimeoutMs, config.aiRateLimitMaxWaitMs);
    return extractGeminiText(result.data);
  }
}

export class AiProvider {
  constructor(config, providerId, model) {
    this.config = config;
    const selection = resolveProviderSelection(config, providerId, model);
    this.provider = selection.provider;
    this.model = selection.model;
  }

  async request(systemPrompt, userPrompt, strictRetry = false) {
    let result;
    if (this.provider.kind === "anthropic-messages") {
      result = await requestAnthropic(this.provider, this.model, systemPrompt, userPrompt, strictRetry, this.config);
    } else if (this.provider.kind === "gemini-generate-content") {
      result = await requestGemini(this.provider, this.model, systemPrompt, userPrompt, strictRetry, this.config);
    } else if (this.provider.kind === "custom-rest") {
      result = await requestCustomAi(this.provider, this.model, systemPrompt, userPrompt, strictRetry, this.config);
    } else {
      result = await requestOpenAi(this.provider, this.model, systemPrompt, userPrompt, strictRetry, this.config);
    }
    if (!result.text) {
      const error = new Error(`${this.provider.label} không trả về nội dung`);
      error.finishReason = result.finishReason;
      throw error;
    }
    return result;
  }

  async generate(systemPrompt, userPrompt) {
    let first;
    try {
      first = await this.request(systemPrompt, userPrompt, false);
      return findJsonObject(first.text);
    } catch (firstError) {
      if (firstError?.httpStatus && ![400, 422].includes(firstError.httpStatus)) throw firstError;
      const strictPrompt = `${userPrompt}\n\nLần trả lời trước không tạo được JSON hợp lệ. Hãy tạo lại từ đầu. Chỉ xuất đúng MỘT JSON object hoàn chỉnh; không Markdown, không code fence, không lời dẫn, không phần suy luận. Bắt đầu bằng { và kết thúc bằng }.`;
      try {
        const second = await this.request(systemPrompt, strictPrompt, true);
        return findJsonObject(second.text);
      } catch (secondError) {
        const raw = secondError?.aiRaw || firstError?.aiRaw || first?.text || secondError?.apiRaw || firstError?.apiRaw || "";
        const error = new Error(`${this.provider.label} / ${this.model} không trả về JSON hợp lệ sau 2 lần thử`);
        error.aiRaw = String(raw).slice(0, 50000);
        error.providerId = this.provider.id;
        error.model = this.model;
        error.cause = secondError;
        throw error;
      }
    }
  }
}

export async function generateWithFallback(config, selection, systemPrompt, userPrompt, onEvent = async () => {}) {
  const attempts = [{ providerId: selection.providerId, model: selection.model, fallback: false }];
  if (selection.fallbackEnabled && selection.fallbackProviderId && selection.fallbackModel) {
    const isDuplicate = selection.providerId === selection.fallbackProviderId && selection.model === selection.fallbackModel;
    if (!isDuplicate) attempts.push({ providerId: selection.fallbackProviderId, model: selection.fallbackModel, fallback: true });
  }

  let lastError;
  for (const attempt of attempts) {
    const provider = new AiProvider(config, attempt.providerId, attempt.model);
    try {
      await onEvent({ type: "start", ...attempt, label: provider.provider.label });
      const draft = await provider.generate(systemPrompt, userPrompt);
      await onEvent({ type: "success", ...attempt, label: provider.provider.label });
      return { draft, providerId: attempt.providerId, model: attempt.model, fallbackUsed: attempt.fallback };
    } catch (error) {
      lastError = error;
      await onEvent({ type: "error", ...attempt, label: provider.provider.label, error });
      if (!attempt.fallback && attempts.length > 1) continue;
      throw error;
    }
  }
  throw lastError || new Error("Không có nguồn AI khả dụng");
}
