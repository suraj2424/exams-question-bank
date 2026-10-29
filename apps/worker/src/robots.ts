export interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
}

export interface RobotsData {
  rules: RobotsRule[];
  raw: string;
}

export function parseRobots(text: string): RobotsData {
  const rules: RobotsRule[] = [];
  let current: RobotsRule | null = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      current = { userAgent: value.toLowerCase(), allow: [], disallow: [] };
      rules.push(current);
    } else if (current) {
      if (field === "disallow") current.disallow.push(value);
      else if (field === "allow") current.allow.push(value);
      else if (field === "crawl-delay") {
        const n = Number(value);
        if (!Number.isNaN(n)) current.crawlDelay = n;
      }
    }
  }
  return { rules, raw: text };
}

function matchesPattern(path: string, pattern: string): boolean {
  if (pattern === "") return false;
  // support * wildcard
  const regex = new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "");
  // robots matching is prefix-based; ensure startsWith semantics with wildcard
  return regex.test(path);
}

function groupFor(robots: RobotsData, userAgent: string): RobotsRule | null {
  const ua = userAgent.toLowerCase();
  let exact: RobotsRule | null = null;
  let wildcard: RobotsRule | null = null;
  for (const r of robots.rules) {
    if (r.userAgent === "*") wildcard = r;
    else if (ua.includes(r.userAgent) || r.userAgent.includes(ua)) exact = r;
  }
  return exact || wildcard;
}

export function isRobotsAllowed(robots: RobotsData, userAgent: string, path: string): boolean {
  const group = groupFor(robots, userAgent);
  if (!group) return true;
  let allowed = true;
  let longestMatch = -1;
  // determine longest matching rule
  const candidates: { type: "allow" | "disallow"; pattern: string }[] = [];
  for (const p of group.disallow) candidates.push({ type: "disallow", pattern: p });
  for (const p of group.allow) candidates.push({ type: "allow", pattern: p });
  for (const c of candidates) {
    if (c.pattern === "") continue;
    if (matchesPattern(path, c.pattern)) {
      if (c.pattern.length > longestMatch) {
        longestMatch = c.pattern.length;
        allowed = c.type === "allow";
      } else if (c.pattern.length === longestMatch) {
        // allow overrides on tie
        if (c.type === "allow") allowed = true;
      }
    }
  }
  // if no disallow matched, allowed
  if (longestMatch < 0) return true;
  return allowed;
}

export function robotsCrawlDelay(robots: RobotsData, userAgent: string): number | undefined {
  const group = groupFor(robots, userAgent);
  return group?.crawlDelay;
}
