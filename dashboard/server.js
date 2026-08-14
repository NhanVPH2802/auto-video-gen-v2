import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import multer from "multer";
import {
  getProvider,
  getPublicAppConfig,
  loadConfig,
  resolveProviderSelection,
  validateJobConfig,
} from "./lib/config.js";
import { JobStore } from "./lib/store.js";
import { ensureInputDirectories } from "./lib/input-reader.js";
import { JobWorker } from "./lib/worker.js";
import { getPublicTtsConfig, resolveVoice } from "./lib/vieneu-provider.js";
import { ConnectionStore } from "./lib/connection-store.js";
import {
  applyConnectionsToConfig,
  bootstrapConnectionsFromLegacyConfig,
  normalizeConnectionInput,
  testAndRefreshConnection,
} from "./lib/connection-manager.js";
import { registerVoiceBridge } from "./lib/voice-bridge.js";

const config = loadConfig();
await ensureInputDirectories(config);
await mkdir(config.downloadDir, { recursive: true });
const connectionStore = new ConnectionStore({ filePath: config.connectionsFile, keyPath: config.masterKeyFile });
await connectionStore.init(bootstrapConnectionsFromLegacyConfig(config));

function refreshRuntimeConfig() {
  applyConnectionsToConfig(config, connectionStore.listRuntime());
  return config;
}
refreshRuntimeConfig();

function currentPublicConfig() {
  refreshRuntimeConfig();
  return getPublicAppConfig(config);
}

const store = new JobStore(config.jobsFile);
await store.init();
config.voiceBridgeToken = crypto.randomBytes(32).toString("hex");
const worker = new JobWorker(config, store);
worker.start();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
registerVoiceBridge(app, { config, connectionStore });

function basicAuth(req, res, next) {
  if (!config.dashboardUsername) return next();
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    const username = separator >= 0 ? decoded.slice(0, separator) : decoded;
    const password = separator >= 0 ? decoded.slice(separator + 1) : "";
    const userExpected = Buffer.from(config.dashboardUsername);
    const userActual = Buffer.from(username);
    const userOk = userExpected.length === userActual.length && crypto.timingSafeEqual(userActual, userExpected);
    const passExpected = Buffer.from(config.dashboardPassword);
    const passActual = Buffer.from(password);
    const passOk = passExpected.length === passActual.length && crypto.timingSafeEqual(passActual, passExpected);
    if (userOk && passOk) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Auto Video Gen"');
  return res.status(401).send("Authentication required");
}

app.use(basicAuth);
app.use(express.static(path.join(import.meta.dirname, "public")));
app.use("/downloads", express.static(config.downloadDir, {
  fallthrough: false,
  dotfiles: "deny",
  index: false,
  maxAge: "1h",
}));

const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: config.maxUploadBytes, files: 3 },
  fileFilter: (_req, file, callback) => {
    const documentTypes = new Set([".txt", ".md", ".pdf", ".docx", ".doc", ".odt", ".rtf", ".html", ".htm", ".csv", ".json"]);
    const imageTypes = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ["brandLogo", "profileAvatar"].includes(file.fieldname) ? imageTypes : documentTypes;
    callback(allowed.has(ext) ? null : new Error(`Không hỗ trợ file ${ext || "không có phần mở rộng"} cho ${file.fieldname}`), allowed.has(ext));
  },
});

const uploadJobFiles = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "brandLogo", maxCount: 1 },
  { name: "profileAvatar", maxCount: 1 },
]);

app.get("/api/config", async (req, res, next) => {
  try {
    const refreshVoices = String(req.query.refresh || "") === "1";
    const refreshModels = String(req.query.refreshModels || "") === "1";
    if (refreshModels) {
      const ai = connectionStore.listRuntime().filter((item) => item.category === "ai" && item.enabled !== false);
      await Promise.allSettled(ai.map((item) => testAndRefreshConnection(connectionStore, item.id, config.aiRequestTimeoutMs)));
    }
    if (refreshVoices) {
      const voices = connectionStore.listRuntime().filter((item) => item.category === "voice" && item.enabled !== false);
      await Promise.allSettled(voices.map((item) => testAndRefreshConnection(connectionStore, item.id, Math.min(config.vieneuTimeoutMs, 120000))));
    }
    refreshRuntimeConfig();
    const tts = await getPublicTtsConfig(config, { refresh: refreshVoices });
    res.json({ ...currentPublicConfig(), ...tts, connections: connectionStore.listPublic() });
  } catch (error) { next(error); }
});

app.get("/api/connections", (_req, res) => {
  refreshRuntimeConfig();
  res.json({ connections: connectionStore.listPublic() });
});

app.post("/api/connections", async (req, res, next) => {
  try {
    const input = normalizeConnectionInput(req.body || {});
    if (!input.name) return res.status(400).json({ error: "Chưa nhập tên kết nối" });
    const saved = await connectionStore.upsert(input);
    refreshRuntimeConfig();
    return res.status(201).json({ connection: connectionStore.listPublic().find((item) => item.id === saved.id) });
  } catch (error) { return next(error); }
});

app.put("/api/connections/:id", async (req, res, next) => {
  try {
    const existing = connectionStore.getRuntime(req.params.id);
    if (!existing) return res.status(404).json({ error: "Không tìm thấy kết nối" });
    const input = normalizeConnectionInput({ ...req.body, id: req.params.id }, existing);
    await connectionStore.upsert(input);
    refreshRuntimeConfig();
    return res.json({ connection: connectionStore.listPublic().find((item) => item.id === req.params.id) });
  } catch (error) { return next(error); }
});

app.delete("/api/connections/:id", async (req, res, next) => {
  try {
    const removed = await connectionStore.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: "Không tìm thấy kết nối" });
    refreshRuntimeConfig();
    return res.status(204).end();
  } catch (error) { return next(error); }
});

app.post("/api/connections/:id/test", async (req, res, next) => {
  try {
    await testAndRefreshConnection(connectionStore, req.params.id, Math.max(30000, Math.min(config.vieneuTimeoutMs, 120000)));
    refreshRuntimeConfig();
    return res.json({ connection: connectionStore.listPublic().find((item) => item.id === req.params.id) });
  } catch (error) {
    refreshRuntimeConfig();
    error.statusCode ||= 400;
    return next(error);
  }
});

app.get("/api/health", async (_req, res, next) => {
  try {
    refreshRuntimeConfig();
    const issues = validateJobConfig(config);
    const tts = await getPublicTtsConfig(config);
    const readyTts = tts.ttsSources.filter((source) => source.ready && source.voices.length);
    if (!readyTts.length) issues.push("Không có nguồn giọng nào sẵn sàng");
    const defaultProvider = getProvider(config, config.defaultProvider);
    res.json({
      ok: issues.length === 0,
      issues,
      aiProvider: defaultProvider?.label || config.defaultProvider || "Chưa cấu hình",
      aiModel: defaultProvider?.defaultModel || "",
      providerCount: config.availableProviders.length,
      connectionCount: connectionStore.listPublic().filter((item) => item.enabled).length,
      providers: currentPublicConfig().providers,
      ttsProviderCount: readyTts.length,
      ttsSources: tts.ttsSources.map((source) => ({ id: source.id, label: source.label, ready: source.ready, status: source.status || source.error || "" })),
      baseRepoDir: config.baseRepoDir,
      downloadDir: config.downloadDir,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/jobs", (_req, res) => res.json(store.list()));

app.get("/api/jobs/:id", (req, res) => {
  const job = store.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
  return res.json(job);
});

app.get("/api/jobs/:id/source", async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    const result = { sourceType: job.sourceType || "url", url: job.sourceUrl || "", text: "", inputName: job.inputName || "" };
    if (job.sourceType === "text" && job.inputPath) {
      try { result.text = await readFile(job.inputPath, "utf8"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    return res.json(result);
  } catch (error) { return next(error); }
});

function jobOutputDir(jobId) {
  return path.join(config.baseRepoDir, "output", `dashboard-${jobId}`);
}

function countScriptWords(script) {
  return (script?.scenes || []).reduce((sum, scene) => sum + String(scene?.voiceText || "").trim().split(/\s+/).filter(Boolean).length, 0);
}

app.get("/api/jobs/:id/script", async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    const scriptPath = path.join(jobOutputDir(job.id), "script.json");
    const script = JSON.parse(await readFile(scriptPath, "utf8"));
    return res.json({ jobId: job.id, script, wordCount: countScriptWords(script) });
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(404).json({ error: "Tác vụ chưa có script.json để chỉnh sửa" });
    return next(error);
  }
});

app.put("/api/jobs/:id/script", async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    if (job.status === "running") return res.status(409).json({ error: "Không thể sửa khi tác vụ đang chạy" });
    const incoming = req.body?.script;
    if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.scenes)) {
      return res.status(400).json({ error: "Kịch bản không hợp lệ: thiếu mảng scenes" });
    }
    if (incoming.scenes.length < 2 || incoming.scenes.length > 18) {
      return res.status(400).json({ error: "Kịch bản phải có từ 2 đến 18 cảnh" });
    }
    for (const [index, scene] of incoming.scenes.entries()) {
      if (!String(scene?.voiceText || "").trim()) return res.status(400).json({ error: `Cảnh ${index + 1} chưa có lời đọc` });
      if (!scene?.templateData || typeof scene.templateData !== "object") return res.status(400).json({ error: `Cảnh ${index + 1} thiếu nội dung hiển thị` });
    }

    const outputDir = jobOutputDir(job.id);
    const scriptPath = path.join(outputDir, "script.json");
    const previous = JSON.parse(await readFile(scriptPath, "utf8"));
    const voiceChanged = incoming.scenes.length !== previous.scenes?.length || incoming.scenes.some((scene, index) =>
      String(scene.voiceText || "").trim() !== String(previous.scenes?.[index]?.voiceText || "").trim());
    await writeFile(scriptPath, JSON.stringify(incoming, null, 2), "utf8");
    await writeFile(path.join(outputDir, "manual-edit.json"), JSON.stringify({ editedAt: new Date().toISOString(), voiceChanged }, null, 2), "utf8");

    if (voiceChanged) {
      await rm(path.join(outputDir, "voice"), { recursive: true, force: true });
      await rm(path.join(outputDir, "voice.mp3"), { force: true });
      await rm(path.join(outputDir, "voice-raw.mp3"), { force: true });
      await rm(path.join(outputDir, "tts-duration.json"), { force: true });
    }
    await rm(path.join(outputDir, "video.mp4"), { force: true });

    const updated = await store.update(job.id, {
      status: "script_ready",
      progress: 50,
      stage: voiceChanged ? "Đã lưu kịch bản; chờ Render và tạo giọng mới" : "Đã lưu kịch bản; chờ Render",
      error: null,
      completedAt: null,
      outputFiles: [],
      downloadKey: null,
      forceRetts: false,
      resumeFromScript: false,
      taskMode: "script",
      manualEdit: true,
      scriptApproved: false,
      scriptApprovedAt: null,
      workflowStep: "script_review",
      stage: "Đã lưu thay đổi; cần chốt lại kịch bản",
      scriptWordCount: countScriptWords(incoming),
    });
    return res.json(updated);
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(404).json({ error: "Không tìm thấy script.json của tác vụ" });
    return next(error);
  }
});

function boolForm(value) {
  return ["1", "true", "on", "yes"].includes(String(value || "").toLowerCase());
}

function validateChoice(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

app.post("/api/jobs", uploadJobFiles, async (req, res, next) => {
  try {
    const sourceMode = String(req.body.sourceMode || "url");
    const renderProfile = ["fast", "balanced", "quality"].includes(String(req.body.renderProfile || "balanced"))
      ? String(req.body.renderProfile || "balanced") : "balanced";
    const durationMode = String(req.body.duration || "60");
    const durationSec = durationMode === "custom" ? Number(req.body.customDuration) : Number(durationMode);
    if (!Number.isFinite(durationSec) || durationSec < 30 || durationSec > 240) {
      const error = new Error("Thời lượng phải từ 30 đến 240 giây");
      error.statusCode = 400;
      throw error;
    }

    refreshRuntimeConfig();
    const ttsPublic = await getPublicTtsConfig(config);
    const requestedTtsConnectionId = String(req.body.ttsProvider || ttsPublic.defaultTtsProvider || config.ttsDefaultConnectionId || "").trim();
    if (!requestedTtsConnectionId) throw Object.assign(new Error("Chưa chọn nguồn giọng đọc"), { statusCode: 400 });
    const selectedVoice = await resolveVoice(config, requestedTtsConnectionId, String(req.body.voiceKey || "").trim());
    const requestedTtsProvider = selectedVoice.connection.adapter;
    const ttsProviderLabel = selectedVoice.connection.name;

    const primary = resolveProviderSelection(config, String(req.body.aiProvider || config.defaultProvider), String(req.body.aiModel || ""));
    const fallbackEnabled = false;

    const appPublicConfig = currentPublicConfig();
    const styleIds = new Set(appPublicConfig.contentStyles.map((item) => item.id));
    const detailIds = new Set(appPublicConfig.detailLevels.map((item) => item.id));
    const audienceIds = new Set(appPublicConfig.audiences.map((item) => item.id));
    const contentStyle = validateChoice(String(req.body.contentStyle || "summary"), styleIds, "summary");
    const detailLevel = validateChoice(String(req.body.detailLevel || "balanced"), detailIds, "balanced");
    const audience = validateChoice(String(req.body.audience || "general"), audienceIds, "general");
    const styleOptions = {
      numberedSteps: boolForm(req.body.numberedSteps),
      includeWarnings: boolForm(req.body.includeWarnings),
      includeVerification: boolForm(req.body.includeVerification),
      showTerminalCommands: boolForm(req.body.showTerminalCommands),
      emphasizeBenefits: boolForm(req.body.emphasizeBenefits),
      includeCta: boolForm(req.body.includeCta),
      compareAlternatives: boolForm(req.body.compareAlternatives),
    };

    const id = `${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
    const uploadedFiles = req.files || {};
    const sourceUpload = uploadedFiles.file?.[0] || null;
    const persistBrandImage = async (uploaded, suffix) => {
      if (!uploaded) return "";
      const ext = path.extname(uploaded.originalname).toLowerCase();
      const target = path.join(config.inputDir, `${id}-${suffix}${ext}`);
      await rename(uploaded.path, target);
      return target;
    };
    const brandLogoPath = await persistBrandImage(uploadedFiles.brandLogo?.[0], "logo");
    const profileAvatarPath = await persistBrandImage(uploadedFiles.profileAvatar?.[0], "avatar");
    let sourceType;
    let sourceUrl = "";
    let inputPath = "";
    let inputName = "";

    if (sourceMode === "url") {
      sourceUrl = String(req.body.url || "").trim();
      if (!sourceUrl) throw Object.assign(new Error("Chưa nhập URL"), { statusCode: 400 });
      new URL(sourceUrl);
      sourceType = "url";
    } else if (sourceMode === "text") {
      const text = String(req.body.text || "").trim();
      if (text.length < 80) throw Object.assign(new Error("Nội dung dán vào phải có ít nhất 80 ký tự"), { statusCode: 400 });
      inputPath = path.join(config.inputDir, `${id}.txt`);
      await writeFile(inputPath, text, "utf8");
      inputName = `${id}.txt`;
      sourceType = "text";
    } else if (sourceMode === "file") {
      if (!sourceUpload) throw Object.assign(new Error("Chưa chọn file"), { statusCode: 400 });
      inputPath = sourceUpload.path;
      inputName = sourceUpload.originalname;
      sourceType = "file";
    } else {
      throw Object.assign(new Error("Loại đầu vào không hợp lệ"), { statusCode: 400 });
    }

    const now = new Date().toISOString();
    const job = {
      id,
      createdAt: now,
      updatedAt: now,
      status: "queued",
      progress: 0,
      stage: "Đang chờ AI tạo kịch bản",
      taskMode: "script",
      workflowStep: "script_queued",
      sourceType,
      sourceUrl,
      inputPath,
      inputName,
      requestedTitle: String(req.body.title || "").trim(),
      durationSec: Math.round(durationSec),
      theme: req.body.theme === "light-pro" ? "light-pro" : "dark-neon",
      renderProfile,
      durationCalibration: boolForm(req.body.durationCalibration),
      keepTerms: String(req.body.keepTerms || "").trim(),
      pronunciationRules: String(req.body.pronunciationRules || "").trim(),
      ttsConnectionId: selectedVoice.connection.id,
      ttsProvider: selectedVoice.connection.adapter,
      ttsProviderLabel: selectedVoice.connection.name,
      voiceKey: selectedVoice.key,
      voiceId: selectedVoice.voiceId,
      voiceName: selectedVoice.name,
      voiceGender: selectedVoice.gender,
      brandLogoPath,
      profileAvatarPath,
      aiProvider: primary.provider.id,
      aiModel: primary.model,
      aiFallbackEnabled: fallbackEnabled,
      aiFallbackProvider: "",
      aiFallbackModel: "",
      contentStyle,
      detailLevel,
      audience,
      styleOptions,
      forceRetts: false,
      error: null,
      logTail: [],
      outputFiles: [],
    };
    await store.create(job);
    return res.status(201).json(job);
  } catch (error) {
    return next(error);
  }
});

app.post("/api/jobs/:id/reconfigure", uploadJobFiles, async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    if (["queued", "running"].includes(job.status)) return res.status(409).json({ error: "Không thể sửa khi tác vụ đang chạy" });

    const sourceMode = String(req.body.sourceMode || job.sourceType || "url");
    const renderProfile = ["fast", "balanced", "quality"].includes(String(req.body.renderProfile || job.renderProfile || "balanced"))
      ? String(req.body.renderProfile || job.renderProfile || "balanced") : "balanced";
    const durationMode = String(req.body.duration || String(job.durationSec || 60));
    const durationSec = durationMode === "custom" ? Number(req.body.customDuration) : Number(durationMode);
    if (!Number.isFinite(durationSec) || durationSec < 30 || durationSec > 240) {
      throw Object.assign(new Error("Thời lượng phải từ 30 đến 240 giây"), { statusCode: 400 });
    }

    refreshRuntimeConfig();
    const ttsPublic = await getPublicTtsConfig(config);
    const requestedTtsConnectionId = String(req.body.ttsProvider || job.ttsConnectionId || ttsPublic.defaultTtsProvider || config.ttsDefaultConnectionId || "").trim();
    if (!requestedTtsConnectionId) throw Object.assign(new Error("Chưa chọn nguồn giọng đọc"), { statusCode: 400 });
    const selectedVoice = await resolveVoice(config, requestedTtsConnectionId, String(req.body.voiceKey || job.voiceKey || "").trim());
    const primary = resolveProviderSelection(config, String(req.body.aiProvider || job.aiProvider || config.defaultProvider), String(req.body.aiModel || job.aiModel || ""));

    const appPublicConfig = currentPublicConfig();
    const styleIds = new Set(appPublicConfig.contentStyles.map((item) => item.id));
    const detailIds = new Set(appPublicConfig.detailLevels.map((item) => item.id));
    const audienceIds = new Set(appPublicConfig.audiences.map((item) => item.id));
    const contentStyle = validateChoice(String(req.body.contentStyle || job.contentStyle || "summary"), styleIds, "summary");
    const detailLevel = validateChoice(String(req.body.detailLevel || job.detailLevel || "balanced"), detailIds, "balanced");
    const audience = validateChoice(String(req.body.audience || job.audience || "general"), audienceIds, "general");
    const styleOptions = {
      numberedSteps: boolForm(req.body.numberedSteps),
      includeWarnings: boolForm(req.body.includeWarnings),
      includeVerification: boolForm(req.body.includeVerification),
      showTerminalCommands: boolForm(req.body.showTerminalCommands),
      emphasizeBenefits: boolForm(req.body.emphasizeBenefits),
      includeCta: boolForm(req.body.includeCta),
      compareAlternatives: boolForm(req.body.compareAlternatives),
    };

    const uploadedFiles = req.files || {};
    const sourceUpload = uploadedFiles.file?.[0] || null;
    const persistBrandImage = async (uploaded, suffix, existingPath) => {
      if (!uploaded) return existingPath || "";
      const ext = path.extname(uploaded.originalname).toLowerCase();
      const target = path.join(config.inputDir, `${job.id}-${suffix}${ext}`);
      await rename(uploaded.path, target);
      return target;
    };
    const brandLogoPath = await persistBrandImage(uploadedFiles.brandLogo?.[0], "logo", job.brandLogoPath);
    const profileAvatarPath = await persistBrandImage(uploadedFiles.profileAvatar?.[0], "avatar", job.profileAvatarPath);

    let sourceType;
    let sourceUrl = "";
    let inputPath = "";
    let inputName = "";
    if (sourceMode === "url") {
      sourceUrl = String(req.body.url || job.sourceUrl || "").trim();
      if (!sourceUrl) throw Object.assign(new Error("Chưa nhập URL"), { statusCode: 400 });
      new URL(sourceUrl);
      sourceType = "url";
    } else if (sourceMode === "text") {
      let text = String(req.body.text || "").trim();
      if (!text && job.sourceType === "text" && job.inputPath) {
        try { text = String(await readFile(job.inputPath, "utf8")).trim(); } catch { text = ""; }
      }
      if (text.length < 80) throw Object.assign(new Error("Nội dung dán vào phải có ít nhất 80 ký tự"), { statusCode: 400 });
      inputPath = path.join(config.inputDir, `${job.id}.txt`);
      await writeFile(inputPath, text, "utf8");
      inputName = `${job.id}.txt`;
      sourceType = "text";
    } else if (sourceMode === "file") {
      if (sourceUpload) {
        inputPath = sourceUpload.path;
        inputName = sourceUpload.originalname;
      } else if (job.sourceType === "file" && job.inputPath) {
        inputPath = job.inputPath;
        inputName = job.inputName || path.basename(job.inputPath);
      } else {
        throw Object.assign(new Error("Chưa chọn file. Nếu đổi sang nguồn file, hãy chọn lại file cần dùng."), { statusCode: 400 });
      }
      sourceType = "file";
    } else {
      throw Object.assign(new Error("Loại đầu vào không hợp lệ"), { statusCode: 400 });
    }

    // Clear stale generated artifacts, but preserve reusable source/branding inputs.
    await rm(jobOutputDir(job.id), { recursive: true, force: true });
    if (job.downloadKey) await rm(path.join(config.downloadDir, job.downloadKey), { recursive: true, force: true });

    const updated = await store.update(job.id, {
      status: "queued",
      progress: 0,
      stage: "Đã cập nhật dự án; đang chờ AI tạo lại kịch bản",
      taskMode: "script",
      workflowStep: "script_queued",
      sourceType,
      sourceUrl,
      inputPath,
      inputName,
      sourceTitle: null,
      requestedTitle: String(req.body.title || "").trim(),
      durationSec: Math.round(durationSec),
      theme: req.body.theme === "light-pro" ? "light-pro" : "dark-neon",
      renderProfile,
      durationCalibration: boolForm(req.body.durationCalibration),
      keepTerms: String(req.body.keepTerms || "").trim(),
      pronunciationRules: String(req.body.pronunciationRules || "").trim(),
      ttsConnectionId: selectedVoice.connection.id,
      ttsProvider: selectedVoice.connection.adapter,
      ttsProviderLabel: selectedVoice.connection.name,
      voiceKey: selectedVoice.key,
      voiceId: selectedVoice.voiceId,
      voiceName: selectedVoice.name,
      voiceGender: selectedVoice.gender,
      brandLogoPath,
      profileAvatarPath,
      aiProvider: primary.provider.id,
      aiModel: primary.model,
      aiFallbackEnabled: false,
      aiFallbackProvider: "",
      aiFallbackModel: "",
      aiUsedProvider: null,
      aiUsedModel: null,
      aiFallbackUsed: false,
      contentStyle,
      detailLevel,
      audience,
      styleOptions,
      forceRetts: false,
      resumeFromScript: false,
      scriptWordCount: null,
      scriptApproved: false,
      scriptApprovedAt: null,
      scriptReadyAt: null,
      measuredVoiceDurationSec: null,
      completedAt: null,
      startedAt: null,
      error: null,
      logTail: [],
      outputFiles: [],
      downloadKey: null,
    });
    return res.json(updated);
  } catch (error) { return next(error); }
});

app.post("/api/jobs/:id/approve", async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    if (job.status === "running") return res.status(409).json({ error: "Tác vụ đang chạy" });
    await readFile(path.join(jobOutputDir(job.id), "script.json"), "utf8");
    const updated = await store.update(job.id, {
      status: "script_ready", progress: 50, stage: "Kịch bản đã chốt; sẵn sàng Render",
      workflowStep: "script_approved", scriptApproved: true, scriptApprovedAt: new Date().toISOString(), error: null,
    });
    return res.json(updated);
  } catch (error) {
    if (error?.code === "ENOENT") return res.status(409).json({ error: "Chưa có kịch bản để chốt" });
    return next(error);
  }
});

app.post("/api/jobs/:id/render", async (req, res, next) => {
  try {
    const job = store.get(req.params.id);
    if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
    if (["queued", "running"].includes(job.status)) return res.status(409).json({ error: "Tác vụ đang được xử lý" });
    if (!job.scriptApproved) return res.status(409).json({ error: "Kịch bản chưa được chốt. Hãy duyệt và bấm Chốt kịch bản trước khi Render." });
    try {
      await readFile(path.join(jobOutputDir(job.id), "script.json"), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return res.status(409).json({ error: "Chưa có kịch bản. Hãy tạo kịch bản trước." });
      throw error;
    }

    refreshRuntimeConfig();
    const selectedVoice = await resolveVoice(config, job.ttsConnectionId || config.ttsDefaultConnectionId, job.voiceKey || job.voiceId || "");

    const regenerateVoice = Boolean(req.body?.regenerateVoice);
    const updated = await store.update(job.id, {
      status: "queued",
      progress: 50,
      stage: "Đang chờ tạo giọng và render video",
      error: null,
      completedAt: null,
      outputFiles: [],
      downloadKey: null,
      forceRetts: regenerateVoice,
      resumeFromScript: true,
      taskMode: "render",
      workflowStep: "render_queued",
      ttsConnectionId: selectedVoice.connection.id,
      ttsProvider: selectedVoice.connection.adapter,
      ttsProviderLabel: selectedVoice.connection.name,
      voiceKey: selectedVoice.key,
      voiceId: selectedVoice.voiceId,
      voiceName: selectedVoice.name,
      voiceGender: selectedVoice.gender,
    });
    return res.json(updated);
  } catch (error) {
    error.statusCode ||= 409;
    return next(error);
  }
});

app.post("/api/jobs/:id/retry", async (req, res) => {
  const job = store.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
  if (!["failed", "completed"].includes(job.status)) return res.status(409).json({ error: "Tác vụ chưa thể chạy lại" });
  let hasScript = false;
  try {
    await readFile(path.join(jobOutputDir(job.id), "script.json"), "utf8");
    hasScript = true;
  } catch {}
  const failedDuringRender = job.taskMode === "render"
    || job.workflowStep === "render_running"
    || job.workflowStep === "render_failed"
    || Boolean(job.resumeFromScript)
    || (job.status === "failed" && hasScript && Number(job.progress || 0) >= 50);
  const taskMode = job.status === "completed" || failedDuringRender ? "render" : "script";
  const regenerateVoice = taskMode === "render" && (Boolean(req.body?.regenerateVoice) || job.status === "completed");
  const updated = await store.update(job.id, {
    status: "queued",
    progress: taskMode === "render" ? 50 : 0,
    stage: taskMode === "render"
      ? (regenerateVoice ? "Đang chờ render lại và tạo lại giọng" : "Đang chờ render lại")
      : "Đang chờ AI tạo lại kịch bản",
    error: null,
    completedAt: null,
    outputFiles: taskMode === "render" ? [] : job.outputFiles || [],
    downloadKey: taskMode === "render" ? null : job.downloadKey || null,
    forceRetts: regenerateVoice,
    resumeFromScript: taskMode === "render",
    taskMode,
    workflowStep: taskMode === "render" ? "render_queued" : "script_queued",
  });
  return res.json(updated);
});

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

app.delete("/api/jobs/:id", async (req, res) => {
  const job = store.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Không tìm thấy tác vụ" });
  if (job.status === "running") return res.status(409).json({ error: "Không thể xóa tác vụ đang chạy" });

  const targets = [path.join(config.baseRepoDir, "output", `dashboard-${job.id}`)];
  if (job.downloadKey) targets.push(path.join(config.downloadDir, job.downloadKey));
  if (job.inputPath && isInside(config.dataDir, job.inputPath)) targets.push(job.inputPath);
  if (job.brandLogoPath && isInside(config.dataDir, job.brandLogoPath)) targets.push(job.brandLogoPath);
  if (job.profileAvatarPath && isInside(config.dataDir, job.profileAvatarPath)) targets.push(job.profileAvatarPath);
  await Promise.all(targets.map((target) => rm(target, { recursive: true, force: true })));
  await store.remove(job.id);
  return res.status(204).end();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.statusCode || (error instanceof multer.MulterError ? 400 : 500);
  res.status(status).json({ error: error.message || "Lỗi máy chủ" });
});

app.listen(config.port, config.host, () => {
  console.log(`Auto Video Gen Dashboard: http://${config.host}:${config.port}`);
  const issues = validateJobConfig(config);
  if (issues.length) console.warn(`Cấu hình chưa đầy đủ: ${issues.join("; ")}`);
  else console.log(`Đã nhận ${config.availableProviders.length} nguồn AI: ${config.availableProviders.map((provider) => provider.label).join(", ")}`);
});
