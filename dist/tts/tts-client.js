import { LucylabClient } from "./lucylab-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { VbeeClient } from "./vbee-client.js";
import { VieNeuClient } from "./vieneu-client.js";
export function createTtsClient(cfg) {
    switch (cfg.ttsProvider) {
        case "lucylab":
            return new LucylabClient({
                apiKey: cfg.lucylabApiKey,
                voiceId: cfg.lucylabVoiceId,
                endpoint: cfg.lucylabEndpoint,
                pollIntervalMs: cfg.lucylabPollIntervalMs,
                pollTimeoutMs: cfg.lucylabPollTimeoutMs,
            });
        case "elevenlabs":
            return new ElevenLabsClient({
                apiKey: cfg.elevenlabsApiKey,
                voiceId: cfg.elevenlabsVoiceId,
                modelId: cfg.elevenlabsModelId,
                endpoint: cfg.elevenlabsEndpoint,
            });
        case "vbee":
            return new VbeeClient({
                appId: cfg.vbeeAppId,
                accessToken: cfg.vbeeAccessToken,
                endpoint: cfg.vbeeEndpoint,
                voiceCode: cfg.vbeeVoiceCode,
                speedRate: cfg.vbeeSpeedRate,
                pollIntervalMs: cfg.vbeePollIntervalMs,
                pollTimeoutMs: cfg.vbeePollTimeoutMs,
            });
        case "vieneu":
            return new VieNeuClient({
                endpoint: cfg.vieneuEndpoint,
                voice: cfg.vieneuVoice,
            });
        default: {
            const _never = cfg.ttsProvider;
            throw new Error(`Unknown TTS provider: ${_never}`);
        }
    }
}
