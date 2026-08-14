import { execFile } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { basename, extname } from "node:path";
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

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageFromBytes(data: Uint8Array): string {
  const text = Buffer.from(data).toString("utf8", 0, 2000);
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

export class VieNeuClient implements TtsClient {
  private preloadPromise: Promise<void> | null = null;
  private readonly retryAttempts = envInt("VIENEU_RETRY_ATTEMPTS", 3, 1, 6);
  private readonly retryDelayMs = envInt("VIENEU_RETRY_DELAY_MS", 5000, 500, 60000);

  constructor(private cfg: VieNeuOpts) {}

  private endpoint(pathname: string): string {
    return `${this.cfg.baseUrl.replace(/\/+$/, "")}${pathname}`;
  }

  private headers(): Record<string, string> {
    return {
      [this.cfg.apiHeader || "x-api-key"]: this.cfg.apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json, audio/wav, audio/*;q=0.9, */*;q=0.8",
      "Connection": "close",
    };
  }

  /**
   * Use Node's native HTTP client instead of fetch(). Node/Undici fetch has a
   * separate ~300 second response-header timeout, which can fire before a slow
   * VieNeu synthesis returns any headers even when VIENEU_TIMEOUT_MS is higher.
   */
  private requestOnce(pathname: string, body?: unknown): Promise<VieNeuResponse> {
    const url = new URL(this.endpoint(pathname));
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const headers: Record<string, string | number> = this.headers();
    if (payload) headers["Content-Length"] = payload.length;

    return new Promise((resolve, reject) => {
      const req = transport(url, {
        method: "POST",
        headers,
        agent: false,
      }, (res) => {
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
    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        return await this.requestOnce(pathname, body);
      } catch (error) {
        lastError = error;
        if (attempt >= this.retryAttempts) break;
        const delay = this.retryDelayMs * attempt;
        console.warn(
          `[VieNeu-TTS] ${pathname} lỗi lần ${attempt}/${this.retryAttempts}: ${errorDetail(error)}. ` +
          `Thử lại sau ${Math.round(delay / 1000)} giây...`,
        );
        await sleep(delay);
      }
    }
    throw new Error(`VieNeu-TTS connection error sau ${this.retryAttempts} lần: ${errorDetail(lastError)}`);
  }

  private async ensurePreloaded(): Promise<void> {
    if (!this.cfg.preload) return;
    if (!this.preloadPromise) {
      this.preloadPromise = (async () => {
        const response = await this.request("/api/preload");
        if (!response.ok) {
          throw new Error(
            `VieNeu-TTS preload error: ${messageFromBytes(response.data) || `HTTP ${response.status}`}`,
          );
        }
      })().catch((error) => {
        this.preloadPromise = null;
        throw error;
      });
    }
    await this.preloadPromise;
  }

  async generate(text: string, audioOutPath: string): Promise<void> {
    await this.ensurePreloaded();
    const requestedName = `${basename(audioOutPath, extname(audioOutPath))}.wav`;
    const response = await this.request("/api/tts", {
      text,
      voice: this.cfg.voice,
      filename: requestedName,
    });

    if (!response.ok) {
      throw new Error(
        `VieNeu-TTS create error: ${messageFromBytes(response.data) || `HTTP ${response.status}`}`,
      );
    }

    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const magic = response.data.subarray(0, 4).toString("ascii");
    if (!contentType.includes("audio/") && magic !== "RIFF") {
      throw new Error(`VieNeu-TTS không trả về WAV: ${messageFromBytes(response.data)}`);
    }

    if (extname(audioOutPath).toLowerCase() === ".wav") {
      await writeFile(audioOutPath, response.data);
      return;
    }

    const tempWav = `${audioOutPath}.vieneu.wav`;
    await writeFile(tempWav, response.data);
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error",
        "-i", tempWav,
        "-codec:a", "libmp3lame", "-q:a", "2",
        audioOutPath,
      ], { timeout: this.cfg.timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    } catch (error: any) {
      throw new Error(`Không chuyển WAV VieNeu sang MP3: ${error?.stderr || error?.message || error}`);
    } finally {
      await rm(tempWav, { force: true });
    }
  }
}
