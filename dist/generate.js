#!/usr/bin/env node
import { config } from "dotenv";
config({ path: ".env.local" });
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchSource } from "./content/fetch-source.js";
import { generateScript } from "./ai/github-model.js";
import { runPipeline } from "./pipeline.js";
function createSlug(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "video";
}
async function main() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: npm run generate -- "https://example.com/article"');
        process.exit(2);
    }
    console.log("[1/4] Đang lấy nội dung nguồn...");
    const source = await fetchSource(input);
    console.log(`[INFO] Tiêu đề: ${source.title}`);
    console.log(`[INFO] Nguồn: ${source.domain}`);
    console.log("[2/4] Đang tạo kịch bản bằng GitHub Models...");
    const script = await generateScript(source);
    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
    const outputDir = join(process.cwd(), "output", `${createSlug(source.title)}-${timestamp}`);
    await mkdir(outputDir, { recursive: true });
    const scriptPath = join(outputDir, "script.json");
    await writeFile(scriptPath, JSON.stringify(script, null, 2), "utf8");
    console.log(`[3/4] Đã tạo kịch bản: ${scriptPath}`);
    console.log("[4/4] Bắt đầu tạo giọng và render video...");
    await runPipeline(scriptPath);
}
main().catch((error) => {
    if (typeof error === "object" &&
        error !== null &&
        "response" in error) {
        const response = error.response;
        console.error("HTTP status:", response?.status);
        console.error("HTTP response:", response?.data);
    }
    console.error("Generate failed:", error instanceof Error ? error.message : error);
    process.exit(1);
});
