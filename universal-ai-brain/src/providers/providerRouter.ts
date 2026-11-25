import { GoogleGenAI, ThinkingLevel } from "@google/genai";

export type ProviderKind = "local" | "openai_compat" | "gemini";

export interface ProviderConfig {
  providerOrder?: ProviderKind[];
  localUrl?: string;
  localModel?: string;
  localApiKey?: string;
  openaiCompatUrl?: string;
  openaiCompatModel?: string;
  openaiCompatKey?: string;
  geminiApiKey?: string;
  geminiPrimaryModel?: string;
  geminiFallbackModel?: string;
  timeoutMs?: number;
}

export interface LlmCallInput {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LlmCallResult {
  rawText: string;
  provider: ProviderKind;
  model: string;
  latencyMs: number;
}

const cooldownUntilMap = new Map<string, number>();

function cleanSecret(raw?: string): string {
  if (!raw) return "";
  const s = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!s || s === "undefined" || s === "null" || s === "MY_GEMINI_API_KEY") return "";
  return s;
}

export function extractJsonFromLlmText(rawText: string): any {
  let cleaned = (rawText || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("Model output did not contain valid JSON.");
  }
}

export function resolveConfiguredProviders(cfg: ProviderConfig = {}): Array<{
  kind: ProviderKind;
  label: string;
  configured: boolean;
}> {
  const order = cfg.providerOrder || parseProviderOrder(process.env.BRAIN_PROVIDER_ORDER);
  const localUrl = cleanSecret(cfg.localUrl ?? process.env.LOCAL_LLM_URL);
  const compatUrl = cleanSecret(cfg.openaiCompatUrl ?? process.env.OPENAI_COMPAT_URL);
  const compatKey = cleanSecret(cfg.openaiCompatKey ?? process.env.OPENAI_COMPAT_KEY);
  const geminiKey = cleanSecret(
    cfg.geminiApiKey ??
      process.env.GEMINI_API_KEY ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      process.env.GOOGLE_API_KEY
  );

  return order.map((kind) => {
    if (kind === "local") {
      return { kind, label: localUrl || "local-llm", configured: Boolean(localUrl) };
    }
    if (kind === "openai_compat") {
      return {
        kind,
        label: compatUrl || "openai-compatible",
        configured: Boolean(compatUrl && compatKey),
      };
    }
    return { kind, label: "gemini", configured: Boolean(geminiKey) };
  });
}

function parseProviderOrder(raw?: string): ProviderKind[] {
  const valid: ProviderKind[] = ["local", "openai_compat", "gemini"];
  if (!raw || !raw.trim()) return valid;
  const parsed = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderKind => valid.includes(s as ProviderKind));
  return parsed.length > 0 ? parsed : valid;
}

async function callOpenAiEndpoint(opts: {
  kind: "local" | "openai_compat";
  baseUrl: string;
  model: string;
  apiKey?: string;
  input: LlmCallInput;
  timeoutMs: number;
}): Promise<LlmCallResult> {
  const started = Date.now();
  const base = opts.baseUrl.replace(/\/$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;

  const doPost = async (withResponseFormat: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const payload: Record<string, any> = {
        model: opts.model,
        messages: [
          { role: "system", content: opts.input.systemPrompt },
          { role: "user", content: opts.input.userPrompt },
        ],
        temperature: opts.input.temperature ?? 0.2,
        max_tokens: opts.input.maxTokens ?? 2000,
      };
      if (withResponseFormat && opts.input.jsonMode !== false) {
        payload.response_format = { type: "json_object" };
      }
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    } finally {
      clearTimeout(timer);
    }
  };

  let res = await doPost(true);
  if (!res.ok && res.status === 400) {
    res = await doPost(false);
  }
  if (!res.ok) {
    const err: any = new Error(`${opts.kind} HTTP ${res.status}: ${res.text.slice(0, 180)}`);
    err.status = res.status;
    throw err;
  }

  const parsed = JSON.parse(res.text);
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`${opts.kind} returned empty content.`);
  }

  return {
    rawText: content.trim(),
    provider: opts.kind,
    model: opts.model,
    latencyMs: Date.now() - started,
  };
}

async function callGeminiEndpoint(opts: {
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
  input: LlmCallInput;
  timeoutMs: number;
}): Promise<LlmCallResult> {
  const ai = new GoogleGenAI({
    apiKey: opts.apiKey,
    httpOptions: { timeout: opts.timeoutMs, headers: { "User-Agent": "aistudio-build" } },
  });

  const attempts = [
    { model: opts.primaryModel, thinkingLevel: ThinkingLevel.MEDIUM },
    { model: opts.fallbackModel, thinkingLevel: undefined },
  ];

  let lastErr: unknown;
  for (const attempt of attempts) {
    const cooldownKey = `gemini:${attempt.model}`;
    const blockedUntil = cooldownUntilMap.get(cooldownKey) || 0;
    if (Date.now() < blockedUntil) continue;

    const started = Date.now();
    try {
      const config: Record<string, any> = {
        systemInstruction: opts.input.systemPrompt,
      };
      if (opts.input.jsonMode !== false) {
        config.responseMimeType = "application/json";
      }
      if (attempt.thinkingLevel) {
        config.thinkingConfig = { thinkingLevel: attempt.thinkingLevel };
      }
      const resp: any = await ai.models.generateContent({
        model: attempt.model,
        contents: [{ parts: [{ text: opts.input.userPrompt }] }],
        config,
      });
      const text = String(resp?.text || "").trim();
      if (!text) throw new Error(`Empty output from ${attempt.model}`);
      return {
        rawText: text,
        provider: "gemini",
        model: attempt.model,
        latencyMs: Date.now() - started,
      };
    } catch (err: any) {
      const status = Number(err?.status) || 0;
      const msg = String(err?.message || err || "").toLowerCase();
      if (status === 429 || msg.includes("resource_exhausted")) {
        cooldownUntilMap.set(cooldownKey, Date.now() + 45_000);
      }
      lastErr = err;
      if (status === 401 || status === 403) break;
    }
  }
  throw lastErr || new Error("All Gemini attempts failed.");
}

export async function routeLlmCall(
  input: LlmCallInput,
  cfg: ProviderConfig = {}
): Promise<LlmCallResult> {
  const timeoutMs = cfg.timeoutMs ?? Number(process.env.BRAIN_TIMEOUT_MS || 60000);
  const providers = resolveConfiguredProviders(cfg).filter((p) => p.configured);

  if (providers.length === 0) {
    throw new Error(
      "No AI provider configured. Set LOCAL_LLM_URL (Ollama/llama.cpp), OPENAI_COMPAT_URL+OPENAI_COMPAT_KEY (Groq/OpenRouter), or GEMINI_API_KEY."
    );
  }

  const errors: string[] = [];

  for (const p of providers) {
    const blockedUntil = cooldownUntilMap.get(p.kind) || 0;
    if (Date.now() < blockedUntil) {
      errors.push(`${p.kind}: cooling down after rate-limit`);
      continue;
    }

    try {
      if (p.kind === "local") {
        return await callOpenAiEndpoint({
          kind: "local",
          baseUrl: cleanSecret(cfg.localUrl ?? process.env.LOCAL_LLM_URL),
          model: cleanSecret(cfg.localModel ?? process.env.LOCAL_LLM_MODEL) || "qwen2.5:7b-instruct",
          apiKey: cleanSecret(cfg.localApiKey ?? process.env.LOCAL_LLM_API_KEY) || undefined,
          input,
          timeoutMs,
        });
      }

      if (p.kind === "openai_compat") {
        return await callOpenAiEndpoint({
          kind: "openai_compat",
          baseUrl: cleanSecret(cfg.openaiCompatUrl ?? process.env.OPENAI_COMPAT_URL),
          model:
            cleanSecret(cfg.openaiCompatModel ?? process.env.OPENAI_COMPAT_MODEL) ||
            "llama-3.3-70b-versatile",
          apiKey: cleanSecret(cfg.openaiCompatKey ?? process.env.OPENAI_COMPAT_KEY),
          input,
          timeoutMs,
        });
      }

      const geminiKey = cleanSecret(
        cfg.geminiApiKey ??
          process.env.GEMINI_API_KEY ??
          process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
          process.env.GOOGLE_API_KEY
      );
      return await callGeminiEndpoint({
        apiKey: geminiKey,
        primaryModel: cleanSecret(cfg.geminiPrimaryModel ?? process.env.GEMINI_PRIMARY_MODEL) || "gemini-4-hydrogen",
        fallbackModel: cleanSecret(cfg.geminiFallbackModel ?? process.env.GEMINI_FALLBACK_MODEL) || "gemini-3.1-flash-lite",
        input,
        timeoutMs,
      });
    } catch (err: any) {
      const status = Number(err?.status) || 0;
      if (status === 429) {
        cooldownUntilMap.set(p.kind, Date.now() + 30_000);
      }
      errors.push(`${p.kind}: ${String(err?.message || err).slice(0, 140)}`);
    }
  }

  throw new Error(`All configured providers failed -> ${errors.join(" | ")}`);
}
