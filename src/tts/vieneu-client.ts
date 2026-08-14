import { Client } from "@gradio/client";
import { writeFile } from "node:fs/promises";
import type { TtsClient } from "./tts-client.js";

export interface VieNeuOptions {
  endpoint: string;
  voice: string;
}

export class VieNeuClient implements TtsClient {
  constructor(private readonly cfg: VieNeuOptions) {}

  async generate(
    text: string,
    audioOutPath: string,
    _srtOutPath?: string,
  ): Promise<void> {
    const client = await Client.connect(
      this.cfg.endpoint.replace(/\/+$/, ""),
    );

    const result = await client.predict(
      "/on_audio_generated_1",
      {
        text,
        voice: this.cfg.voice,
        audio: null,
        reference_text: null,
        reference_audio: null,
        generation_mode: "Standard (Một lần)",
      },
    );

    const data = Array.isArray(result.data)
      ? result.data
      : [];

    const audio = data[0] as
      | string
      | {
          url?: string;
          path?: string;
        }
      | null
      | undefined;

    const audioUrl =
      typeof audio === "string"
        ? audio
        : audio?.url;

    if (!audioUrl) {
      throw new Error(
        `VieNeu không trả về URL âm thanh: ${JSON.stringify(result.data)}`,
      );
    }

    const response = await fetch(audioUrl);

    if (!response.ok) {
      throw new Error(
        `Tải WAV VieNeu thất bại: HTTP ${response.status}`,
      );
    }

    const buffer = Buffer.from(
      await response.arrayBuffer(),
    );

    await writeFile(audioOutPath, buffer);
  }
}
