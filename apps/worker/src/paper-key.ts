export function normalizePaperKey(input: string): string {
  const lower = input.toLowerCase();
  return lower
    .replace(/https?:\/\//, "")
    .replace(/www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(solutions?|sol|answer[ -]?key|key|\.pdf)$/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();
}

export function extractPaperKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const filename = path.split("/").pop() || "";
    return normalizePaperKey(filename);
  } catch {
    return normalizePaperKey(url);
  }
}

export function extractPaperKeyFromTitle(title: string): string {
  return normalizePaperKey(title);
}

export function inferDocKind(paperKey: string, title: string, url: string): "questions" | "solutions" | "unknown" {
  const combined = `${paperKey} ${title} ${url}`.toLowerCase();
  if (/(solutions?|sol|answer[ -]?key|key)/.test(paperKey) || /solution|answer[ -]?key/i.test(title)) {
    return "solutions";
  }
  if (/(question|paper|memory|prelims?|pre|mains?|mock)/i.test(title) || /(question|paper|prelims?|pre|mains?|mock)/i.test(url)) {
    return "questions";
  }
  return "unknown";
}

export function isSolutionsDoc(paperKey: string, title: string, url: string): boolean {
  return inferDocKind(paperKey, title, url) === "solutions";
}

export function pairPaperKeys(keys: string[]): Map<string, { questions?: string; solutions?: string }> {
  const map = new Map<string, { questions?: string; solutions?: string }>();
  for (const key of keys) {
    const base = key.replace(/-(solutions?|sol|answer[ -]?key)$/, "");
    const entry = map.get(base) || {};
    if (isSolutionsDoc(key, "", "")) entry.solutions = key;
    else entry.questions = key;
    map.set(base, entry);
  }
  return map;
}