import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";
export async function renderWithHyperframes(args) {
    const { compositionDir, outputPath, fps = 30, quality = "standard" } = args;
    const spawnArgs = [
        "hyperframes",
        "render",
        compositionDir,
        "--output",
        outputPath,
        "--fps",
        String(fps),
        "--quality",
        quality,
    ];
    await new Promise((resolve, reject) => {
        const proc = spawn("npx", spawnArgs, {
            stdio: ["ignore", "inherit", "inherit"],
            shell: true,
        });
        proc.on("close", (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`hyperframes render failed with exit code ${code}`));
            }
        });
        proc.on("error", (err) => {
            reject(err);
        });
    });
    log.info(`Rendered: ${outputPath}`);
}
