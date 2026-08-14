import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class JobStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.jobs = [];
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      this.jobs = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.jobs = [];
      await this.persist();
    }

    let changed = false;
    for (const job of this.jobs) {
      if (job.status === "running") {
        job.status = "failed";
        job.stage = "Ứng dụng đã khởi động lại khi tác vụ đang chạy";
        job.error = "Tác vụ bị gián đoạn do dịch vụ khởi động lại. Hãy bấm Thử lại.";
        job.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  list() {
    return [...this.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    return this.jobs.find((job) => job.id === id) || null;
  }

  async create(job) {
    this.jobs.push(job);
    await this.persist();
    return job;
  }

  async update(id, patch) {
    const job = this.get(id);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    await this.persist();
    return job;
  }

  async remove(id) {
    const index = this.jobs.findIndex((job) => job.id === id);
    if (index < 0) return null;
    const [removed] = this.jobs.splice(index, 1);
    await this.persist();
    return removed;
  }

  async appendLog(id, line) {
    const job = this.get(id);
    if (!job) return;
    const clean = String(line).replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "").trim();
    if (!clean) return;
    const logs = Array.isArray(job.logTail) ? job.logTail : [];
    logs.push(clean.slice(0, 2000));
    job.logTail = logs.slice(-120);
    job.updatedAt = new Date().toISOString();
    await this.persist();
  }

  nextQueued() {
    return this.jobs
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] || null;
  }

  async persist() {
    this.writeChain = this.writeChain.then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(this.jobs, null, 2), "utf8");
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }
}
