import { execFile } from "node:child_process";
import { access, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import type { TtsClient } from "./tts-client.js";

const execFileAsync = promisify(execFile);

export interface VieNeuOpts {
  baseUrl: string;
  apiKey: string;
  apiHeader: string;
  voice: string;
  timeoutMs: number;
  preload: boolean;
}

interface VieNeuResponse {
  ok: boolean;
  status: number;
  headers: IncomingHttpHeaders;
  data: Buffer;
}

interface AudioProbe {
  durationSec: number;
  size: number;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFromBytes(data: Uint8Array): string {
  const text = Buffer.from(data).toString("utf8", 0, 3000);
  try {
    const parsed = JSON.parse(text);
    return String(parsed?.detail || parsed?.error || parsed?.message || text);
  } catch {
    return text;
  }
}

function errorDetail(error: unknown): string {
  const value = error as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const code = value?.cause?.code || value?.code;
  const message = value?.cause?.message || value?.message || String(error);
  return code ? `${code}: ${message}` : message;
}

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text: string): number {
  return normalizeText(text).split(/\s+/).filter(Boolean).length;
}

function splitLongPiece(piece: string, maxChars: number): string[] {
  const clean = normalizeText(piece);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const soft = clean.split(/(?<=[,;:])\s+/).filter(Boolean);
  if (soft.length > 1) {
    const grouped: string[] = [];
    let current = "";
    for (const part of soft) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= maxChars) current = candidate;
      else {
        if (current) grouped.push(current);
        current = part;
      }
    }
    if (current) grouped.push(current);
    if (grouped.every((item) => item.length <= maxChars)) return grouped;
  }

  const words = clean.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) current = candidate;
    else {
      out.push(current);
      current = word;
    }
  }
  if (current) out.push(current);
  return out;
}

function splitForTts(text: string, maxChars: number): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  const sentenceLike = normalized.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((item) => normalizeText(item)).filter(Boolean) || [normalized];
  const pieces = sentenceLike.flatMap((item) => splitLongPiece(item, maxChars));
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current} ${piece}` : piece;
    if (candidate.length <= maxChars) current = candidate;
    else {
      if (current) chunks.push(current);
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function quoteConcatPath(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function isRetryableStatus(status: number): boolean {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export class VieNeuClient implements TtsClient {
  // PREVIEW_2_5_1_TTS_STABILITY
  private preloadPromise: Promise<void> | null = null;
  private readonly retryAttempts = envInt("VIENEU_RETRY_ATTEMPTS", 3, 1, 6);
  private readonly retryDelayMs = envInt("VIENEU_RETRY_DELAY_MS", 4000, 500, 60000);
  private readonly synthAttempts = envInt("VIENEU_AUDIO_REPAIR_ATTEMPTS", 3, 1, 5);
  private readonly chunkMaxChars = envInt("VIENEU_CHUNK_MAX_CHARS", 180, 80, 600);
  private readonly chunkGapMs = envInt("VIENEU_CHUNK_GAP_MS", 140, 0, 1000);
  private readonly maxWordsPerSec = envFloat("VIENEU_MAX_WORDS_PER_SEC", 5.5, 3.5, 9);
  private readonly validateAudio = envBool("VIENEU_AUDIO_VALIDATE", true);
  private readonly keepChunkCache = envBool("VIENEU_KEEP_CHUNK_CACHE", false);

  constructor(private cfg: VieNeuOpts) {}

  private endpoint(pathname: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${pathname}`;
  }

  private headers(): Record<string, string> {
    return {
      [this.cfg.apiHeader || "x-api-key"]: this.cfg.apiKey,
      "Content-Type": "application/json; charset=utf-8",
      "Accept": "application/json, audio/wav, audio/*;q=0.9, */*;q=0.8",
      "Connection": "close",
    };
  }

  private requestOnce(pathname: string, body?: unknown): Promise<VieNeuResponse> {
    const url = new URL(this.endpoint(pathname));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string | number> = this.headers();
    if (payload) headers["Content-Length"] = payload.length;

    return new Promise((resolve, reject) => {
      const req = transport(url, { method: "POST", headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        const maxBytes = 256 * 1024 * 1024;

        res.on("data", (chunk: Buffer | Uint8Array | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > maxBytes) {
            req.destroy(new Error(`VieNeu-TTS response vượt quá ${maxBytes} bytes`));
            return;
          }
          chunks.push(buffer);
        });

        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: res.headers,
            data: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      });

      req.setTimeout(this.cfg.timeoutMs, () => {
        req.destroy(new Error(`quá thời gian ${this.cfg.timeoutMs}ms khi chờ VieNeu-TTS`));
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async request(pathname: string, body?: unknown): Promise<VieNeuResponse> {
    let lastError: unknown;
    let lastResponse: VieNeuResponse | null = null;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const response = await this.requestOnce(pathname, body);
        lastResponse = response;
        if (response.ok || !isRetryableStatus(response.status)) return response;
        lastError = new Error(`HTTP ${response.status}: ${messageFromBytes(response.data) || "lỗi tạm thời"}`);
      } catch (error) {
        lastError = error;
      }

      if (attempt >= this.retryAttempts) break;
      const delay = this.retryDelayMs * attempt;
      console.warn(
        `[VieNeu-TTS] ${pathname} lỗi tạm thời lần ${attempt}/${this.retryAttempts}: ${errorDetail(lastError)}. ` +
        `Thử lại sau ${Math.round(delay / 1000)} giây...`,
      );
      await sleep(delay);
    }
    if (lastResponse && !lastResponse.ok) return lastResponse;
    throw new Error(`VieNeu-TTS connection error sau ${this.retryAttempts} lần: ${errorDetail(lastError)}`);
  }

  private async ensurePreloaded(): Promise<void> {
    if (!this.cfg.preload) return;
    if (!this.preloadPromise) {
      this.preloadPromise = (async () => {
        const response = await this.request("/api/preload");
        if (!response.ok) {
          throw new Error(`VieNeu-TTS preload error: ${messageFromBytes(response.data) || `HTTP ${response.status}`}`);
        }
      })().catch((error) => {
        this.preloadPromise = null;
        throw error;
      });
    }
    await this.preloadPromise;
  }

  private minDurationSec(text: string): number {
    const words = countWords(text);
    if (!words) return 0;
    return Math.max(0.65, words / this.maxWordsPerSec);
  }

  private async probeAudio(path: string): Promise<AudioProbe> {
    const info = await stat(path);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ], { timeout: Math.min(this.cfg.timeoutMs, 120000), maxBuffer: 1024 * 1024 });
    const durationSec = Number(String(stdout).trim());
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("ffprobe không đọc được thời lượng audio");
    return { durationSec, size: info.size };
  }

  private maxDurationSec(text: string): number {
    const words = countWords(text);
    if (!words) return Number.POSITIVE_INFINITY;
    // Conservative upper bound: catches long trailing silence without penalising slow voices.
    return Math.max(6, words / 1.35 + 4);
  }

  private async validateChunk(path: string, text: string, checkUpperBound = true): Promise<AudioProbe> {
    const probe = await this.probeAudio(path);
    if (probe.size < 4096) throw new Error(`audio quá nhỏ (${probe.size} bytes)`);
    if (this.validateAudio) {
      const minimum = this.minDurationSec(text);
      if (probe.durationSec + 0.05 < minimum) {
        throw new Error(
          `audio ngắn bất thường ${probe.durationSec.toFixed(2)}s cho ${countWords(text)} từ ` +
          `(tối thiểu dự kiến ${minimum.toFixed(2)}s)`,
        );
      }
      if (checkUpperBound) {
        const maximum = this.maxDurationSec(text);
        if (probe.durationSec > maximum) {
          throw new Error(
            `audio dài bất thường ${probe.durationSec.toFixed(2)}s cho ${countWords(text)} từ ` +
            `(tối đa dự kiến ${maximum.toFixed(2)}s; có thể có khoảng lặng ở cuối)`,
          );
        }
      }
    }
    return probe;
  }

  private async synthesizeChunk(text: string, outPath: string, label: string, index: number, total: number): Promise<AudioProbe> {
    if (await fileExists(outPath)) {
      try {
        const cached = await this.validateChunk(outPath, text, false);
        console.log(`[VieNeu-TTS] ${label}: dùng lại chunk ${index}/${total} (${cached.durationSec.toFixed(2)}s)`);
        return cached;
      } catch {
        await rm(outPath, { force: true });
      }
    }

    const tempPath = `${outPath}.tmp-${process.pid}`;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.synthAttempts; attempt += 1) {
      await rm(tempPath, { force: true });
      try {
        console.log(`[VieNeu-TTS] ${label}: tạo chunk ${index}/${total}, lần ${attempt}/${this.synthAttempts} (${text.length} ký tự)`);
        const requestedName = `${basename(outPath, extname(outPath))}.wav`;
        const response = await this.request("/api/tts", { text, voice: this.cfg.voice, filename: requestedName });
        if (!response.ok) {
          throw new Error(`VieNeu-TTS create error HTTP ${response.status}: ${messageFromBytes(response.data) || "không có chi tiết"}`);
        }
        const contentType = String(response.headers["content-type"] || "").toLowerCase();
        const magic = response.data.subarray(0, 4).toString("ascii");
        if (!contentType.includes("audio/") && magic !== "RIFF") {
          throw new Error(`VieNeu-TTS không trả về WAV: ${messageFromBytes(response.data)}`);
        }
        await writeFile(tempPath, response.data);
        const probe = await this.validateChunk(tempPath, text, false);
        await rename(tempPath, outPath);
        console.log(`[VieNeu-TTS] ${label}: chunk ${index}/${total} OK (${probe.durationSec.toFixed(2)}s)`);
        return probe;
      } catch (error) {
        lastError = error;
        await rm(tempPath, { force: true });
        if (attempt >= this.synthAttempts) break;
        const delay = Math.min(6000, 1200 * attempt);
        console.warn(`[VieNeu-TTS] ${label}: chunk ${index}/${total} chưa ổn: ${errorDetail(error)}. Tạo lại sau ${delay}ms...`);
        await sleep(delay);
      }
    }
    throw new Error(`VieNeu-TTS tạo giọng thất bại tại ${label}, chunk ${index}/${total}: ${errorDetail(lastError)}`);
  }

  private async normalizeWav(inputPath: string, outputPath: string): Promise<void> {
    // Trim only leading/trailing silence. Internal pauses are preserved.
    // The reverse-pass avoids silenceremove stopping at a legitimate pause mid-sentence.
    const trimFilter = [
      "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
      "areverse",
      "silenceremove=start_periods=1:start_duration=0.01:start_threshold=-50dB",
      "areverse",
    ].join(",");
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", inputPath,
      "-af", trimFilter,
      "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
      outputPath,
    ], { timeout: this.cfg.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  }

  private async makeSilence(path: string): Promise<void> {
    const seconds = Math.max(0, this.chunkGapMs / 1000);
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
      "-t", seconds.toFixed(3),
      "-c:a", "pcm_s16le", path,
    ], { timeout: Math.min(this.cfg.timeoutMs, 120000), maxBuffer: 4 * 1024 * 1024 });
  }

  private async combineChunks(rawChunks: string[], chunkDir: string): Promise<string> {
    if (rawChunks.length === 1) {
      const single = join(chunkDir, "combined.wav");
      await this.normalizeWav(rawChunks[0], single);
      return single;
    }

    const normalized: string[] = [];
    for (let i = 0; i < rawChunks.length; i += 1) {
      const out = join(chunkDir, `norm-${String(i + 1).padStart(3, "0")}.wav`);
      await this.normalizeWav(rawChunks[i], out);
      normalized.push(out);
    }

    const silence = join(chunkDir, "silence.wav");
    await this.makeSilence(silence);
    const concatEntries: string[] = [];
    for (let i = 0; i < normalized.length; i += 1) {
      concatEntries.push(`file '${quoteConcatPath(normalized[i])}'`);
      if (i < normalized.length - 1 && this.chunkGapMs > 0) concatEntries.push(`file '${quoteConcatPath(silence)}'`);
    }
    const listPath = join(chunkDir, "concat.txt");
    await writeFile(listPath, `${concatEntries.join("\n")}\n`, "utf8");
    const combined = join(chunkDir, "combined.wav");
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", listPath,
      "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le",
      combined,
    ], { timeout: this.cfg.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    return combined;
  }

  async generate(text: string, audioOutPath: string): Promise<void> {
    await this.ensurePreloaded();
    const normalized = normalizeText(text);
    if (!normalized) throw new Error("VieNeu-TTS: nội dung lời đọc đang trống");

    const chunks = splitForTts(normalized, this.chunkMaxChars);
    const label = basename(audioOutPath, extname(audioOutPath));
    const chunkDir = `${audioOutPath}.chunks`;
    await mkdir(chunkDir, { recursive: true });
    console.log(`[VieNeu-TTS] ${label}: ${normalized.length} ký tự → ${chunks.length} chunk (tối đa ${this.chunkMaxChars} ký tự/chunk)`);

    try {
      const rawChunks: string[] = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const chunkPath = join(chunkDir, `chunk-${String(i + 1).padStart(3, "0")}.wav`);
        await this.synthesizeChunk(chunks[i], chunkPath, label, i + 1, chunks.length);
        rawChunks.push(chunkPath);
      }

      const combinedWav = await this.combineChunks(rawChunks, chunkDir);
      const combinedProbe = await this.validateChunk(combinedWav, normalized);
      const targetExt = extname(audioOutPath).toLowerCase();
      const tempTarget = `${audioOutPath}.tmp-${process.pid}${targetExt || ".mp3"}`;
      await rm(tempTarget, { force: true });

      if (targetExt === ".wav") {
        await rename(combinedWav, tempTarget);
      } else {
        await execFileAsync("ffmpeg", [
          "-y", "-hide_banner", "-loglevel", "error",
          "-i", combinedWav,
          "-codec:a", "libmp3lame", "-q:a", "2",
          tempTarget,
        ], { timeout: this.cfg.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
      }

      const finalProbe = await this.validateChunk(tempTarget, normalized);
      await rm(audioOutPath, { force: true });
      await rename(tempTarget, audioOutPath);
      console.log(
        `[VieNeu-TTS] ${label}: hoàn tất ${chunks.length} chunk, ` +
        `${countWords(normalized)} từ, ${finalProbe.durationSec.toFixed(2)}s ` +
        `(WAV ghép ${combinedProbe.durationSec.toFixed(2)}s)`,
      );
      if (!this.keepChunkCache) await rm(chunkDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`[VieNeu-TTS] ${label}: giữ cache chunk tại ${chunkDir} để lần Render lại có thể tiếp tục.`);
      throw error;
    }
  }
}
