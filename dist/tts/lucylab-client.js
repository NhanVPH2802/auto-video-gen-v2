import axios from "axios";
import { writeFile } from "node:fs/promises";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class LucylabClient {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async generate(text, audioOutPath, srtOutPath) {
        const projectExportId = await this.submitWithRetry(text);
        const { url, srtUrl } = await this.pollUntilDone(projectExportId);
        await this.download(url, audioOutPath);
        if (srtOutPath && srtUrl) {
            await this.download(srtUrl, srtOutPath);
        }
    }
    async rpc(method, input, idHint) {
        const resp = await axios.post(this.cfg.endpoint, { jsonrpc: "2.0", method, input, id: idHint }, {
            headers: {
                Authorization: `Bearer ${this.cfg.apiKey}`,
                "Content-Type": "application/json",
            },
            timeout: 30000,
        });
        const body = resp.data;
        if ("error" in body) {
            throw new Error(`LucyLab ${method} error: ${body.error.message}`);
        }
        return body.result;
    }
    async submitWithRetry(text) {
        const delays = [1000, 2000, 4000];
        let lastErr;
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const result = await this.rpc("ttsLongText", { text, userVoiceId: this.cfg.voiceId, speed: 1 }, `submit-${Date.now()}`);
                return result.projectExportId;
            }
            catch (e) {
                lastErr = e;
                const status = e.response?.status;
                const retryable = status === undefined || status >= 500;
                if (!retryable || attempt === delays.length)
                    throw e;
                await sleep(delays[attempt]);
            }
        }
        throw lastErr;
    }
    async pollUntilDone(projectExportId) {
        const start = Date.now();
        while (Date.now() - start < this.cfg.pollTimeoutMs) {
            const status = await this.rpc("getExportStatus", { projectExportId }, `poll-${Date.now()}`);
            if (status.state === "completed") {
                if (!status.url)
                    throw new Error(`LucyLab returned state=completed without url for ${projectExportId}`);
                return { url: status.url, srtUrl: status.srtUrl };
            }
            if (status.state === "failed") {
                throw new Error(`LucyLab export ${projectExportId} failed: ${status.error ?? "unknown"}`);
            }
            await sleep(this.cfg.pollIntervalMs);
        }
        throw new Error(`LucyLab export ${projectExportId} polling timeout after ${this.cfg.pollTimeoutMs}ms`);
    }
    async download(url, outPath) {
        const resp = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
        await writeFile(outPath, Buffer.from(resp.data));
    }
}
