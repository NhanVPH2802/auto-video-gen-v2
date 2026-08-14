import { readFile, writeFile } from "node:fs/promises";

function cleanString(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function titleFromId(id) {
  return String(id || "")
    .split("/")
    .pop()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.length <= 4 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePublisher(model, id) {
  const publisher = model?.publisher;
  if (typeof publisher === "string" && publisher.trim()) return publisher.trim();
  if (publisher && typeof publisher === "object") {
    return cleanString(publisher.name || publisher.display_name || publisher.id);
  }
  return String(id || "").split("/")[0] || "Khác";
}

function normalizeModalities(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : [];
}

function classifyModel(id) {
  const value = String(id || "").toLowerCase();
  if (/deepseek-r1|\/o1(?:-|$)|\/o3(?:-|$)|\/o4(?:-|$)|reasoning/.test(value)) return "reasoning";
  if (/vision|multimodal/.test(value)) return "vision";
  if (/codestral|coder|code/.test(value)) return "code";
  return "general";
}

function recommendationScore(detail) {
  let score = 0;
  if (detail.rateLimitTier === "low") score += 35;
  else if (detail.rateLimitTier === "high") score += 20;
  else if (detail.rateLimitTier === "custom") score -= 10;
  if (/mini|nano|small|instruct|chat|command/i.test(detail.id)) score += 15;
  if (detail.kind === "general") score += 12;
  if (detail.kind === "code") score += 2;
  if (detail.kind === "vision") score -= 5;
  if (detail.kind === "reasoning") score -= 15;
  if ((detail.maxInputTokens || 0) >= 128000) score += 5;
  if ((detail.maxOutputTokens || 0) >= 16000) score += 5;
  if ((detail.maxOutputTokens || 0) < 4096) score -= 15;
  return score;
}

function normalizeModel(model) {
  const id = cleanString(model?.id || model?.name);
  if (!id || !id.includes("/")) return null;
  const outputModalities = normalizeModalities(
    model?.supported_output_modalities || model?.supportedOutputModalities || model?.output_modalities,
  );
  if (outputModalities.length && !outputModalities.includes("text")) return null;
  const inputModalities = normalizeModalities(
    model?.supported_input_modalities || model?.supportedInputModalities || model?.input_modalities,
  );
  const limits = model?.limits && typeof model.limits === "object" ? model.limits : {};
  const detail = {
    id,
    name: cleanString(model?.display_name || model?.displayName || model?.friendly_name || model?.friendlyName || titleFromId(id)),
    publisher: normalizePublisher(model, id),
    summary: cleanString(model?.summary || model?.description),
    rateLimitTier: cleanString(model?.rate_limit_tier || model?.rateLimitTier || "unknown").toLowerCase(),
    maxInputTokens: cleanNumber(limits.max_input_tokens ?? limits.maxInputTokens ?? model?.max_input_tokens),
    maxOutputTokens: cleanNumber(limits.max_output_tokens ?? limits.maxOutputTokens ?? model?.max_output_tokens),
    inputModalities,
    outputModalities: outputModalities.length ? outputModalities : ["text"],
    kind: classifyModel(id),
  };
  detail.score = recommendationScore(detail);
  detail.recommended = detail.score >= 45;
  return detail;
}

function tierRank(tier) {
  return { low: 0, high: 1, custom: 2, unknown: 3 }[tier] ?? 3;
}

function sortModels(models) {
  return [...models].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
    const tierDifference = tierRank(a.rateLimitTier) - tierRank(b.rateLimitTier);
    if (tierDifference) return tierDifference;
    const publisherDifference = a.publisher.localeCompare(b.publisher, "vi");
    if (publisherDifference) return publisherDifference;
    return a.id.localeCompare(b.id, "en");
  });
}

async function readCache(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(parsed.models)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(file, payload) {
  try {
    await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  } catch {
    // Cache is optional; catalog results still remain available in memory.
  }
}

function applyCatalog(config, payload, meta = {}) {
  const provider = config.providers.find((item) => item.id === "github");
  if (!provider) return null;
  const normalized = sortModels((payload.models || []).map(normalizeModel).filter(Boolean));
  const detailsById = new Map(normalized.map((model) => [model.id, model]));
  for (const id of provider.models || []) {
    if (detailsById.has(id)) continue;
    detailsById.set(id, {
      id,
      name: titleFromId(id),
      publisher: String(id).split("/")[0] || "Khác",
      summary: "Model được khai báo thủ công trong .env.local.",
      rateLimitTier: "unknown",
      maxInputTokens: null,
      maxOutputTokens: null,
      inputModalities: ["text"],
      outputModalities: ["text"],
      kind: classifyModel(id),
      score: 0,
      recommended: false,
      configured: true,
    });
  }
  const details = sortModels([...detailsById.values()]);
  const previousDefault = provider.defaultModel;
  provider.modelDetails = details;
  provider.models = details.map((model) => model.id);
  provider.defaultModel = provider.models.includes(previousDefault)
    ? previousDefault
    : details.find((model) => model.recommended)?.id || provider.models[0] || previousDefault;
  provider.available = Boolean(provider.apiKey && provider.endpoint && provider.models.length);
  provider.catalog = {
    enabled: config.githubCatalogEnabled,
    source: meta.source || "network",
    loadedAt: payload.loadedAt || new Date().toISOString(),
    count: normalized.length,
    totalCount: details.length,
    stale: Boolean(meta.stale),
    error: meta.error || "",
  };
  return provider.catalog;
}

export async function refreshGitHubCatalog(config, options = {}) {
  const force = Boolean(options.force);
  const provider = config.providers.find((item) => item.id === "github");
  if (!provider || !provider.apiKey || !config.githubCatalogEnabled) {
    if (provider) provider.catalog = {
      enabled: false,
      source: "static",
      loadedAt: null,
      count: 0,
      totalCount: provider.models.length,
      stale: false,
      error: config.githubCatalogEnabled ? "Thiếu GitHub token" : "Đã tắt trong cấu hình",
    };
    return provider?.catalog || null;
  }

  const cached = await readCache(config.githubCatalogCacheFile);
  const cachedAt = cached?.loadedAt ? Date.parse(cached.loadedAt) : 0;
  const cacheFresh = cachedAt && Date.now() - cachedAt < config.githubCatalogTtlMs;
  if (!force && cacheFresh) return applyCatalog(config, cached, { source: "cache" });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(config.aiRequestTimeoutMs, 120000));
    let response;
    try {
      response = await fetch(config.githubCatalogUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${provider.apiKey}`,
          "X-GitHub-Api-Version": provider.apiVersion,
          "User-Agent": "auto-video-gen-dashboard/1.8",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const raw = await response.text();
    if (!response.ok) throw new Error(`GitHub Catalog HTTP ${response.status}: ${raw.slice(0, 500)}`);
    const data = JSON.parse(raw);
    const models = Array.isArray(data) ? data : Array.isArray(data?.models) ? data.models : [];
    if (!models.length) throw new Error("GitHub Catalog không trả về danh sách model");
    const payload = { loadedAt: new Date().toISOString(), models };
    await writeCache(config.githubCatalogCacheFile, payload);
    return applyCatalog(config, payload, { source: "network" });
  } catch (error) {
    if (cached?.models?.length) {
      return applyCatalog(config, cached, { source: "cache", stale: true, error: error.message });
    }
    provider.catalog = {
      enabled: true,
      source: "static",
      loadedAt: null,
      count: 0,
      totalCount: provider.models.length,
      stale: false,
      error: error.message,
    };
    return provider.catalog;
  }
}
