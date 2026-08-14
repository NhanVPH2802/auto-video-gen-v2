import axios from "axios";
import {
  ScriptSchema,
  type Script,
} from "../render/script-schema.js";
import type { SourceContent } from "../content/fetch-source.js";

interface GitHubModelsResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface VideoPoint {
  title: string;
  voiceText: string;
  bullets: string[];
}

interface VideoPlan {
  title: string;
  hookHeadline: string;
  hookSubhead: string;
  hookVoice: string;
  points: VideoPoint[];
  outroVoice: string;
  outroCta: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as UnknownRecord;
  }

  return {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function clip(value: string, maxLength: number, fallback: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const selected = cleaned || fallback;

  if (selected.length <= maxLength) {
    return selected;
  }

  return selected.slice(0, maxLength).trim();
}

function normalizeBullets(value: unknown, fallback: string): string[] {
  if (!Array.isArray(value)) {
    return [clip(fallback, 50, "Thông tin nổi bật")];
  }

  const bullets = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clip(item, 50, ""))
    .filter(Boolean)
    .slice(0, 4);

  return bullets.length > 0
    ? bullets
    : [clip(fallback, 50, "Thông tin nổi bật")];
}

function removeCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJson(value: string): unknown {
  const cleaned = removeCodeFence(value);

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Model không trả về JSON hợp lệ.");
    }

    return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
  }
}

function validImageUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function buildPrompt(source: SourceContent): string {
  return `
Bạn là biên tập viên video ngắn.

Hãy tạo nội dung video tiếng Việt dựa CHỈ trên nguồn được cung cấp.

QUY ĐỊNH:
- Chỉ trả về JSON hợp lệ.
- Không dùng Markdown.
- Không giải thích.
- Không tự tạo các trường id, type hoặc templateData.
- Không bịa số liệu hay tính năng không có trong nguồn.
- Phải có đúng 4 phần tử trong mảng points.
- Lời đọc phải tự nhiên, rõ ràng.
- Mỗi voiceText dài khoảng 100 đến 220 ký tự.
- Mỗi points phải có từ 1 đến 4 bullets.
- Mỗi bullet ngắn gọn, tối đa khoảng 50 ký tự.

Chỉ dùng cấu trúc JSON đơn giản sau:

{
  "title": "Tiêu đề video",
  "hookHeadline": "Tiêu đề mở đầu ngắn",
  "hookSubhead": "Dòng mô tả mở đầu",
  "hookVoice": "Lời đọc mở đầu",
  "points": [
    {
      "title": "Tiêu đề phần 1",
      "voiceText": "Lời đọc phần 1",
      "bullets": ["Ý nổi bật 1", "Ý nổi bật 2"]
    },
    {
      "title": "Tiêu đề phần 2",
      "voiceText": "Lời đọc phần 2",
      "bullets": ["Ý nổi bật 1", "Ý nổi bật 2"]
    },
    {
      "title": "Tiêu đề phần 3",
      "voiceText": "Lời đọc phần 3",
      "bullets": ["Ý nổi bật 1", "Ý nổi bật 2"]
    },
    {
      "title": "Tiêu đề phần 4",
      "voiceText": "Lời đọc phần 4",
      "bullets": ["Ý nổi bật 1", "Ý nổi bật 2"]
    }
  ],
  "outroVoice": "Lời kết video",
  "outroCta": "Theo dõi để xem thêm"
}

NGUỒN:
Tiêu đề: ${source.title}
URL: ${source.url}
Tên miền: ${source.domain}

NỘI DUNG NGUỒN:
${source.content}
`.trim();
}

async function requestModel(prompt: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  const model =
    process.env.GITHUB_MODEL ?? "microsoft/phi-4-mini-instruct";
  const endpoint =
    process.env.GITHUB_MODELS_ENDPOINT ??
    "https://models.github.ai/inference/chat/completions";

  if (!token) {
    throw new Error("Thiếu GITHUB_TOKEN trong .env.local");
  }

  const response = await axios.post<GitHubModelsResponse>(
    endpoint,
    {
      model,
      messages: [
        {
          role: "system",
          content:
            "Return one valid JSON object only. Do not use Markdown.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      seed: 1,
    },
    {
      timeout: 300000,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    },
  );

  const content = response.data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("GitHub Models không trả về nội dung.");
  }

  return content;
}


function createFallbackPlan(source: SourceContent): VideoPlan {
  const cleaned = source.content
    .replace(/[#*`>|_[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 50)
    .slice(0, 8);

  const getSentence = (index: number): string =>
    sentences[index] ??
    `Nội dung nguồn cung cấp những thông tin đáng chú ý về ${source.title}.`;

  return {
    title: source.title,
    hookHeadline: source.title,
    hookSubhead: "Những điểm đáng chú ý",
    hookVoice:
      `Hãy cùng tìm hiểu những thông tin nổi bật về ${source.title}.`,
    points: [0, 1, 2, 3].map((index) => ({
      title: `Điểm nổi bật ${index + 1}`,
      voiceText: getSentence(index),
      bullets: [getSentence(index).slice(0, 50)],
    })),
    outroVoice:
      "Đó là những thông tin đáng chú ý từ nguồn nội dung này. Hãy theo dõi để xem thêm các video mới.",
    outroCta: "Theo dõi để xem thêm",
  };
}

async function requestPlan(source: SourceContent): Promise<unknown> {
  const firstResponse = await requestModel(buildPrompt(source));

  try {
    return parseJson(firstResponse);
  } catch {
    console.warn(
      "[WARN] Phi-4 không trả JSON hợp lệ, đang yêu cầu sửa lại...",
    );

    const repairResponse = await requestModel(`
Chuyển nội dung sau thành một JSON object hợp lệ.

Chỉ trả JSON.
Không Markdown.
Không giải thích.
Phải có đúng 4 phần tử trong mảng points.

NỘI DUNG:
${firstResponse}
`.trim());

    try {
      return parseJson(repairResponse);
    } catch {
      console.warn(
        "[WARN] Phi-4 vẫn trả sai JSON, dùng kịch bản dự phòng.",
      );

      console.warn(
        "[DEBUG] Phản hồi model:",
        firstResponse.slice(0, 300).replace(/\s+/g, " "),
      );

      return createFallbackPlan(source);
    }
  }
}

function normalizePlan(raw: unknown, source: SourceContent): VideoPlan {
  const data = asRecord(raw);
  const hook = asRecord(data.hook);
  const outro = asRecord(data.outro);

  const rawPoints = Array.isArray(data.points)
    ? data.points
    : Array.isArray(data.scenes)
      ? data.scenes
      : [];

  const points: VideoPoint[] = [];

  for (let index = 0; index < 4; index += 1) {
    const point = asRecord(rawPoints[index]);

    const fallbackTitle = `Điểm nổi bật ${index + 1}`;

    const title = clip(
      firstString(
        point.title,
        point.headline,
        point.label,
        point.statement,
      ),
      40,
      fallbackTitle,
    );

    const voiceText = clip(
      firstString(
        point.voiceText,
        point.description,
        point.content,
        point.text,
      ),
      380,
      `Phần này trình bày ${title.toLowerCase()}, dựa trên thông tin được công bố trong nguồn gốc của nội dung.`,
    );

    const bullets = normalizeBullets(
      point.bullets ?? point.features ?? point.items,
      title,
    );

    points.push({
      title,
      voiceText,
      bullets,
    });
  }

  return {
    title: clip(
      firstString(data.title),
      100,
      source.title,
    ),
    hookHeadline: clip(
      firstString(
        data.hookHeadline,
        data.headline,
        hook.headline,
        hook.title,
      ),
      40,
      source.title,
    ),
    hookSubhead: clip(
      firstString(
        data.hookSubhead,
        data.subhead,
        hook.subhead,
      ),
      40,
      "Những điểm đáng chú ý",
    ),
    hookVoice: clip(
      firstString(
        data.hookVoice,
        data.intro,
        hook.voiceText,
        hook.content,
      ),
      380,
      `Hãy cùng tìm hiểu những điểm đáng chú ý về ${source.title}.`,
    ),
    points,
    outroVoice: clip(
      firstString(
        data.outroVoice,
        data.conclusion,
        outro.voiceText,
        outro.content,
      ),
      380,
      "Đó là những thông tin đáng chú ý. Hãy theo dõi để xem thêm các nội dung mới.",
    ),
    outroCta: clip(
      firstString(
        data.outroCta,
        data.cta,
        outro.ctaTop,
      ),
      30,
      "Theo dõi để xem thêm",
    ),
  };
}

function createScript(
  plan: VideoPlan,
  source: SourceContent,
  voiceId: string,
): Script {
  const image = validImageUrl(source.image);

  const script = {
    version: "1.0" as const,
    metadata: {
      title: plan.title,
      source: {
        url: source.url,
        domain: source.domain,
        image,
      },
      channel: "Auto Video Gen",
    },
    voice: {
      provider: "lucylab" as const,
      voiceId,
      speed: 1,
    },
    scenes: [
      {
        id: "scene-1",
        type: "hook" as const,
        voiceText: plan.hookVoice,
        templateData: {
          template: "hook" as const,
          headline: plan.hookHeadline,
          subhead: plan.hookSubhead,
          ...(image ? { bgSrc: "$source.image" } : {}),
          kenBurns: "zoom-in" as const,
        },
      },
      {
        id: "scene-2",
        type: "body" as const,
        voiceText: plan.points[0].voiceText,
        templateData: {
          template: "feature-list" as const,
          title: plan.points[0].title,
          bullets: plan.points[0].bullets,
          icon: "sparkles",
        },
      },
      {
        id: "scene-3",
        type: "body" as const,
        voiceText: plan.points[1].voiceText,
        templateData: {
          template: "callout" as const,
          statement: clip(
            `${plan.points[1].title}: ${plan.points[1].bullets[0]}`,
            80,
            plan.points[1].title,
          ),
          tag: "Điểm chính",
        },
      },
      {
        id: "scene-4",
        type: "body" as const,
        voiceText: plan.points[2].voiceText,
        templateData: {
          template: "feature-list" as const,
          title: plan.points[2].title,
          bullets: plan.points[2].bullets,
          icon: "check",
        },
      },
      {
        id: "scene-5",
        type: "body" as const,
        voiceText: plan.points[3].voiceText,
        templateData: {
          template: "callout" as const,
          statement: clip(
            `${plan.points[3].title}: ${plan.points[3].bullets[0]}`,
            80,
            plan.points[3].title,
          ),
          tag: "Đáng chú ý",
        },
      },
      {
        id: "scene-6",
        type: "outro" as const,
        voiceText: plan.outroVoice,
        templateData: {
          template: "outro" as const,
          ctaTop: plan.outroCta,
          channelName: "Auto Video Gen",
          source: clip(source.domain, 40, "Nguồn tham khảo"),
        },
      },
    ],
  };

  return ScriptSchema.parse(script);
}

export async function generateScript(
  source: SourceContent,
): Promise<Script> {
  const voiceId =
    process.env.VIETNAMESE_VOICEID ??
    process.env.LUCYLAB_VOICE_ID;

  if (!voiceId) {
    throw new Error("Thiếu VIETNAMESE_VOICEID trong .env.local");
  }

  const rawPlan = await requestPlan(source);
  const plan = normalizePlan(rawPlan, source);

  return createScript(plan, source, voiceId);
}
