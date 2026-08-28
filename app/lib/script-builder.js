const templateNames = new Set(["hook", "comparison", "stat-hero", "feature-list", "callout", "outro"]);

const STYLE_SPECS = {
  tutorial: {
    label: "Hướng dẫn sử dụng",
    structure: "Nêu vấn đề, điều kiện chuẩn bị, các bước thực hiện theo thứ tự, cách kiểm tra kết quả, lưu ý và kết luận.",
    defaults: ["numberedSteps", "includeVerification"],
  },
  "feature-intro": {
    label: "Giới thiệu tính năng",
    structure: "Mở đầu bằng vấn đề người dùng gặp, giới thiệu giải pháp, các tính năng nổi bật, lợi ích thực tế, cách hoạt động và lời kêu gọi trải nghiệm.",
    defaults: ["emphasizeBenefits", "includeCta"],
  },
  summary: {
    label: "Tóm tắt nội dung",
    structure: "Nêu chủ đề chính, chắt lọc các ý quan trọng, số liệu hoặc khái niệm đáng chú ý, sau đó kết luận ngắn.",
    defaults: [],
  },
  explain: {
    label: "Giải thích kiến thức",
    structure: "Giải thích khái niệm, cách hoạt động, ví dụ thực tế, điểm dễ nhầm và kết luận dễ nhớ.",
    defaults: [],
  },
  compare: {
    label: "So sánh",
    structure: "Nêu tiêu chí, phân tích hai hoặc nhiều lựa chọn công bằng, chỉ rõ điểm mạnh, điểm yếu và trường hợp nên chọn từng phương án.",
    defaults: ["compareAlternatives"],
  },
  review: {
    label: "Review / đánh giá",
    structure: "Nêu ấn tượng ban đầu, ưu điểm, hạn chế, trải nghiệm hoặc giá trị thực tế và kết luận có nên dùng hay không.",
    defaults: [],
  },
  news: {
    label: "Tin tức / cập nhật",
    structure: "Nêu sự kiện mới, điều đã thay đổi, tác động thực tế, đối tượng bị ảnh hưởng và điều cần theo dõi tiếp theo.",
    defaults: [],
  },
  listicle: {
    label: "Danh sách / Top",
    structure: "Hook rõ ràng, trình bày các mục theo thứ tự, mỗi mục có lý do ngắn và kết luận tổng hợp.",
    defaults: ["numberedSteps"],
  },
};

const AUDIENCE_SPECS = {
  general: "đại chúng; dùng cách diễn đạt phổ thông và giải thích thuật ngữ khi cần",
  beginner: "người mới bắt đầu; giải thích từ nền tảng, tránh giả định kiến thức trước",
  intermediate: "người đã có kiến thức cơ bản; có thể dùng thuật ngữ nhưng vẫn cần ví dụ",
  expert: "người có chuyên môn; ưu tiên độ chính xác, chi tiết kỹ thuật và tránh giải thích quá sơ đẳng",
};

const DETAIL_SPECS = {
  concise: "ngắn gọn, đi thẳng vào ý chính, ít ví dụ",
  balanced: "cân bằng giữa giải thích và tốc độ, có ví dụ khi hữu ích",
  deep: "chuyên sâu, làm rõ nguyên nhân, hệ quả và lưu ý kỹ thuật",
};

function clip(value, max, fallback = "") {
  const text = String(value ?? fallback).replace(/\.{3,}|…/g, ".").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max + 1);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  if (sentenceEnd >= Math.floor(max * 0.55)) return window.slice(0, sentenceEnd + 1).trim();
  const wordEnd = window.lastIndexOf(" ");
  return window.slice(0, wordEnd > 0 ? wordEnd : max).trim();
}


function shortHookHeadline(value, fallback = "Điểm chính") {
  const text = String(value || fallback).replace(/\s+/g, " ").trim();
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  const words = firstSentence.split(/\s+/).filter(Boolean);
  const compact = words.slice(0, 7).join(" ").replace(/[,:;.!?]+$/g, "");
  return clip(compact || fallback, 42, fallback);
}

function minimumSceneWords(scene, index, total) {
  if (index === 0) return 14;
  if (index === total - 1) return 12;
  return 20;
}

function countWords(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
}

function wordsForDuration(durationSec, detailLevel) {
  const rate = detailLevel === "concise" ? 3.05 : detailLevel === "deep" ? 3.55 : 3.35;
  return Math.round(durationSec * rate);
}

function sceneCountForDuration(durationSec) {
  if (durationSec <= 65) return 7;
  if (durationSec <= 100) return 10;
  if (durationSec <= 190) return 15;
  return Math.max(5, Math.min(18, Math.round(durationSec / 12)));
}

export function getWordPlan(durationSec, detailLevel = "balanced") {
  const targetWords = wordsForDuration(durationSec, detailLevel);
  return {
    targetWords,
    minWords: Math.round(targetWords * 0.92),
    maxWords: Math.round(targetWords * 1.08),
    expectedScenes: sceneCountForDuration(durationSec),
  };
}

export function getDraftWordCount(draft) {
  return Array.isArray(draft?.scenes)
    ? draft.scenes.reduce((sum, scene) => sum + countWords(scene?.voiceText), 0)
    : 0;
}

function trimTextToWordBudget(value, budget) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= budget) return text;
  const clipped = words.slice(0, Math.max(8, budget)).join(" ");
  const threshold = Math.floor(clipped.length * 0.68);
  let lastBoundary = -1;
  for (const mark of [". ", "! ", "? ", "; ", ": "]) {
    const index = clipped.lastIndexOf(mark);
    if (index >= threshold) lastBoundary = Math.max(lastBoundary, index + 1);
  }
  return (lastBoundary > 0 ? clipped.slice(0, lastBoundary) : clipped).trim();
}

export function coerceDraftWordCount(draft, maxWords) {
  if (!draft || !Array.isArray(draft.scenes)) return draft;
  const totalWords = getDraftWordCount(draft);
  if (!totalWords || totalWords <= maxWords) return draft;
  const ratio = maxWords / totalWords;
  const adjusted = structuredClone(draft);
  const sceneTotal = adjusted.scenes.length;
  adjusted.scenes = adjusted.scenes.map((scene, index) => {
    const current = countWords(scene?.voiceText);
    const minimum = minimumSceneWords(scene, index, sceneTotal);
    const budget = Math.max(minimum, Math.floor(current * ratio));
    return { ...scene, voiceText: trimTextToWordBudget(scene?.voiceText, budget) };
  });

  // Giảm dần ở các cảnh dài, nhưng không làm cảnh giữa quá ngắn và mất nhịp kể.
  let guard = 0;
  while (getDraftWordCount(adjusted) > maxWords && guard < 120) {
    guard += 1;
    const candidates = adjusted.scenes
      .map((scene, index) => ({
        index,
        words: countWords(scene?.voiceText),
        minimum: minimumSceneWords(scene, index, adjusted.scenes.length),
      }))
      .filter((item) => item.words > item.minimum)
      .sort((a, b) => (b.words - b.minimum) - (a.words - a.minimum));
    if (!candidates.length) break;
    const item = candidates[0];
    const excess = getDraftWordCount(adjusted) - maxWords;
    adjusted.scenes[item.index].voiceText = trimTextToWordBudget(
      adjusted.scenes[item.index].voiceText,
      Math.max(item.minimum, item.words - Math.max(1, Math.min(5, excess))),
    );
  }
  return adjusted;
}

function normalizeHashtag(tag) {
  const value = String(tag || "").trim().replace(/\s+/g, "");
  if (!value) return null;
  return value.startsWith("#") ? value : `#${value}`;
}

function normalizeTemplate(data, position, total, voiceText) {
  const raw = data && typeof data === "object" ? data : {};
  let template = templateNames.has(raw.template) ? raw.template : "callout";
  if (position === 0) template = "hook";
  if (position === total - 1) template = "outro";

  switch (template) {
    case "hook":
      return {
        template,
        headline: shortHookHeadline(raw.headline || voiceText, "Thông tin đáng chú ý"),
        ...(raw.subhead ? { subhead: clip(raw.subhead, 90) } : {}),
        kenBurns: ["zoom-in", "zoom-out", "pan-left", "pan-right"].includes(raw.kenBurns) ? raw.kenBurns : "zoom-in",
        ...(raw.bgSrc ? { bgSrc: String(raw.bgSrc) } : {}),
      };
    case "comparison":
      return {
        template,
        left: {
          label: clip(raw.left?.label, 45, "Lựa chọn A"),
          value: clip(raw.left?.value, 35, "A"),
          color: raw.left?.color === "purple" ? "purple" : "cyan",
        },
        right: {
          label: clip(raw.right?.label, 45, "Lựa chọn B"),
          value: clip(raw.right?.value, 35, "B"),
          color: raw.right?.color === "cyan" ? "cyan" : "purple",
          ...(typeof raw.right?.winner === "boolean" ? { winner: raw.right.winner } : {}),
        },
      };
    case "stat-hero":
      return {
        template,
        value: clip(raw.value, 30, "Đáng chú ý"),
        label: clip(raw.label || voiceText, 90, "Thông tin chính"),
        ...(raw.context ? { context: clip(raw.context, 120) } : {}),
      };
    case "feature-list": {
      const bullets = Array.isArray(raw.bullets) ? raw.bullets.map((item) => clip(item, 100)).filter(Boolean).slice(0, 4) : [];
      return {
        template,
        title: clip(raw.title, 70, "Điểm chính"),
        bullets: bullets.length ? bullets : [clip(voiceText, 100, "Nội dung quan trọng")],
        ...(raw.icon ? { icon: clip(raw.icon, 10) } : {}),
      };
    }
    case "outro":
      return {
        template,
        ctaTop: clip(raw.ctaTop, 50, "Theo dõi để xem thêm"),
        channelName: clip(raw.channelName, 40, "Auto Video"),
        source: clip(raw.source, 90, "Nguồn trong mô tả"),
      };
    default:
      return {
        template: "callout",
        statement: clip(raw.statement || voiceText, 220, "Nội dung đáng chú ý"),
        ...(raw.tag ? { tag: clip(raw.tag, 30) } : {}),
      };
  }
}

function normalizeStyle(job) {
  const contentStyle = STYLE_SPECS[job.contentStyle] ? job.contentStyle : "summary";
  const detailLevel = DETAIL_SPECS[job.detailLevel] ? job.detailLevel : "balanced";
  const audience = AUDIENCE_SPECS[job.audience] ? job.audience : "general";
  const options = job.styleOptions && typeof job.styleOptions === "object" ? job.styleOptions : {};
  return { contentStyle, detailLevel, audience, options };
}

function styleOptionInstructions(style, options) {
  const active = new Set([
    ...(STYLE_SPECS[style]?.defaults || []),
    ...Object.entries(options || {}).filter(([, enabled]) => Boolean(enabled)).map(([key]) => key),
  ]);
  const lines = [];
  if (active.has("numberedSteps")) lines.push("Các bước hoặc mục chính phải được đánh số rõ ràng trong lời đọc.");
  if (active.has("includeWarnings")) lines.push("Phải có ít nhất một cảnh lưu ý hoặc cảnh báo rủi ro thực tế.");
  if (active.has("includeVerification")) lines.push("Phải hướng dẫn cách kiểm tra kết quả sau khi thực hiện.");
  if (active.has("showTerminalCommands")) lines.push("Giữ nguyên lệnh terminal và dành cảnh riêng cho lệnh quan trọng; không đọc ký tự thừa nếu gây khó nghe.");
  if (active.has("emphasizeBenefits")) lines.push("Nhấn mạnh lợi ích thực tế thay vì chỉ liệt kê tính năng.");
  if (active.has("includeCta")) lines.push("Cảnh cuối phải có lời kêu gọi hành động tự nhiên, không phô trương.");
  if (active.has("compareAlternatives")) lines.push("Phải nêu tiêu chí so sánh và trường hợp phù hợp cho từng lựa chọn.");
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- Không có yêu cầu bổ sung.";
}

function validateDraft(draft, expectedScenes, minWords, maxWords, checkWordCount = true) {
  const errors = [];
  if (!draft || typeof draft !== "object") return ["Kết quả không phải object"];
  if (!Array.isArray(draft.scenes)) errors.push("Thiếu mảng scenes");
  else {
    if (draft.scenes.length < 5) errors.push("scenes phải có ít nhất 5 cảnh");
    if (draft.scenes.length > 18) errors.push("scenes tối đa 18 cảnh");
    if (Math.abs(draft.scenes.length - expectedScenes) > 2) errors.push(`Cần khoảng ${expectedScenes} cảnh`);
    draft.scenes.forEach((scene, index) => {
      if (!scene?.voiceText || String(scene.voiceText).trim().length < 15) errors.push(`Cảnh ${index + 1} thiếu voiceText`);
      if (!scene?.templateData || typeof scene.templateData !== "object") errors.push(`Cảnh ${index + 1} thiếu templateData`);
    });
    const totalWords = getDraftWordCount(draft);
    if (checkWordCount && totalWords < minWords) errors.push(`Tổng lời đọc quá ngắn: ${totalWords} từ, cần ít nhất ${minWords} từ`);
    if (checkWordCount && totalWords > maxWords) errors.push(`Tổng lời đọc quá dài: ${totalWords} từ, tối đa ${maxWords} từ`);
  }
  return errors;
}

export function buildPrompts({ content, sourceTitle, durationSec, keepTerms, channelName, introText, contentStyle, detailLevel, audience, styleOptions }) {
  const style = STYLE_SPECS[contentStyle] ? contentStyle : "summary";
  const detail = DETAIL_SPECS[detailLevel] ? detailLevel : "balanced";
  const targetAudience = AUDIENCE_SPECS[audience] ? audience : "general";
  const { targetWords, expectedScenes, minWords, maxWords } = getWordPlan(durationSec, detail);

  const systemPrompt = `Bạn là biên tập viên video tiếng Việt và phải trả về DUY NHẤT một JSON object hợp lệ, không Markdown, không giải thích.
Viết tiếng Việt tự nhiên. Giữ nguyên tên riêng, từ chuyên ngành, lệnh terminal, tên biến, tên model, API, GitHub, Docker, Ubuntu, Proxmox, Cloudflare, SSH, VLAN, FFmpeg, HyperFrames và các thuật ngữ tiếng Anh khi dịch sẽ làm sai nghĩa.
Không bịa số liệu, không thêm thông tin không có trong nguồn. Câu đọc phải rõ, dễ nghe với TTS. Phần chữ trên màn hình phải ngắn, rõ, dễ đọc trên điện thoại và ngắn hơn lời đọc. Không cắt giữa từ, không dùng dấu ba chấm.
Riêng hook: headline chỉ 2-7 từ, tối đa 42 ký tự; chỉ nêu câu hỏi hoặc chủ đề chính, không chép nguyên lời đọc.
JSON phải có dạng:
{
  "title": "tiêu đề",
  "caption": "caption tiếng Việt ngắn",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4"],
  "scenes": [
    {
      "id": "hook",
      "type": "hook",
      "voiceText": "lời đọc đầy đủ",
      "templateData": {"template":"hook","headline":"2-7 từ, tối đa 42 ký tự","subhead":"tối đa 90 ký tự","kenBurns":"zoom-in"}
    }
  ]
}
Quy tắc scene:
- Cảnh đầu: type=hook, template=hook; headline phải cực ngắn, chỉ 2-7 từ.
- Cảnh thứ 2: là phần Intro/giới thiệu nội dung, type=body, template=callout, tag="GIỚI THIỆU"; giới thiệu ngắn gọn video sẽ nói về điều gì và vì sao đáng xem.
- Cảnh cuối: type=outro, template=outro.
- Cảnh giữa: type=body và dùng luân phiên comparison, stat-hero, feature-list, callout.
- comparison: left/right gồm label tối đa 45, value tối đa 35, color cyan hoặc purple; right có thể có winner.
- stat-hero: value tối đa 30, label tối đa 90, context tối đa 120.
- feature-list: title tối đa 70, bullets 1-4 mục, mỗi mục tối đa 100.
- callout: statement tối đa 220, tag tối đa 30.
- outro: ctaTop tối đa 50, channelName tối đa 40, source tối đa 90.
- Mọi id phải duy nhất, chỉ chữ thường, số và dấu gạch ngang.`;

  const userPrompt = `Hãy tạo kịch bản video khoảng ${durationSec} giây.
Phong cách nội dung: ${STYLE_SPECS[style].label}.
Cấu trúc bắt buộc: ${STYLE_SPECS[style].structure}
Mức độ chi tiết: ${DETAIL_SPECS[detail]}.
Đối tượng người xem: ${AUDIENCE_SPECS[targetAudience]}.
Yêu cầu tùy chọn:
${styleOptionInstructions(style, styleOptions)}
Mục tiêu tổng lời đọc: ${minWords}-${maxWords} từ tiếng Việt. Không được viết ngắn hơn mức tối thiểu.
Số cảnh mục tiêu: ${expectedScenes} cảnh. Mỗi cảnh giữa nên có ít nhất 20 từ lời đọc để tránh cảnh nói quá ngắn.
Tên kênh: ${channelName || "Auto Video"}.
Intro do người dùng yêu cầu: ${String(introText || "").trim() || "Không nhập; AI tự viết Intro ngắn dựa trên nội dung nguồn."}
Tiêu đề nguồn: ${sourceTitle || "Không có tiêu đề"}.
Các từ bắt buộc giữ nguyên: ${keepTerms || "không có thêm"}.

NỘI DUNG NGUỒN:
${content}`;

  return { systemPrompt, userPrompt, expectedScenes, targetWords, minWords, maxWords };
}

export function buildRepairPrompt(draft, errors, prompts, attempt = 1) {
  const currentWords = getDraftWordCount(draft);
  return `JSON trước chưa đạt yêu cầu. Đây là vòng sửa ${attempt}. Hãy trả về DUY NHẤT JSON hoàn chỉnh.
Lỗi cần sửa:
- ${errors.join("\n- ")}
Hiện tại: ${currentWords} từ. Số cảnh mục tiêu: ${prompts.expectedScenes}.
Tổng lời đọc bắt buộc: ${prompts.minWords}-${prompts.maxWords} từ.
Nếu quá dài, rút gọn từng voiceText nhưng giữ đủ ý; không làm cảnh giữa ngắn dưới khoảng 20 từ. Nếu quá ngắn, bổ sung giải thích có căn cứ từ nguồn.
Không xóa thông tin đúng, không bịa nội dung, không dùng dấu ba chấm trong chữ hiển thị.
JSON cần sửa:
${JSON.stringify(draft)}`;
}

export function getDurationWordPlan(draft, details) {
  const currentWords = getDraftWordCount(draft);
  const ratio = details.actualDurationSec > 0 ? details.targetDurationSec / details.actualDurationSec : 1;
  const targetWords = Math.max(40, Math.round(currentWords * Math.max(0.6, Math.min(1.5, ratio))));
  return {
    targetWords,
    minWords: Math.max(30, Math.round(targetWords * 0.96)),
    maxWords: Math.round(targetWords * 1.04),
  };
}

export function buildDurationRepairPrompt(draft, details) {
  const currentWords = getDraftWordCount(draft);
  const { targetWords: desiredWords, minWords, maxWords } = getDurationWordPlan(draft, details);
  const action = details.actualDurationSec > details.maxDurationSec ? "rút gọn" : "mở rộng";
  return `Giọng đọc thực tế chưa khớp thời lượng video. Hãy ${action} kịch bản và trả về DUY NHẤT JSON hoàn chỉnh.
Thời lượng mục tiêu: ${details.targetDurationSec} giây; khoảng chấp nhận: ${details.minDurationSec}-${details.maxDurationSec} giây.
Thời lượng LucyLab đo được: ${details.actualDurationSec.toFixed(1)} giây với ${currentWords} từ.
Hãy điều chỉnh tổng voiceText về khoảng ${minWords}-${maxWords} từ.
Giữ nguyên chủ đề, dữ kiện, thứ tự logic, số cảnh gần như hiện tại và toàn bộ cấu trúc JSON.
Phần chữ trên màn hình phải chứa trọn ý; không dùng dấu ba chấm và không bịa thêm dữ kiện.
JSON cần sửa:
${JSON.stringify(draft)}`;
}

export function createScriptFromDraft(draft, source, job, channelName, options = {}) {
  const normalized = normalizeStyle(job);
  const { minWords, maxWords, expectedScenes } = getWordPlan(job.durationSec, normalized.detailLevel);
  const errors = validateDraft(draft, expectedScenes, minWords, maxWords, !options.allowWordMismatch);
  if (errors.length) {
    const error = new Error(`Kịch bản AI chưa hợp lệ: ${errors.join("; ")}`);
    error.validationErrors = errors;
    error.expectedScenes = expectedScenes;
    error.minWords = minWords;
    error.maxWords = maxWords;
    throw error;
  }

  const scenes = draft.scenes.slice(0, 18).map((raw, index, all) => {
    const voiceText = clip(raw.voiceText, 1600, "Nội dung đang được trình bày.");
    const idBase = String(raw.id || `scene-${index + 1}`)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `scene-${index + 1}`;
    const id = `${index + 1}-${idBase}`;
    const type = index === 0 ? "hook" : index === all.length - 1 ? "outro" : "body";
    const templateData = normalizeTemplate(raw.templateData, index, all.length, voiceText);
    if (type === "outro" && templateData.template === "outro") {
      templateData.channelName = clip(channelName, 40, "Auto Video");
    }
    return { id, type, voiceText, templateData };
  });

  const requestedIntro = String(job.introText || "").trim();
  if (scenes.length >= 3) {
    const intro = scenes[1];
    intro.type = "body";
    intro.id = intro.id || "2-intro";
    if (requestedIntro) {
      intro.voiceText = clip(requestedIntro, 1600, requestedIntro);
      intro.templateData = {
        template: "callout",
        tag: "GIỚI THIỆU",
        statement: clip(requestedIntro, 220, "Giới thiệu nội dung"),
      };
    } else if (intro.templateData?.template === "callout") {
      intro.templateData.tag = intro.templateData.tag || "GIỚI THIỆU";
    }
  }

  const title = clip(draft.title || source.title || job.requestedTitle, 160, "Auto Video");
  const hashtags = (Array.isArray(draft.hashtags) ? draft.hashtags : [])
    .map(normalizeHashtag)
    .filter(Boolean)
    .slice(0, 4);
  while (hashtags.length < 4) {
    for (const fallback of ["#KienThuc", "#CongNghe", "#VideoViet", "#AutoVideo"]) {
      if (hashtags.length >= 4) break;
      if (!hashtags.includes(fallback)) hashtags.push(fallback);
    }
  }
  const caption = `${clip(draft.caption || title, 300)}\n\n${hashtags.join(" ")}`;

  return {
    script: {
      version: "1.0",
      metadata: {
        title,
        source: { url: source.sourceUrl || "", domain: source.domain || "local-input", image: source.image || null },
        channel: clip(channelName, 30, "Auto Video"),
      },
      voice: { provider: "lucylab", voiceId: "${VIETNAMESE_VOICEID}", speed: 1.0 },
      scenes,
    },
    caption,
    wordCount: scenes.reduce((sum, scene) => sum + countWords(scene.voiceText), 0),
  };
}
