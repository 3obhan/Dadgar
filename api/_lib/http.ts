import Stripe from "stripe";

export const PDF_PRICE_USD_CENTS = 100;
export const PDF_PRICE_TOMAN = 50000;
export const PDF_PRICE_RIAL = PDF_PRICE_TOMAN * 10;

export interface SharedCaseItem {
  id: string;
  partyA: { name: string; claimText: string; evidenceNotes?: string };
  partyB: { name: string; claimText: string; evidenceNotes?: string };
  lang: "fa" | "en";
  createdAt: number;
  updatedAt?: number;
  verdict?: any;
}

const g = globalThis as any;
if (!g.__dadgarPaidDecrees) g.__dadgarPaidDecrees = new Set<string>();
if (!g.__dadgarSharedCases) g.__dadgarSharedCases = new Map<string, SharedCaseItem>();
if (!g.__dadgarPendingZibal) {
  g.__dadgarPendingZibal = new Map<
    string,
    { decreeCode: string; amountRial: number; createdAt: number }
  >();
}

export const paidDecreesSet: Set<string> = g.__dadgarPaidDecrees;
export const sharedCasesMap: Map<string, SharedCaseItem> = g.__dadgarSharedCases;
export const pendingZibalMap: Map<
  string,
  { decreeCode: string; amountRial: number; createdAt: number }
> = g.__dadgarPendingZibal;

export function setCorsHeaders(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Goog-Api-Key, X-Api-Key, User-Agent"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function handleCorsAndOptions(req: any, res: any): boolean {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

export function parseBody(req: any): Record<string, any> {
  if (!req?.body) return {};
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString("utf8"));
    } catch {
      return {};
    }
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return typeof req.body === "object" ? req.body : {};
}

export async function parseBodyAsync(req: any): Promise<Record<string, any>> {
  const direct = parseBody(req);
  if (Object.keys(direct).length > 0) return direct;
  if (req?.body !== undefined && req?.body !== null) return direct;

  if (req && typeof req[Symbol.asyncIterator] === "function") {
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(buf);
        total += buf.length;
        if (total > 8 * 1024 * 1024) break;
      }
      if (total > 0) {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
    } catch {
      return {};
    }
  }
  return {};
}

export function getEnvValue(key: string): string {
  const raw = process.env[key];
  if (!raw) return "";
  const cleaned = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!cleaned || cleaned === "MY_GEMINI_API_KEY") return "";
  return cleaned;
}

export function getGeminiKey(req?: any): string {
  const candidates = [
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "API_KEY",
    "GEMINI_KEY",
    "VITE_GEMINI_API_KEY",
    "NEXT_PUBLIC_GEMINI_API_KEY",
  ];
  for (const name of candidates) {
    const val = getEnvValue(name);
    if (val) return val;
  }
  if (req?.headers) {
    const customHeader =
      (req.headers["x-goog-api-key"] as string) || (req.headers["x-api-key"] as string);
    if (customHeader) {
      const cleaned = String(customHeader).trim().replace(/^["']+|["']+$/g, "").trim();
      if (cleaned && cleaned !== "MY_GEMINI_API_KEY") return cleaned;
    }
  }
  return "";
}

export function getStripe(): Stripe | null {
  const secretKey = getEnvValue("STRIPE_SECRET_KEY");
  if (!secretKey || !secretKey.startsWith("sk_")) return null;
  return new Stripe(secretKey);
}

export function getZibalMerchant(): string {
  return getEnvValue("ZIBAL_MERCHANT") || getEnvValue("ZIBAL_MERCHANT_ID");
}

export function getAppBaseUrl(req: any): string {
  const envUrl = getEnvValue("APP_URL");
  if (envUrl) return envUrl.replace(/\/$/, "");
  const headers = req?.headers || {};
  const origin = headers["origin"];
  if (typeof origin === "string" && origin.startsWith("http")) {
    return origin.replace(/\/$/, "");
  }
  const referer = headers["referer"];
  if (typeof referer === "string" && referer.startsWith("http")) {
    try {
      return new URL(referer).origin.replace(/\/$/, "");
    } catch {}
  }
  const proto =
    (typeof headers["x-forwarded-proto"] === "string" ? headers["x-forwarded-proto"] : "") ||
    "https";
  const host =
    (typeof headers["x-forwarded-host"] === "string" ? headers["x-forwarded-host"] : "") ||
    (typeof headers["host"] === "string" ? headers["host"] : "") ||
    (process.env.VERCEL_URL ? process.env.VERCEL_URL : "localhost:3000");
  return `${proto}://${host}`.replace(/\/$/, "");
}
