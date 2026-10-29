import { config } from "./config";

export interface NimClientOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  visionModel?: string;
  maxTokens?: number;
  timeoutMs?: number;
  rateLimitDelayMs?: number;
  enableThinking?: boolean;
}

export interface NimMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
}

export interface NimChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    reasoning_content?: string;
  };
  finish_reason: string | null;
}

export interface NimResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: NimChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens: number; audio_tokens: number | null };
    completion_tokens_details?: { reasoning_tokens: number };
  };
}

export interface NimModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export class NimClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private visionModel: string;
  private maxTokens: number;
  private timeoutMs: number;
  private minDelayMs: number;
  private lastRequestTime: number = 0;
  private enableThinking: boolean;

  constructor(opts: NimClientOptions = {}) {
    this.baseUrl = opts.baseUrl || config.nimBaseUrl || "https://integrate.api.nvidia.com/v1";
    this.apiKey = opts.apiKey ?? config.nvidiaApiKey ?? "";
    this.model = opts.model || config.nimModel || "nvidia/nemotron-3.5-super-vl-120b-a12b";
    this.visionModel = opts.visionModel || config.nimVisionModel || this.model;
    this.maxTokens = opts.maxTokens ?? config.nimMaxTokens ?? 16384;
    this.timeoutMs = opts.timeoutMs ?? config.nimTimeoutMs ?? 120000;
    this.minDelayMs = opts.rateLimitDelayMs ?? config.nimRateLimitDelayMs ?? 1500;
    this.enableThinking = opts.enableThinking ?? config.nimEnableThinking ?? false;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minDelayMs) {
      await new Promise((r) => setTimeout(r, this.minDelayMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private buildHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async listModels(): Promise<NimModel[]> {
    const res = await fetch(`${this.baseUrl}/models`, {
      method: "GET",
      headers: this.buildHeaders(),
    });
    if (!res.ok) throw new Error(`Models list failed: ${res.status}`);
    const json = await res.json();
    return json.data || [];
  }

  async chat(
    messages: NimMessage[],
    opts: {
      model?: string;
      temperature?: number;
      topP?: number;
      maxTokens?: number;
      responseFormat?: { type: "json_object" } | { type: "text" };
      stream?: boolean;
      enableThinking?: boolean;
    } = {}
  ): Promise<{ response: NimResponse; raw: string }> {
    await this.throttle();

    const useModel = opts.model ?? (messages.some((m) =>
      Array.isArray(m.content) && m.content.some((c) => c.type === "image_url")
    ) ? this.visionModel : this.model);

    const body: any = {
      model: useModel,
      messages,
      temperature: opts.temperature ?? 0.1,
      top_p: opts.topP ?? 0.95,
      max_tokens: opts.maxTokens ?? this.maxTokens,
      stream: opts.stream ?? false,
    };

    if (opts.responseFormat) {
      body.response_format = opts.responseFormat;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const text = await res.text();
      if (!res.ok) {
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after");
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5000;
          await new Promise((r) => setTimeout(r, waitMs));
          return this.chat(messages, opts);
        }
        throw new Error(`NIM chat failed ${res.status}: ${text.slice(0, 500)}`);
      }

      const json = JSON.parse(text);
      return { response: json, raw: text };
    } finally {
      clearTimeout(timeout);
    }
  }

  async chatJson<T>(messages: NimMessage[], opts: Omit<Parameters<NimClient["chat"]>[1], "responseFormat"> = {}): Promise<T> {
    const { response } = await this.chat(messages, { ...opts, responseFormat: { type: "json_object" }, maxTokens: Math.max(opts.maxTokens ?? this.maxTokens, 8192) });
    let content = response.choices[0]?.message?.content;
    if (!content) {
      const reasoning = response.choices[0]?.message?.reasoning_content;
      if (reasoning) {
        // Try to extract JSON from reasoning content
        const jsonMatch = reasoning.match(/\{[\s\S]*\}/);
        if (jsonMatch) content = jsonMatch[0];
      }
    }
    if (!content) throw new Error("Empty response content");
    return JSON.parse(content) as T;
  }

  async chatJsonWithRetry<T>(messages: NimMessage[], opts: Parameters<NimClient["chatJson"]>[1] = {}, maxRetries = 2): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.chatJson<T>(messages, opts);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }
}

export function buildNimClient(opts?: NimClientOptions): NimClient | null {
  const key = opts?.apiKey ?? config.nvidiaApiKey;
  if (!key || key.trim() === "") return null;
  return new NimClient(opts);
}