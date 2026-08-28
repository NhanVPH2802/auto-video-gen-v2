import crypto from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function clean(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "connection";
}

function arrayStrings(value) {
  if (Array.isArray(value)) return [...new Set(value.map(clean).filter(Boolean))];
  return [...new Set(clean(value).split(/[\n,;]+/).map(clean).filter(Boolean))];
}

function normalizeVoices(value) {
  if (Array.isArray(value)) {
    return value.map((voice, index) => ({
      id: clean(voice?.id || voice?.key || voice?.voiceId || `voice-${index + 1}`),
      name: clean(voice?.name || voice?.id || `Giọng ${index + 1}`),
      gender: clean(voice?.gender || "Khác") || "Khác",
      voiceId: clean(voice?.voiceId || voice?.id || voice?.key),
      description: clean(voice?.description),
    })).filter((voice) => voice.id && voice.name);
  }
  return [];
}

export function parseVoiceDefinitions(raw) {
  const entries = clean(raw).split(/\r?\n|;/).map(clean).filter(Boolean);
  const voices = [];
  for (const entry of entries) {
    const parts = entry.split("|").map(clean);
    if (parts.length < 3) continue;
    if (parts.length >= 4) {
      const [id, gender, name, voiceId] = parts;
      if (id && name && voiceId) voices.push({ id, gender: gender || "Khác", name, voiceId });
    } else {
      const [gender, name, voiceId] = parts;
      if (name && voiceId) voices.push({ id: voiceId, gender: gender || "Khác", name, voiceId });
    }
  }
  return normalizeVoices(voices);
}

export class ConnectionStore {
  constructor({ filePath, keyPath }) {
    this.filePath = filePath;
    this.keyPath = keyPath;
    this.key = null;
    this.data = { version: 1, connections: [] };
    this.writeChain = Promise.resolve();
  }

  async init(bootstrapConnections = []) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    this.key = await this.loadOrCreateKey();
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      if (parsed && Array.isArray(parsed.connections)) this.data = parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.persist();
    }
    if (!this.data.connections.length && bootstrapConnections.length) {
      for (const item of bootstrapConnections) await this.upsert(item, { persist: false });
      await this.persist();
    }
  }

  async loadOrCreateKey() {
    try {
      const raw = await readFile(this.keyPath);
      if (raw.length === 32) return raw;
      const decoded = Buffer.from(String(raw).trim(), "base64");
      if (decoded.length === 32) return decoded;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const key = crypto.randomBytes(32);
    await writeFile(this.keyPath, key, { mode: 0o600 });
    try { await chmod(this.keyPath, 0o600); } catch {}
    return key;
  }

  encrypt(secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(secret || {}), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, ciphertext].map((part) => part.toString("base64")).join(".");
  }

  decrypt(payload) {
    if (!payload) return {};
    try {
      const [ivB64, tagB64, dataB64] = String(payload).split(".");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8"));
    } catch {
      return {};
    }
  }

  listRuntime() {
    return this.data.connections.map((record) => ({ ...record, secret: this.decrypt(record.secretEnc) }));
  }

  getRuntime(id) {
    const record = this.data.connections.find((item) => item.id === id);
    return record ? { ...record, secret: this.decrypt(record.secretEnc) } : null;
  }

  listPublic() {
    return this.listRuntime().map((item) => ({
      id: item.id,
      category: item.category,
      name: item.name,
      adapter: item.adapter,
      baseUrl: item.baseUrl,
      apiHeader: item.apiHeader || "",
      enabled: item.enabled !== false,
      models: item.models || [],
      defaultModel: item.defaultModel || "",
      voices: item.voices || [],
      defaultVoice: item.defaultVoice || "",
      settings: item.settings || {},
      hasApiKey: Boolean(item.secret?.apiKey),
      lastTest: item.lastTest || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  async upsert(input, options = {}) {
    const now = new Date().toISOString();
    const requestedId = clean(input?.id);
    const existing = requestedId ? this.data.connections.find((item) => item.id === requestedId) : null;
    const category = input?.category === "voice" ? "voice" : "ai";
    const name = clean(input?.name || existing?.name || (category === "ai" ? "AI Server" : "Voice Server"));
    const id = existing?.id || requestedId || `${category}-${slug(name)}-${crypto.randomBytes(2).toString("hex")}`;
    const priorSecret = existing ? this.decrypt(existing.secretEnc) : {};
    const incomingApiKey = input?.apiKey === undefined ? priorSecret.apiKey : clean(input.apiKey);
    const secret = { ...priorSecret, apiKey: incomingApiKey };
    const record = {
      id,
      category,
      name,
      adapter: clean(input?.adapter || existing?.adapter || (category === "voice" ? "vieneu" : "openai-compatible")),
      baseUrl: clean(input?.baseUrl ?? existing?.baseUrl),
      apiHeader: clean(input?.apiHeader ?? existing?.apiHeader),
      enabled: input?.enabled === undefined ? existing?.enabled !== false : Boolean(input.enabled),
      models: arrayStrings(input?.models ?? existing?.models),
      defaultModel: clean(input?.defaultModel ?? existing?.defaultModel),
      voices: normalizeVoices(input?.voices ?? existing?.voices),
      defaultVoice: clean(input?.defaultVoice ?? existing?.defaultVoice),
      settings: { ...(existing?.settings || {}), ...(input?.settings || {}) },
      secretEnc: this.encrypt(secret),
      lastTest: input?.lastTest ?? existing?.lastTest ?? null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const index = this.data.connections.findIndex((item) => item.id === id);
    if (index >= 0) this.data.connections[index] = record;
    else this.data.connections.push(record);
    if (options.persist !== false) await this.persist();
    return this.getRuntime(id);
  }

  async patchTest(id, lastTest, extras = {}) {
    const record = this.data.connections.find((item) => item.id === id);
    if (!record) return null;
    Object.assign(record, extras, { lastTest, updatedAt: new Date().toISOString() });
    await this.persist();
    return this.getRuntime(id);
  }

  async remove(id) {
    const index = this.data.connections.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = this.data.connections.splice(index, 1);
    await this.persist();
    return removed;
  }

  async persist() {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
