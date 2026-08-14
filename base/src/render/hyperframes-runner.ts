import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";

// V1.7_RENDER_ENV: runtime render tuning from dashboard.
function envRenderInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function envRenderQuality<T extends string>(fallback: T): T {
  const value = String(process.env.VIDEO_RENDER_QUALITY ?? "").trim().toLowerCase();
  return (value === "draft" || value === "standard" ? value : fallback) as T;
}

function envRenderWorkers(): number {
  return envRenderInt("VIDEO_RENDER_WORKERS", 0, 0, 8);
}


export interface RenderArgs {
  compositionDir: string;  // path to composition directory
  outputPath: string;      // path for .mp4
  fps?: number;            // default 30
  quality?: "draft" | "standard" | "high"; // default "standard"
}

export async function renderWithHyperframes(args: RenderArgs): Promise<void> {
  const { compositionDir, outputPath, fps = envRenderInt("VIDEO_RENDER_FPS", 30, 12, 60), quality = envRenderQuality("standard") } = args;

  const spawnArgs = [
    "hyperframes",
    "render",
    compositionDir,
    "--output",
    outputPath,
    "--fps",
    String(envRenderInt("VIDEO_RENDER_FPS", fps, 12, 60)),
    "--quality",
    envRenderQuality(quality),
  
      ...(envRenderWorkers() > 0 ? ["--workers", String(envRenderWorkers())] : []),];

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("npx", spawnArgs, {
      stdio: ["ignore", "inherit", "inherit"],
      shell: true,
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `hyperframes render failed with exit code ${code}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });

  log.info(`Rendered: ${outputPath}`);
}
