export interface SourceLike {
  id: string;
  baseUrl: string;
  allowedDomains: string[];
  rightsStatus?: string | null;
  robotsReviewedDate?: Date | string | null;
  allowedToCrawl?: boolean;
  allowedToIngestText?: boolean;
  allowedToDisplay?: boolean;
  status?: string | null;
  termsUrl?: string | null;
  licenceDocumentUrl?: string | null;
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
}

export function urlHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function domainAllowed(host: string, allowedDomains: string[]): boolean {
  const h = normalizeDomain(host);
  return allowedDomains.some((d) => {
    const dom = normalizeDomain(d);
    return h === dom || h.endsWith("." + dom);
  });
}

export function termsReviewed(source: SourceLike): boolean {
  if (source.robotsReviewedDate) return true;
  if (source.termsUrl) return true;
  if (source.licenceDocumentUrl) return true;
  if ((source as any).evidencePath) return true;
  return false;
}

export interface GateResult {
  ok: boolean;
  reasons: string[];
}

export function crawlGate(source: SourceLike | null | undefined, url: string): GateResult {
  const reasons: string[] = [];
  if (!source) {
    reasons.push("source not found");
    return { ok: false, reasons };
  }
  if (!source.allowedToCrawl) reasons.push("allowed_to_crawl is false");
  const host = urlHost(url);
  if (!host) reasons.push("invalid url");
  else if (!domainAllowed(host, source.allowedDomains || [])) reasons.push("url domain not in allowlist");
  if (!termsReviewed(source)) reasons.push("terms not reviewed (robotsReviewedDate missing)");
  return { ok: reasons.length === 0, reasons };
}

export function ingestGate(source: SourceLike | null | undefined): GateResult {
  const reasons: string[] = [];
  if (!source) {
    reasons.push("source not found");
    return { ok: false, reasons };
  }
  if (!source.allowedToIngestText) reasons.push("allowed_to_ingest_text is false");
  if (!termsReviewed(source)) reasons.push("terms not reviewed");
  return { ok: reasons.length === 0, reasons };
}

export function displayGate(source: SourceLike | null | undefined): GateResult {
  const reasons: string[] = [];
  if (!source) {
    reasons.push("source not found");
    return { ok: false, reasons };
  }
  if (!source.allowedToDisplay) reasons.push("allowed_to_display is false");
  return { ok: reasons.length === 0, reasons };
}

export function assertCrawlAllowed(source: SourceLike | null | undefined, url: string): void {
  const r = crawlGate(source, url);
  if (!r.ok) throw new Error("Crawl not allowed: " + r.reasons.join("; "));
}

export const canCrawl = crawlGate;
export const isCrawlAllowed = (s: any, u: string) => crawlGate(s, u).ok;
export const crawlAllowed = isCrawlAllowed;
export function assertAllowedToCrawl(s: any, u: string) { return assertCrawlAllowed(s, u); }
export const canIngest = (s: any) => ingestGate(s).ok;
export const canDisplay = (s: any) => displayGate(s).ok;

export const canCrawlSource = crawlGate;


