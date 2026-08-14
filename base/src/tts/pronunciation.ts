interface PronunciationRule {
  source: string;
  spoken: string;
}

const DEFAULT_RULES: PronunciationRule[] = [
  { source: "OSI", spoken: "ô ét ai" },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCustomRules(raw: string | undefined): PronunciationRule[] {
  if (!raw) return [];
  const rules: PronunciationRule[] = [];
  for (const entry of raw.split(/\r?\n|;/)) {
    const line = entry.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const source = line.slice(0, separator).trim();
    const spoken = line.slice(separator + 1).trim();
    if (!source || !spoken) continue;
    rules.push({ source, spoken });
  }
  return rules;
}

function loadRules(): PronunciationRule[] {
  const merged = new Map<string, PronunciationRule>();
  for (const rule of [...DEFAULT_RULES, ...parseCustomRules(process.env.TTS_PRONUNCIATION_RULES)]) {
    merged.set(rule.source.toLocaleLowerCase("vi"), rule);
  }
  return [...merged.values()].sort((a, b) => b.source.length - a.source.length);
}

export function applyTtsPronunciation(text: string): string {
  let result = text;
  for (const rule of loadRules()) {
    const escaped = escapeRegExp(rule.source);
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "giu");
    result = result.replace(pattern, (_match, prefix: string) => `${prefix}${rule.spoken}`);
  }
  return result;
}
