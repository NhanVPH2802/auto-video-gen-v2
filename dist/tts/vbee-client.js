import axios from "axios";
import { writeFile } from "node:fs/promises";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Vbee returned status=0 (application-level error) — not retryable. */
class VbeeApiError extends Error {
}
/**
 * Vbee TTS client (https://vbee.vn).
 *
 * Async model: POST creates a request (callback_url required by the API but
 * unused here — we poll instead), then GET /tts/{request_id} until
 * status=SUCCESS and an audio_link is available.
 *
 * Vbee has no SRT output — `srtOutPath` arg is ignored silently.
 */
export class VbeeClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async generate(text, audioOutPath, _srtOutPath) {
        const created = await this.submitWithRetry(text);
        const audioLink = created.audio_link ?? (await this.pollUntilDone(created.request_id));
        await this.download(audioLink, audioOutPath);
    }
    async submitWithRetry(text) {
        const delays = [1000, 2000, 4000];
        let lastErr;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const resp = await axios.post(`${this.cfg.endpoint}/tts`, {
                    app_id: this.cfg.appId,
                    input_text: text,
                    voice_code: this.cfg.voiceCode,
                    audio_type: "mp3",
                    speed_rate: this.cfg.speedRate,
                    callback_url: "https://example.com/callback",
                }, {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${this.cfg.accessToken}`,
                    },
                    timeout: 30000,
                });
                const body = resp.data;
                if (body.status !== 1) {
                    throw new VbeeApiError(`Vbee TTS create error: ${body.error_message ?? body.error_code}`);
                }
                return body.result;
            }
            catch (e) {
                lastErr = e;
                if (e instanceof VbeeApiError)
                    throw e;
                const status = e.response?.status;
                const retryable = status === undefined || status >= 500;
                if (!retryable || attempt === delays.length)
                    throw e;
                await sleep(delays[attempt]);
            }
        }
        throw lastErr;
    }
    async pollUntilDone(requestId) {
        const start = Date.now();
        while (Date.now() - start < this.cfg.pollTimeoutMs) {
            const resp = await axios.get(`${this.cfg.endpoint}/tts/${requestId}`, {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.cfg.accessToken}`,
                },
                timeout: 30000,
            });
            const body = resp.data;
            if (body.status === 1) {
                if (body.result.status === "SUCCESS" && body.result.audio_link) {
                    return body.result.audio_link;
                }
                if (body.result.status === "FAILURE") {
                    throw new Error(`Vbee export ${requestId} failed`);
                }
                // IN_PROGRESS → keep polling
            }
            await sleep(this.cfg.pollIntervalMs);
        }
        throw new Error(`Vbee export ${requestId} polling timeout after ${this.cfg.pollTimeoutMs}ms`);
    }
    async download(url, outPath) {
        const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
        await writeFile(outPath, Buffer.from(resp.data));
    }
}
