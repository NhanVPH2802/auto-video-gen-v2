import { spawn } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { extractInput } from "./input-reader.js";
import { generateWithFallback } from "./ai-provider.js";
import {
  buildPrompts,
  buildRepairPrompt,
  coerceDraftWordCount,
  createScriptFromDraft,
  getDraftWordCount,
} from "./script-builder.js";
import { validateJobConfig } from "./config.js";
import { getVoiceConnection } from "./connection-manager.js";
import { presentError } from "./errors.js";

async function listDownloadFiles(rootDir, currentDir = rootDir) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) files.push(...await listDownloadFiles(rootDir, absolute));
    else if (/\.(mp4|mp3|wav|txt|json|srt)$/i.test(entry.name)) {
      const info = await stat(absolute);
      files.push({ name: path.relative(rootDir, absolute).replaceAll(path.sep, "/"), size: info.size });
    }
  }
  return files;
}

function stripAnsi(value) {
  return String(value || "")
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "");
}

function ttsProviderLabel(job) {
  return job.ttsProviderLabel || (job.ttsProvider === "vieneu" ? "VieNeu-TTS" : "LucyLab");
}

function renderText(value, max = 90) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function socialHandle(value, kind = "social") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const direct = raw.match(/@[A-Za-z0-9._-]{2,64}/);
  if (direct) return direct[0];
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = parts.find((part) => part.startsWith("@")) || parts[0] || "";
    if (candidate) return candidate.startsWith("@") ? candidate : (kind === "youtube" || kind === "tiktok" ? `@${candidate}` : candidate);
  } catch {}
  return raw.length <= 40 ? raw : "";
}

function buildOutroSocialFooter(job) {
  const lines = [];
  if (job.facebookUrl) lines.push(`Facebook: ${renderText(job.pageName || "Kênh", 30)}`);
  const youtube = socialHandle(job.youtubeUrl, "youtube");
  if (youtube) lines.push(`YouTube: ${renderText(youtube, 32)}`);
  const tiktok = socialHandle(job.tiktokHandle || job.tiktokUrl, "tiktok");
  if (tiktok) lines.push(`TikTok: ${renderText(tiktok, 32)}`);
  return lines.join("\n").slice(0, 90);
}

async function prepareRenderScript(job, outputDir) {
  const editablePath = path.join(outputDir, "script.json");
  const renderPath = path.join(outputDir, "script.render.json");
  const script = JSON.parse(await readFile(editablePath, "utf8"));
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  const outro = [...scenes].reverse().find((scene) => scene?.type === "outro" || scene?.templateData?.template === "outro") || scenes.at(-1);
  const approvedSource = renderText(outro?.templateData?.source, 90);

  // Keep script.json unchanged for the frame editor. Only the render copy is
  // transformed: the approved Outro source becomes the common source chip.
  script.metadata ||= {};
  script.metadata.source ||= {};
  if (approvedSource) script.metadata.source.domain = approvedSource;

  // Outro is branding/social information, not a repeated source line.
  const socialFooter = buildOutroSocialFooter(job);
  if (outro?.templateData && socialFooter) outro.templateData.source = socialFooter;

  await writeFile(renderPath, JSON.stringify(script, null, 2), "utf8");
  return { renderPath, approvedSource, socialFooter };
}


function findOutroScene(script) {
  const scenes = Array.isArray(script?.scenes) ? script.scenes : [];
  return [...scenes].reverse().find((scene) => scene?.type === "outro" || scene?.templateData?.template === "outro") || null;
}

async function loadReusableOutro(job, outputDir, config, store) {
  // Reconfigure the same project: keep its last approved/edited Outro first.
  try {
    const previous = JSON.parse(await readFile(path.join(outputDir, "script.previous.json"), "utf8"));
    const outro = findOutroScene(previous);
    if (outro) return { outro, source: "phiên bản trước của chính dự án" };
  } catch {}

  // New project: reuse the most recent project's Outro. This makes Outro sticky
  // across projects; if the user edits an Outro, that edited version becomes the
  // one automatically reused by later projects.
  const jobs = store.list()
    .filter((candidate) => candidate.id !== job.id && String(candidate.createdAt || "") <= String(job.createdAt || ""));
  for (const candidate of jobs) {
    try {
      const previous = JSON.parse(await readFile(path.join(config.baseRepoDir, "output", `dashboard-${candidate.id}`, "script.json"), "utf8"));
      const outro = findOutroScene(previous);
      if (outro) return { outro, source: candidate.projectName || candidate.sourceTitle || candidate.requestedTitle || candidate.id };
    } catch {}
  }
  return null;
}

function applyReusableOutro(script, reusable, channelName) {
  if (!reusable?.outro) return false;
  const current = findOutroScene(script);
  if (!current) return false;
  const saved = reusable.outro;
  current.voiceText = String(saved.voiceText || current.voiceText || "").trim() || current.voiceText;
  current.templateData = structuredClone(saved.templateData || current.templateData || { template: "outro" });
  current.templateData.template = "outro";
  // Branding may change between projects; keep the current channel identity while
  // retaining CTA/wording from the previously saved Outro.
  current.templateData.channelName = renderText(channelName || current.templateData.channelName || "Auto Video", 40);
  return true;
}

function parsePipelineProgress(line, preflight = false, ttsLabel = "TTS") {
  const clean = stripAnsi(line);
  const step = clean.match(/(?:STEP|\[)\s*(\d)\s*(?:\/\s*8|\])/i);
  if (step) {
    const number = Number(step[1]);
    const map = preflight
      ? { 1: 40, 2: 42, 3: 45, 4: 52, 5: 63, 6: 65, 7: 65, 8: 65 }
      : { 1: 68, 2: 70, 3: 72, 4: 74, 5: 76, 6: 79, 7: 82, 8: 95 };
    return { progress: map[number] || (preflight ? 45 : 70), stage: preflight ? `Đo giọng ${ttsLabel} - bước ${number}/5` : `Pipeline render - bước ${number}/8` };
  }
  if (/TTS scene/i.test(clean)) return { progress: preflight ? 52 : 74, stage: `${ttsLabel} đang tạo giọng đọc` };
  if (/\[VieNeu-TTS\].*(?:chunk|Thử lại|tạo lại|lỗi tạm thời)/i.test(clean)) {
    const retry = clean.match(/(?:lần|chunk)\s+(\d+)\/(\d+)/i);
    const suffix = retry ? ` · ${retry[1]}/${retry[2]}` : "";
    return { progress: preflight ? 54 : 74, stage: `${ttsLabel} đang ổn định giọng đọc${suffix}` };
  }
  if (/Concat voice|mix SFX/i.test(clean)) return { progress: preflight ? 63 : 76, stage: "Đang ghép giọng đọc và hiệu ứng âm thanh" };
  if (/TTS_PREFLIGHT_COMPLETE/i.test(clean)) return { progress: 66, stage: "Đã đo xong thời lượng giọng đọc" };
  if (/Compose HTML/i.test(clean)) return { progress: 79, stage: "Đang tạo cảnh và hiệu ứng" };
  if (/Capturing frame\s+(\d+)\/(\d+)/i.test(clean)) {
    const match = clean.match(/Capturing frame\s+(\d+)\/(\d+)/i);
    const current = Number(match?.[1] || 0);
    const total = Number(match?.[2] || 1);
    return { progress: Math.min(94, 82 + Math.round((current / total) * 12)), stage: `HyperFrames đang render frame ${current}/${total}` };
  }
  if (/HyperFrames|Rendering|frames/i.test(clean)) return { progress: 84, stage: "HyperFrames đang render video" };
  if (/video\.mp4|Render complete|done/i.test(clean)) return { progress: 95, stage: "Đang hoàn thiện video" };
  return null;
}

function renderSettings(job) {
  switch (job.renderProfile) {
    case "fast": return { fps: 20, quality: "draft", workers: 2, label: "Nhanh" };
    case "quality": return { fps: 30, quality: "standard", workers: 1, label: "Chất lượng" };
    default: return { fps: 24, quality: "standard", workers: 1, label: "Cân bằng" };
  }
}

async function copyCompletedOutput(job, outputDir, config, store) {
  await store.update(job.id, { progress: 96, stage: "Đang copy video sang thư mục tải xuống" });
  const month = new Date().toISOString().slice(0, 7);
  const downloadJobDir = path.join(config.downloadDir, month, job.id);
  await mkdir(path.dirname(downloadJobDir), { recursive: true });
  await rm(downloadJobDir, { recursive: true, force: true });
  await cp(outputDir, downloadJobDir, { recursive: true, force: true });
  const outputFiles = await listDownloadFiles(downloadJobDir);
  if (!outputFiles.some((file) => file.name === "video.mp4")) throw new Error("Pipeline báo thành công nhưng không tìm thấy video.mp4");
  await store.update(job.id, {
    status: "completed", progress: 100, stage: "Hoàn thành", completedAt: new Date().toISOString(),
    downloadKey: `${month}/${job.id}`, outputFiles, forceRetts: false, resumeFromScript: false,
    taskMode: "render", workflowStep: "completed",
  });
}

async function runPipeline(job, scriptPath, config, store, options = {}) {
  const preflight = Boolean(options.preflight);
  await store.update(job.id, { progress: preflight ? 40 : 68, stage: preflight ? "Đang tạo giọng thử để đo thời lượng" : "Khởi động pipeline render" });
  const voiceConnection = getVoiceConnection(config, job.ttsConnectionId || config.ttsDefaultConnectionId);
  if (!voiceConnection) throw new Error("Nguồn giọng đã chọn không còn tồn tại trong Set API");
  const connectionAdapter = voiceConnection.adapter;
  if (!["vieneu", "lucylab", "openai-tts", "custom-voice"].includes(connectionAdapter)) throw new Error(`Nguồn giọng ${voiceConnection.name} chưa có adapter render`);
  const selectedTtsProvider = connectionAdapter === "lucylab" ? "lucylab" : "vieneu";
  const useBridge = ["openai-tts", "custom-voice"].includes(connectionAdapter);
  const selectedTtsLabel = voiceConnection.name || ttsProviderLabel(job);
  const render = renderSettings(job);
  const bridgeBaseUrl = useBridge ? `http://127.0.0.1:${config.port}/__voice_bridge/${encodeURIComponent(voiceConnection.id)}` : "";
  const childEnv = {
    ...process.env,
    TTS_PROVIDER: selectedTtsProvider,
    VIETNAMESE_API_KEY: connectionAdapter === "lucylab" ? (voiceConnection.apiKey || "") : "",
    VIETNAMESE_VOICEID: connectionAdapter === "lucylab" ? (job.voiceId || "") : "",
    LUCYLAB_ENDPOINT: connectionAdapter === "lucylab" ? (voiceConnection.baseUrl || process.env.LUCYLAB_ENDPOINT || "") : "",
    VIENEU_BASE_URL: selectedTtsProvider === "vieneu" ? (useBridge ? bridgeBaseUrl : (voiceConnection.baseUrl || "")) : "",
    VIENEU_API_KEY: selectedTtsProvider === "vieneu" ? (useBridge ? (config.voiceBridgeToken || "") : (voiceConnection.apiKey || "")) : "",
    VIENEU_API_HEADER: selectedTtsProvider === "vieneu" ? (useBridge ? "x-bridge-key" : (voiceConnection.apiHeader || "x-api-key")) : "x-api-key",
    VIENEU_VOICE: selectedTtsProvider === "vieneu" ? (job.voiceId || voiceConnection.defaultVoice || "") : "",
    VIENEU_TIMEOUT_MS: String(config.vieneuTimeoutMs || 600000),
    VIENEU_PRELOAD: config.vieneuPreload ? "true" : "false",
    TTS_CONCURRENCY: "1",
    VIDEO_THEME: job.theme,
    VIDEO_BACKGROUND_TYPE: job.backgroundType || "theme",
    VIDEO_BACKGROUND_PRESET: job.backgroundPreset || "aurora",
    VIDEO_BACKGROUND_PATH: job.videoBackgroundPath || "",
    VIDEO_BACKGROUND_OVERLAY: String(job.backgroundOverlay ?? 35),
    VIDEO_BACKGROUND_BLUR: String(job.backgroundBlur ?? 0),
    VIDEO_TRANSITION: job.transition || "fade",
    VIDEO_TRANSITION_DURATION: String(job.transitionDuration ?? 0.4),
    VIDEO_MOTION_PRESET: job.motionPreset || "auto",
    VIDEO_BRAND_LOGO_PATH: job.brandLogoPath || config.brandLogoPath || "",
    TIKTOK_AVATAR_PATH: job.profileAvatarPath || config.tiktokAvatarPath || "",
    TIKTOK_DISPLAY_NAME: job.pageName || process.env.TIKTOK_DISPLAY_NAME || "Auto Video",
    TIKTOK_HANDLE: job.tiktokHandle || process.env.TIKTOK_HANDLE || "",
    TIKTOK_URL: job.tiktokUrl || "",
    YOUTUBE_URL: job.youtubeUrl || "",
    FACEBOOK_URL: job.facebookUrl || "",
    TTS_PRONUNCIATION_RULES: [config.ttsPronunciationRules, job.pronunciationRules]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join("\n"),
    TTS_PREFLIGHT_ONLY: preflight ? "1" : "0",
    TARGET_VIDEO_DURATION_SEC: String(job.durationSec || 60),
    VIDEO_RENDER_FPS: String(render.fps),
    VIDEO_RENDER_QUALITY: render.quality,
    VIDEO_RENDER_WORKERS: String(render.workers),
  };

  if (!preflight) await store.appendLog(job.id, `Chế độ render: ${render.label} · ${render.fps} fps · ${render.quality} · ${render.workers} worker.`);
  await new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "pipeline", "--", scriptPath], {
      cwd: config.baseRepoDir,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const consumeLines = (text, isError) => {
      const cleanText = stripAnsi(text);
      if (isError) stderr = (stderr + cleanText).slice(-12000);
      for (const line of cleanText.split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        store.appendLog(job.id, line).catch(() => {});
        const progress = parsePipelineProgress(line, preflight, selectedTtsLabel);
        if (progress) store.update(job.id, progress).catch(() => {});
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const parts = stdoutBuffer.split(/\r?\n|\r/);
      stdoutBuffer = parts.pop() || "";
      consumeLines(parts.join("\n"), false);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      const parts = stderrBuffer.split(/\r?\n|\r/);
      stderrBuffer = parts.pop() || "";
      consumeLines(parts.join("\n"), true);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutBuffer.trim()) consumeLines(stdoutBuffer, false);
      if (stderrBuffer.trim()) consumeLines(stderrBuffer, true);
      if (code === 0) resolve();
      else reject(new Error(`Pipeline kết thúc với mã ${code}. ${stderr.slice(-3000)}`));
    });
  });
}

function selectionFromJob(job, config, override = {}) {
  return {
    providerId: override.providerId || job.aiProvider || config.defaultProvider,
    model: override.model || job.aiModel || "",
    fallbackEnabled: override.fallbackEnabled ?? job.aiFallbackEnabled ?? config.aiAutoFallback,
    fallbackProviderId: override.fallbackProviderId || job.aiFallbackProvider || config.defaultFallbackProvider,
    fallbackModel: override.fallbackModel || job.aiFallbackModel || "",
  };
}

async function generateDraft(config, store, job, selection, systemPrompt, userPrompt, stageProgress) {
  return generateWithFallback(config, selection, systemPrompt, userPrompt, async (event) => {
    if (event.type === "start") {
      const prefix = event.fallback ? "Đang chuyển sang nguồn dự phòng" : "Đang gọi nguồn AI";
      await store.update(job.id, { progress: stageProgress, stage: `${prefix}: ${event.label} / ${event.model}` });
      await store.appendLog(job.id, `${prefix}: ${event.label} / ${event.model}`);
    } else if (event.type === "retry") {
      const waitSec = Math.max(1, Math.ceil(Number(event.delayMs || 0) / 1000));
      const statusText = event.status ? `HTTP ${event.status}` : "timeout";
      const stage = `AI tạm bận (${statusText}) · thử lại ${event.attempt}/${event.maxAttempts} sau ${waitSec}s`;
      await store.update(job.id, { progress: stageProgress, stage });
      await store.appendLog(job.id, `${event.label} / ${event.model}: ${stage}`);
    } else if (event.type === "error") {
      await store.appendLog(job.id, `${event.label} / ${event.model} thất bại: ${event.error?.message || event.error}`);
    } else if (event.type === "success") {
      await store.appendLog(job.id, `${event.label} / ${event.model} đã trả về kịch bản JSON.`);
    }
  });
}

function selectionAfterGeneration(job, config, previousSelection, generated) {
  return selectionFromJob(job, config, {
    providerId: generated.providerId,
    model: generated.model,
    fallbackEnabled: previousSelection.fallbackEnabled,
    fallbackProviderId: previousSelection.providerId === generated.providerId && previousSelection.model === generated.model
      ? previousSelection.fallbackProviderId
      : previousSelection.providerId,
    fallbackModel: previousSelection.providerId === generated.providerId && previousSelection.model === generated.model
      ? previousSelection.fallbackModel
      : previousSelection.model,
  });
}

async function buildScriptWithRepairs({
  config, store, job, source, channelName, prompts, selection, initialGenerated = null, initialPrompt = null, stageProgress = 26,
}) {
  let generated = initialGenerated || await generateDraft(
    config, store, job, selection, prompts.systemPrompt, initialPrompt || prompts.userPrompt, stageProgress,
  );
  let draft = generated.draft;
  let activeSelection = selectionAfterGeneration(job, config, selection, generated);
  let built;

  for (let repairAttempt = 0; repairAttempt <= config.scriptRepairAttempts; repairAttempt += 1) {
    try {
      built = createScriptFromDraft(draft, source, job, channelName);
      break;
    } catch (error) {
      if (!error.validationErrors) throw error;
      await store.appendLog(job.id, `Kịch bản cần sửa: ${error.validationErrors.join("; ")}`);
      if (repairAttempt >= config.scriptRepairAttempts) {
        const beforeWords = getDraftWordCount(draft);
        draft = coerceDraftWordCount(draft, error.maxWords || prompts.maxWords);
        const afterWords = getDraftWordCount(draft);
        if (afterWords !== beforeWords) {
          await store.appendLog(job.id, `Đã tự rút gọn cục bộ từ ${beforeWords} xuống ${afterWords} từ sau khi AI hết số vòng sửa.`);
        } else {
          await store.appendLog(job.id, `AI vẫn lệch số từ sau ${config.scriptRepairAttempts} vòng; tiếp tục kiểm tra bằng thời lượng giọng thực tế.`);
        }
        built = createScriptFromDraft(draft, source, job, channelName, { allowWordMismatch: true });
        break;
      }

      const attempt = repairAttempt + 1;
      await store.update(job.id, {
        progress: Math.min(38, stageProgress + attempt * 3),
        stage: `AI đang cân chỉnh kịch bản - vòng ${attempt}/${config.scriptRepairAttempts}`,
      });
      generated = await generateDraft(
        config, store, job, activeSelection, prompts.systemPrompt, buildRepairPrompt(draft, error.validationErrors, prompts, attempt),
        Math.min(38, stageProgress + attempt * 3),
      );
      draft = generated.draft;
      activeSelection = selectionAfterGeneration(job, config, activeSelection, generated);
    }
  }

  return { built, draft, generated, activeSelection };
}

export class JobWorker {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.busy = false;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => console.error("Worker tick error:", error)), 1000);
    this.tick().catch((error) => console.error("Worker start error:", error));
  }

  async tick() {
    if (this.busy) return;
    const job = this.store.nextQueued();
    if (!job) return;
    this.busy = true;
    try { await this.process(job); } finally { this.busy = false; }
  }

  async process(job) {
    const outputDir = path.join(this.config.baseRepoDir, "output", `dashboard-${job.id}`);
    const taskMode = job.taskMode === "render" || job.resumeFromScript ? "render" : "script";
    try {
      const primarySelection = selectionFromJob(job, this.config);
      let configErrors = validateJobConfig(this.config, {
        providerId: primarySelection.providerId,
        model: primarySelection.model,
        ttsConnectionId: job.ttsConnectionId || this.config.ttsDefaultConnectionId,
      });
      if (taskMode === "render") configErrors = configErrors.filter((message) => !/nguồn AI|provider|model/i.test(message));
      else configErrors = configErrors.filter((message) => !/giọng|LucyLab|VieNeu|TTS/i.test(message));
      if (configErrors.length) throw new Error(configErrors.join("; "));

      await this.store.update(job.id, {
        status: "running",
        progress: taskMode === "render" ? 52 : 5,
        stage: taskMode === "render" ? "Đang chuẩn bị tạo giọng và render" : "Đang kiểm tra đầu vào",
        error: null,
        errorTitle: null,
        errorHint: null,
        errorCode: null,
        startedAt: new Date().toISOString(),
        outputFiles: taskMode === "render" ? [] : (job.outputFiles || []),
        logTail: [],
        taskMode,
        workflowStep: taskMode === "render" ? "render_running" : "script_running",
      });

      if (job.forceRetts) {
        await rm(path.join(outputDir, "voice"), { recursive: true, force: true });
        await rm(path.join(outputDir, "voice.mp3"), { force: true });
        await rm(path.join(outputDir, "voice-raw.mp3"), { force: true });
        await this.store.appendLog(job.id, `Đã xóa giọng cũ để tạo lại bằng ${job.ttsProviderLabel || ttsProviderLabel(job)} · ${job.voiceName || "giọng đã chọn"}.`);
      }
      await mkdir(outputDir, { recursive: true });
      if (taskMode === "render") {
        const prepared = await prepareRenderScript(job, outputDir);
        await this.store.update(job.id, { progress: 55, stage: "Đang render theo kịch bản đã chốt", workflowStep: "render_running" });
        await this.store.appendLog(job.id, "Bước 2/2: bỏ qua AI; dùng kịch bản đã chốt để tạo giọng và render video.");
        if (prepared.approvedSource) await this.store.appendLog(job.id, `Nguồn hiển thị trên video: ${prepared.approvedSource}`);
        if (prepared.socialFooter) await this.store.appendLog(job.id, `Outro social: ${prepared.socialFooter.replace(/\n/g, " · ")}`);
        await runPipeline(job, prepared.renderPath, this.config, this.store, { preflight: false });
        await copyCompletedOutput(job, outputDir, this.config, this.store);
        return;
      }
      await this.store.update(job.id, { progress: 12, stage: "Đang đọc URL hoặc tài liệu" });
      const source = await extractInput(job, this.config);
      await writeFile(path.join(outputDir, "source.txt"), source.text, "utf8");
      await this.store.update(job.id, { progress: 23, stage: "Đã trích xuất nội dung; chuẩn bị viết kịch bản", sourceTitle: source.title });

      const channelName = job.pageName || process.env.TIKTOK_DISPLAY_NAME || "Auto Video";
      const prompts = buildPrompts({
        content: source.text,
        sourceTitle: source.title,
        durationSec: job.durationSec,
        keepTerms: job.keepTerms,
        channelName,
        introText: job.introText || "",
        contentStyle: job.contentStyle,
        detailLevel: job.detailLevel,
        audience: job.audience,
        styleOptions: job.styleOptions,
      });

      let result = await buildScriptWithRepairs({
        config: this.config,
        store: this.store,
        job,
        source,
        channelName,
        prompts,
        selection: primarySelection,
        stageProgress: 26,
      });
      let { built, draft, generated, activeSelection } = result;
      await this.store.update(job.id, {
        aiUsedProvider: generated.providerId,
        aiUsedModel: generated.model,
        aiFallbackUsed: generated.fallbackUsed,
      });

      const reusableOutro = await loadReusableOutro(job, outputDir, this.config, this.store);
      if (applyReusableOutro(built.script, reusableOutro, channelName)) {
        built.wordCount = built.script.scenes.reduce((sum, scene) => sum + String(scene.voiceText || "").trim().split(/\s+/).filter(Boolean).length, 0);
        await this.store.appendLog(job.id, `Outro: tự nạp lại nội dung từ ${reusableOutro.source}. Chỉ thay đổi khi bạn sửa Outro trong bước Duyệt kịch bản.`);
      }

      const scriptPath = path.join(outputDir, "script.json");
      let measuredDurationSec = null;

      const writeArtifacts = async () => {
        await writeFile(scriptPath, JSON.stringify(built.script, null, 2), "utf8");
        await writeFile(path.join(outputDir, "caption.txt"), built.caption, "utf8");
        await writeFile(path.join(outputDir, "job.json"), JSON.stringify({
          jobId: job.id,
          projectName: job.projectName || "",
          introText: job.introText || "",
          requestedDurationSec: job.durationSec,
          measuredVoiceDurationSec: measuredDurationSec,
          theme: job.theme,
          sourceType: job.sourceType,
          contentStyle: job.contentStyle,
          detailLevel: job.detailLevel,
          audience: job.audience,
          styleOptions: job.styleOptions,
          voice: { provider: job.ttsProvider || "lucylab", key: job.voiceKey, name: job.voiceName, gender: job.voiceGender, voiceId: job.voiceId },
          branding: {
            pageName: channelName,
            tiktokHandle: job.tiktokHandle || "",
            tiktokUrl: job.tiktokUrl || "",
            youtubeUrl: job.youtubeUrl || "",
            facebookUrl: job.facebookUrl || "",
            customLogo: Boolean(job.brandLogoPath),
            customAvatar: Boolean(job.profileAvatarPath),
          },
          requestedAi: { provider: job.aiProvider, model: job.aiModel },
          usedAi: { provider: generated.providerId, model: generated.model },
          wordCount: built.wordCount,
          createdAt: job.createdAt,
        }, null, 2), "utf8");
      };

      await this.store.update(job.id, { progress: 45, stage: `Đã tạo kịch bản ${built.wordCount} từ`, scriptWordCount: built.wordCount });
      await writeArtifacts();

      await this.store.update(job.id, {
        status: "script_ready",
        progress: 50,
        stage: "AI đã tạo kịch bản; hãy duyệt từng frame và chốt kịch bản",
        workflowStep: "script_review",
        scriptApproved: false,
        scriptApprovedAt: null,
        taskMode: "script",
        scriptReadyAt: new Date().toISOString(),
        completedAt: null,
        error: null,
        errorTitle: null,
        errorHint: null,
        errorCode: null,
        resumeFromScript: false,
      });
      await this.store.appendLog(job.id, "Bước 1 hoàn thành: AI đã tạo kịch bản nháp. Hãy duyệt nội dung hiển thị và nội dung đọc từng frame, sau đó Chốt kịch bản trước khi Render.");
      return;

    } catch (error) {
      if (error?.aiRaw) {
        try {
          await mkdir(outputDir, { recursive: true });
          await writeFile(path.join(outputDir, "ai-invalid-response.txt"), String(error.aiRaw), "utf8");
          await this.store.appendLog(job.id, `Đã lưu phản hồi AI lỗi tại ${path.join(outputDir, "ai-invalid-response.txt")}`);
        } catch (writeError) {
          await this.store.appendLog(job.id, `Không lưu được phản hồi AI lỗi: ${writeError.message}`);
        }
      }
      await this.store.appendLog(job.id, error.stack || error.message || String(error));
      const aiProviderId = job.aiUsedProvider || job.aiProvider;
      const aiProviderLabel = (this.config.providers || []).find((item) => item.id === aiProviderId)?.label || aiProviderId;
      const displayError = presentError(error, {
        phase: taskMode === "render" ? "render" : "script",
        providerLabel: aiProviderLabel,
        model: job.aiUsedModel || job.aiModel,
        voiceServer: job.ttsProviderLabel || ttsProviderLabel(job),
        voiceName: job.voiceName,
      });
      await this.store.update(job.id, {
        status: "failed",
        stage: displayError.title,
        error: displayError.message,
        errorTitle: displayError.title,
        errorHint: displayError.hint,
        errorCode: displayError.code,
        completedAt: new Date().toISOString(),
        taskMode,
        workflowStep: taskMode === "render" ? "render_failed" : "script_failed",
      });
    }
  }
}
