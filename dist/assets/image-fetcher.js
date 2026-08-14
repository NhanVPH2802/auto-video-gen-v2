import axios from "axios";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
export async function fetchImage(url, outPath) {
    if (!url)
        return { success: false, reason: "no url provided (null)" };
    try {
        const resp = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 30000,
            validateStatus: (s) => s < 400,
        });
        const ct = String(resp.headers["content-type"] ?? "");
        if (!ct.startsWith("image/")) {
            return { success: false, reason: `non-image content-type: ${ct}` };
        }
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, Buffer.from(resp.data));
        return { success: true, path: outPath };
    }
    catch (e) {
        const status = e.response?.status;
        return { success: false, reason: status ? `http ${status}` : String(e.message ?? e) };
    }
}
