export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === null || v === "") return fallback ?? "";
  return v;
}

export const config = {
  databaseUrl: env("DATABASE_URL"),
  userAgent: env("CRAWLER_USER_AGENT", "IBPSQuestionBankCrawler/1.0 (+mailto:contact@example.com)"),
  delayMs: Number(env("CRAWLER_DELAY_MS", "2000")),
  maxPages: Number(env("CRAWLER_MAX_PAGES", "50")),
  timeoutMs: Number(env("CRAWLER_TIMEOUT_MS", "20000")),
  storagePath: env("STORAGE_PATH", "./storage"),
  adminToken: env("ADMIN_TOKEN"),
  nvidiaApiKey: env("NVIDIA_API_KEY"),
  nimBaseUrl: env("NIM_BASE_URL"),
  nimModel: env("NIM_MODEL"),
  nimVisionModel: env("NIM_VISION_MODEL"),
  nimMaxTokens: Number(env("NIM_MAX_TOKENS", "16384")),
  nimTimeoutMs: Number(env("NIM_TIMEOUT_MS", "120000")),
  nimRateLimitDelayMs: Number(env("NIM_RATE_LIMIT_DELAY_MS", "1500")),
  nimEnableThinking: env("NIM_ENABLE_THINKING", "false") === "true",
  nimMinConfidence: Number(env("NIM_MIN_CONFIDENCE", "0.85")),
};
