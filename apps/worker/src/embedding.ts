import { env } from "./config";

export type EmbeddingProvider = "local" | "openai";

interface EmbeddingService {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  dimension(): number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export { cosineSimilarity };

class LocalEmbeddingService implements EmbeddingService {
  private pipeline: any = null;
  private readonly model: string;
  private readonly dim: number;
  private ready = false;

  constructor(model: string, dim: number) {
    this.model = model;
    this.dim = dim;
  }

  private async ensure(): Promise<void> {
    if (this.ready) return;
    const { pipeline } = await import("@huggingface/transformers");
    this.pipeline = await pipeline("feature-extraction", this.model);
    this.ready = true;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    await this.ensure();
    const out: number[][] = [];
    for (const t of texts) {
      const result = await this.pipeline(t, { pooling: "mean", normalize: true });
      const data = Array.from(result.data as Float32Array);
      out.push(data);
    }
    return out;
  }

  dimension(): number {
    return this.dim;
  }
}

class OpenAIEmbeddingService implements EmbeddingService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dim: number;

  constructor(baseUrl: string, apiKey: string, model: string, dim: number) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.dim = dim;
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.embedBatch([text]);
    return v;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, input: texts, encoding_format: "float" }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Embedding API error ${res.status}: ${txt}`);
    }
    const json = await res.json();
    return json.data.map((d: { embedding: number[] }) => d.embedding);
  }

  dimension(): number {
    return this.dim;
  }
}

function buildService(): EmbeddingService {
  const provider = (env("EMBEDDING_PROVIDER", "local") as EmbeddingProvider) ?? "local";
  const dim = Number(env("EMBEDDING_DIM", "384")) || 384;

  if (provider === "openai") {
    const model = env("EMBEDDING_MODEL", "text-embedding-3-small");
    const baseUrl = env("EMBEDDING_BASE_URL", "http://localhost:11434/v1");
    const apiKey = env("EMBEDDING_API_KEY", "");
    return new OpenAIEmbeddingService(baseUrl, apiKey, model, dim);
  }

  const model = env("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2");
  return new LocalEmbeddingService(model, dim);
}

let service: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!service) service = buildService();
  return service;
}

export async function embedText(text: string): Promise<number[]> {
  return getEmbeddingService().embed(text);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return getEmbeddingService().embedBatch(texts);
}

export function embeddingDimension(): number {
  return getEmbeddingService().dimension();
}

export async function embedTextsBatched(
  texts: string[],
  batchSize: number,
): Promise<number[][]> {
  const svc = getEmbeddingService();
  const size = batchSize > 0 ? batchSize : 8;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    const slice = texts.slice(i, i + size);
    const vecs = await svc.embedBatch(slice);
    out.push(...vecs);
  }
  return out;
}
