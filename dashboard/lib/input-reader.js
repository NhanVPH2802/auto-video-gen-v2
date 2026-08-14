import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import mammoth from "mammoth";

const execFileAsync = promisify(execFile);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL chỉ được dùng http hoặc https");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Không cho phép URL localhost");
  if (net.isIP(url.hostname) && isPrivateIp(url.hostname)) throw new Error("Không cho phép URL mạng nội bộ");
  const resolved = await dns.lookup(url.hostname, { all: true });
  if (!resolved.length || resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error("URL trỏ tới địa chỉ mạng nội bộ hoặc không hợp lệ");
  }
  return url;
}

async function safeFetch(urlValue, options = {}, redirectCount = 0) {
  if (redirectCount > 5) throw new Error("URL chuyển hướng quá nhiều lần");
  const url = await assertPublicUrl(urlValue);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      ...options,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "AutoVideoGenDashboard/1.0",
        "Accept-Language": "vi,en;q=0.8",
        ...(options.headers || {}),
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("URL chuyển hướng nhưng thiếu Location");
      return safeFetch(new URL(location, url).toString(), options, redirectCount + 1);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

function compactText(text, maxChars) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

function extractHtml(html, sourceUrl, maxChars) {
  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr("content") || $("title").first().text().trim() || "Nội dung từ URL";
  const image = $("meta[property='og:image']").attr("content") || null;
  $("script,style,noscript,svg,nav,footer,header,aside,form,iframe").remove();

  const root = $("article").first().length ? $("article").first()
    : $("main").first().length ? $("main").first()
      : $("[role='main']").first().length ? $("[role='main']").first()
        : $("body");

  const chunks = [];
  root.find("h1,h2,h3,h4,p,li,pre,blockquote").each((_, node) => {
    const value = $(node).text().replace(/\s+/g, " ").trim();
    if (value.length >= 20 && !chunks.includes(value)) chunks.push(value);
  });

  let text = chunks.join("\n");
  if (text.length < 200) text = root.text();
  return {
    text: compactText(text, maxChars),
    title: compactText(title, 200),
    image: image ? new URL(image, sourceUrl).toString() : null,
  };
}

function parseGithubRepo(url) {
  const match = url.hostname.toLowerCase() === "github.com" && url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

async function readGithubRepo(url, config) {
  const repo = parseGithubRepo(url);
  if (!repo) return null;
  const headers = { Accept: "application/vnd.github.raw+json" };
  if (config.githubToken) headers.Authorization = `Bearer ${config.githubToken}`;
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/readme`;
  const response = await safeFetch(apiUrl, { headers });
  if (!response.ok) return null;
  return {
    text: compactText(await response.text(), config.maxSourceChars),
    title: `${repo.owner}/${repo.repo}`,
    image: `https://opengraph.githubassets.com/1/${repo.owner}/${repo.repo}`,
  };
}

async function readUrl(inputUrl, config) {
  const url = await assertPublicUrl(inputUrl);
  const github = await readGithubRepo(url, config);
  if (github) {
    return { ...github, sourceUrl: url.toString(), domain: url.hostname, sourceType: "url" };
  }

  const response = await safeFetch(url.toString(), { headers: { Accept: "text/html,text/plain,application/json;q=0.8" } });
  if (!response.ok) throw new Error(`Không tải được URL: HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const body = await response.text();
  if (body.length > 5_000_000) throw new Error("Trang web quá lớn");

  if (contentType.includes("html") || /<html[\s>]/i.test(body)) {
    const extracted = extractHtml(body, url.toString(), config.maxSourceChars);
    return { ...extracted, sourceUrl: url.toString(), domain: url.hostname, sourceType: "url" };
  }

  return {
    text: compactText(body, config.maxSourceChars),
    title: path.basename(url.pathname) || url.hostname,
    image: null,
    sourceUrl: url.toString(),
    domain: url.hostname,
    sourceType: "url",
  };
}

async function convertOfficeToText(filePath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autovideo-office-"));
  try {
    await execFileAsync("soffice", ["--headless", "--convert-to", "txt:Text", "--outdir", tempDir, filePath], {
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const target = path.join(tempDir, `${path.parse(filePath).name}.txt`);
    return await readFile(target, "utf8");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readUploadedFile(filePath, originalName, config) {
  const ext = path.extname(originalName).toLowerCase();
  let text;
  let title = path.basename(originalName, ext);

  if ([".txt", ".md", ".csv", ".json"].includes(ext)) {
    text = await readFile(filePath, "utf8");
  } else if ([".html", ".htm"].includes(ext)) {
    const extracted = extractHtml(await readFile(filePath, "utf8"), "https://local.invalid/", config.maxSourceChars);
    text = extracted.text;
    title = extracted.title || title;
  } else if (ext === ".pdf") {
    const result = await execFileAsync("pdftotext", ["-layout", filePath, "-"], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
    });
    text = result.stdout;
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ path: filePath });
    text = result.value;
  } else if ([".doc", ".odt", ".rtf"].includes(ext)) {
    text = await convertOfficeToText(filePath);
  } else {
    throw new Error(`Định dạng chưa hỗ trợ: ${ext || "không có phần mở rộng"}`);
  }

  text = compactText(text, config.maxSourceChars);
  if (text.length < 80) {
    if (ext === ".pdf") throw new Error("PDF không có đủ văn bản. Có thể đây là PDF scan; bản V1 chưa bật OCR.");
    throw new Error("File không có đủ nội dung văn bản để tạo video");
  }

  return {
    text,
    title,
    image: null,
    sourceUrl: "",
    domain: "file-upload",
    sourceType: "file",
  };
}

export async function extractInput(job, config) {
  if (job.sourceType === "url") return readUrl(job.sourceUrl, config);
  if (job.sourceType === "file") return readUploadedFile(job.inputPath, job.inputName, config);
  if (job.sourceType === "text") {
    const text = compactText(await readFile(job.inputPath, "utf8"), config.maxSourceChars);
    if (text.length < 80) throw new Error("Nội dung dán vào quá ngắn");
    return {
      text,
      title: job.requestedTitle || "Nội dung tự nhập",
      image: null,
      sourceUrl: "",
      domain: "direct-text",
      sourceType: "text",
    };
  }
  throw new Error(`Loại đầu vào không hợp lệ: ${job.sourceType}`);
}

export async function ensureInputDirectories(config) {
  await mkdir(config.uploadDir, { recursive: true });
  await mkdir(config.inputDir, { recursive: true });
}
