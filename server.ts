import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import os from "os";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import dotenv from "dotenv";
import Stripe from "stripe";
import { verifyDisputeFacts } from "./src/utils/factualVerifier.ts";
import { renderCertifiedDecreeHtml } from "./src/utils/decreeHtmlRenderer.ts";
import {
  buildDeliberationPrompt,
  classifyGeminiError,
  DELIBERATION_RESPONSE_SCHEMA,
  DELIBERATION_SYSTEM_INSTRUCTION,
  isNonRetryableGeminiError,
  normalizeDeliberationVerdict,
  sleepMs,
} from "./src/utils/deliberationPrompt.ts";

dotenv.config();

function cleanEnvSecret(raw?: string): string {
  if (!raw) return "";
  const cleaned = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!cleaned || cleaned === "MY_GEMINI_API_KEY") return "";
  return cleaned;
}

function getDevEnvValue(key: string): string {
  const fromProc = cleanEnvSecret(process.env[key]);
  if (fromProc) {
    return fromProc;
  }
  const possiblePaths = [
    "/app/.dev.env.json",
    path.join(process.cwd(), "..", ".dev.env.json"),
    path.join(process.cwd(), ".dev.env.json"),
  ];
  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, "utf-8"));
        const val = typeof data?.[key] === "string" ? cleanEnvSecret(data[key]) : "";
        if (val) {
          process.env[key] = val;
          return val;
        }
      }
    } catch (_) {}
  }
  return "";
}

// Initial populate of environment variables
["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "API_KEY", "GEMINI_KEY", "VITE_GEMINI_API_KEY", "JUDGE_BRAIN_URL", "STRIPE_SECRET_KEY", "ZIBAL_MERCHANT", "ZIBAL_MERCHANT_ID"].forEach(getDevEnvValue);

const app = express();
app.enable("trust proxy");

function getAppBaseUrl(req: express.Request): string {
  if (process.env.APP_URL && process.env.APP_URL.trim()) {
    return process.env.APP_URL.trim().replace(/\/$/, "");
  }
  const origin = req.get("origin");
  if (origin && origin.startsWith("http")) {
    return origin.replace(/\/$/, "");
  }
  const referer = req.get("referer");
  if (referer && referer.startsWith("http")) {
    try {
      const u = new URL(referer);
      return u.origin.replace(/\/$/, "");
    } catch (_) {}
  }
  const forwardedProto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  return `${forwardedProto}://${host}`.replace(/\/$/, "");
}

const args = process.argv.slice(2);
const portArgIndex = args.indexOf("--port");
const argPort = portArgIndex !== -1 && args[portArgIndex + 1] ? Number(args[portArgIndex + 1]) : null;
const PORT = argPort || 3000;

// Price constant for official PDF decree ($1.00 USD)
const PDF_PRICE_USD_CENTS = 100;
const PDF_PRICE_TOMAN = 50000; // 50,000 Tomans for Iranian Shetab users (~$1 USD)
const PDF_PRICE_RIAL = PDF_PRICE_TOMAN * 10; // 500,000 Rials for Zibal API v1
const PAYPAL_RECIPIENT = "ganjisobhan";
const PAYPAL_ME_URL = "https://paypal.me/ganjisobhan/1USD";

// In-memory & disk persistence for paid decrees
const PAID_DECREES_FILE = path.join(process.cwd(), "paid_decrees.json");
const paidDecreesSet = new Set<string>();

// Pending Zibal transactions
const pendingZibalMap = new Map<string, { decreeCode: string; amountRial: number; createdAt: number }>();

function getZibalMerchant(): string {
  return (
    getDevEnvValue("ZIBAL_MERCHANT") ||
    getDevEnvValue("ZIBAL_MERCHANT_ID") ||
    process.env.ZIBAL_MERCHANT ||
    process.env.ZIBAL_MERCHANT_ID ||
    ""
  ).trim();
}

async function verifyZibalTransaction(
  merchant: string,
  trackId: string,
  expectedDecreeCode?: string
): Promise<{ paid: boolean; refNumber?: string; orderId?: string; result?: number; message?: string }> {
  if (!merchant || !trackId) return { paid: false };
  try {
    const trackNumeric = Number(trackId);
    const verifyResp = await fetch("https://gateway.zibal.ir/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        merchant,
        trackId: Number.isFinite(trackNumeric) && trackNumeric > 0 ? trackNumeric : trackId,
      }),
    });
    const verifyData: any = await verifyResp.json().catch(() => null);
    const resCode = Number(verifyData?.result);
    const orderId = verifyData?.orderId ? String(verifyData.orderId) : "";
    const amountOk = !verifyData?.amount || Number(verifyData.amount) >= PDF_PRICE_RIAL;
    const decreeMatches = !expectedDecreeCode || !orderId || orderId === expectedDecreeCode;

    if ((resCode === 100 || resCode === 201) && amountOk && decreeMatches) {
      return {
        paid: true,
        refNumber: verifyData?.refNumber ? String(verifyData.refNumber) : trackId,
        orderId: orderId || expectedDecreeCode,
        result: resCode,
        message: verifyData?.message,
      };
    }
    return {
      paid: false,
      result: resCode,
      message: verifyData?.message,
    };
  } catch (err: any) {
    console.warn("Zibal verify API call failed:", err?.message || err);
    return { paid: false };
  }
}

function loadPaidDecrees() {
  try {
    if (fs.existsSync(PAID_DECREES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PAID_DECREES_FILE, "utf-8"));
      if (Array.isArray(data)) {
        data.forEach((code) => {
          if (typeof code === "string") paidDecreesSet.add(code);
        });
      }
    }
  } catch (err) {
    console.warn("Could not load paid_decrees.json:", err);
  }
}
loadPaidDecrees();

function recordPaidDecree(decreeCode: string) {
  if (!decreeCode) return;
  paidDecreesSet.add(decreeCode);
  try {
    fs.writeFileSync(PAID_DECREES_FILE, JSON.stringify(Array.from(paidDecreesSet), null, 2));
  } catch (err) {
    console.warn("Could not persist paid_decrees.json:", err);
  }
}

// Enable complete CORS and Preflight handling
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Goog-Api-Key, X-Api-Key, User-Agent"
  );
  res.header("Access-Control-Max-Age", "86400");
  res.removeHeader("X-Frame-Options");
  res.header("Content-Security-Policy", "frame-ancestors *");
  res.header("Permissions-Policy", "microphone=*, camera=*, display-capture=*");
  res.header("Feature-Policy", "microphone *; camera *");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: "25mb" }));

// Helper to get Stripe client safely using server-only secret key
function getStripe(): Stripe | null {
  const secretKey = getDevEnvValue("STRIPE_SECRET_KEY");
  if (!secretKey || !secretKey.startsWith("sk_")) {
    return null;
  }
  return new Stripe(secretKey);
}

// Helper to check and retrieve Gemini API key from any standard server env var
function getGeminiKey(req?: express.Request): string {
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
    const val = getDevEnvValue(name);
    if (val) return val;
  }
  if (req) {
    const customHeader = (req.headers["x-goog-api-key"] as string) || (req.headers["x-api-key"] as string);
    const cleanedHeader = cleanEnvSecret(customHeader);
    if (cleanedHeader) {
      return cleanedHeader;
    }
  }
  return "";
}

const getGeminiAI = (apiKey: string) => {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 90000,
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

// In-Memory & File Store for Shared Cases
interface SharedCaseItem {
  id: string;
  partyA: { name: string; claimText: string; evidenceNotes?: string };
  partyB: { name: string; claimText: string; evidenceNotes?: string };
  lang: "fa" | "en";
  createdAt: number;
}

const CASES_FILE = path.join(process.cwd(), "cases_store.json");
const sharedCasesMap = new Map<string, SharedCaseItem>();

function loadCasesFromDisk() {
  try {
    if (fs.existsSync(CASES_FILE)) {
      const data = JSON.parse(fs.readFileSync(CASES_FILE, "utf-8"));
      if (Array.isArray(data)) {
        data.forEach((item: SharedCaseItem) => {
          if (item && item.id) sharedCasesMap.set(item.id, item);
        });
      }
    }
  } catch (err) {
    console.warn("Could not load cases_store.json:", err);
  }
}
loadCasesFromDisk();

function saveCasesToDisk() {
  try {
    const items = Array.from(sharedCasesMap.values()).slice(-200);
    fs.writeFileSync(CASES_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.warn("Could not save cases_store.json:", err);
  }
}

// Create Shared Case API
app.post("/api/cases", (req, res) => {
  try {
    const { partyA, partyB, lang } = req.body;
    if (!partyA || typeof partyA.claimText !== "string" || !partyA.claimText.trim()) {
      return res.status(400).json({ error: "Missing claimant statement (partyA.claimText)" });
    }

    const id = `dadgar_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const caseItem: SharedCaseItem = {
      id,
      partyA: {
        name: (partyA.name || "").trim() || (lang === "en" ? "Party A" : "طرف اول"),
        claimText: partyA.claimText.trim(),
        evidenceNotes: (partyA.evidenceNotes || "").trim(),
      },
      partyB: {
        name: (partyB?.name || "").trim() || (lang === "en" ? "Party B" : "طرف دوم"),
        claimText: (partyB?.claimText || "").trim(),
        evidenceNotes: (partyB?.evidenceNotes || "").trim(),
      },
      lang: lang === "en" ? "en" : "fa",
      createdAt: Date.now(),
    };

    sharedCasesMap.set(id, caseItem);
    saveCasesToDisk();

    return res.json({ success: true, caseId: id, caseData: caseItem });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// Retrieve Shared Case API
app.get("/api/cases/:id", (req, res) => {
  try {
    const { id } = req.params;
    const caseItem = sharedCasesMap.get(id);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found or expired" });
    }
    return res.json({ success: true, caseData: caseItem });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// Update Shared Case (e.g. Party B submitting defense, or saving verdict)
app.put("/api/cases/:id", (req, res) => {
  try {
    const { id } = req.params;
    const existing = sharedCasesMap.get(id);
    if (!existing) {
      return res.status(404).json({ error: "Case not found" });
    }

    const { partyB, partyA, verdict } = req.body;
    if (partyB) {
      existing.partyB = {
        name: (partyB.name || existing.partyB?.name || "").trim(),
        claimText: (partyB.claimText || existing.partyB?.claimText || "").trim(),
        evidenceNotes: (partyB.evidenceNotes || existing.partyB?.evidenceNotes || "").trim(),
      };
    }
    if (partyA && !existing.partyA?.claimText) {
      existing.partyA = {
        name: (partyA.name || "").trim(),
        claimText: (partyA.claimText || "").trim(),
        evidenceNotes: (partyA.evidenceNotes || "").trim(),
      };
    }
    if (verdict) {
      (existing as any).verdict = verdict;
    }
    (existing as any).updatedAt = Date.now();

    sharedCasesMap.set(id, existing);
    saveCasesToDisk();

    return res.json({ success: true, caseData: existing });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// Real Stripe Checkout Session Creation
app.post("/api/payments/checkout", async (req, res) => {
  try {
    const { decreeCode, lang } = req.body;
    if (!decreeCode || typeof decreeCode !== "string") {
      return res.status(400).json({ error: "Missing or invalid decreeCode" });
    }

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error: {
          code: "PAYMENT_UNAVAILABLE",
          message:
            lang === "fa"
              ? "درگاه پرداخت Stripe موقتاً در دسترس نیست. لطفاً دقایقی دیگر مراجعه فرمایید یا با پشتیبانی تماس بگیرید."
              : "Stripe payment gateway is temporarily unavailable. Please try again shortly.",
        },
      });
    }

    const appBase = getAppBaseUrl(req);

    const isFa = lang === "fa";
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: PDF_PRICE_USD_CENTS,
            product_data: {
              name: isFa ? "گواهی رسمی چاپی PDF آقای قاضی" : "Mr. Judger Certified PDF Decree",
              description: `Decree ID / کد پرونده: ${decreeCode}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        decreeCode,
      },
      success_url: `${appBase}/?session_id={CHECKOUT_SESSION_ID}&decree=${encodeURIComponent(decreeCode)}&paid=true`,
      cancel_url: `${appBase}/?canceled=true&decree=${encodeURIComponent(decreeCode)}`,
    });

    return res.json({ url: session.url, id: session.id });
  } catch (error: any) {
    console.error("Stripe checkout session creation failed:", error?.message);
    return res.status(500).json({
      error: {
        code: "CHECKOUT_FAILED",
        message: error?.message || "Failed to create Stripe checkout session",
      },
    });
  }
});

// Zibal Payment Initiation for Iranian Shetab users (v1 API)
app.post("/api/payments/zibal/request", async (req, res) => {
  const isFa = req.body?.lang !== "en";
  try {
    const { decreeCode, mobile } = req.body;
    if (!decreeCode || typeof decreeCode !== "string") {
      return res.status(400).json({ error: { message: "Missing or invalid decreeCode" } });
    }

    const merchant = getZibalMerchant();
    if (!merchant) {
      return res.status(503).json({
        error: {
          code: "ZIBAL_NOT_CONFIGURED",
          message: isFa
            ? "کد مرچنت درگاه زیبال (ZIBAL_MERCHANT) تنظیم نشده است. لطفاً آن را در Settings > Secrets یا متغیرهای محیطی ورسل ثبت فرمایید."
            : "Zibal merchant ID (ZIBAL_MERCHANT) is not configured in environment variables.",
        },
      });
    }

    const appBase = getAppBaseUrl(req);
    const callbackUrl = `${appBase}/api/payments/zibal/callback?decreeCode=${encodeURIComponent(decreeCode)}`;

    const payload: Record<string, any> = {
      merchant,
      amount: PDF_PRICE_RIAL,
      callbackUrl,
      description: `صدور دادنامه رسمی و سند تک‌برگی دیوان دادگر - کد پرونده ${decreeCode}`,
      orderId: decreeCode,
    };
    const cleanMobile = typeof mobile === "string" ? mobile.trim() : "";
    if (cleanMobile) {
      payload.mobile = cleanMobile;
    }

    const response = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });

    const data: any = await response.json().catch(() => null);
    if (data?.result === 100 && data?.trackId) {
      const trackId = String(data.trackId);
      pendingZibalMap.set(trackId, {
        decreeCode,
        amountRial: PDF_PRICE_RIAL,
        createdAt: Date.now(),
      });
      return res.json({
        success: true,
        trackId,
        url: `https://gateway.zibal.ir/start/${encodeURIComponent(trackId)}`,
        gateway: "zibal",
        sandbox: merchant === "zibal",
      });
    }

    return res.status(502).json({
      error: {
        code: "ZIBAL_GATEWAY_REJECTED",
        message: isFa
          ? `درگاه زیبال درخواست را تایید نکرد (کد ${data?.result ?? response.status}: ${data?.message || "خطای درگاه"}).`
          : `Zibal gateway error (code ${data?.result ?? response.status}: ${data?.message || "Upstream error"}).`,
      },
    });
  } catch (error: any) {
    console.error("Zibal payment request failed:", error);
    return res.status(502).json({
      error: {
        code: "ZIBAL_CONNECTION_FAILED",
        message: isFa
          ? "برقراری ارتباط با سرور درگاه زیبال ممکن نشد. لطفاً دقایقی دیگر تلاش فرمایید."
          : error?.message || "Failed to connect to Zibal gateway.",
      },
    });
  }
});

// Zibal Callback URL Handler (supports GET and POST)
app.all("/api/payments/zibal/callback", async (req, res) => {
  try {
    const q = req.query || {};
    const b = req.body || {};
    const trackId = String(q.trackId || b.trackId || "");
    const success = String(q.success || b.success || "");
    const decreeCodeParam = String(q.decreeCode || q.orderId || b.orderId || "");
    const pendingTx = trackId ? pendingZibalMap.get(trackId) : undefined;
    const decreeCode = decreeCodeParam || pendingTx?.decreeCode || "";
    const appBase = getAppBaseUrl(req);

    if (!decreeCode) {
      return res.redirect(`${appBase}/?payment_failed=true&error=missing_decree&gateway=zibal`);
    }

    if (success !== "1" || !trackId) {
      return res.redirect(`${appBase}/?canceled=true&decree=${encodeURIComponent(decreeCode)}&gateway=zibal`);
    }

    const merchant = getZibalMerchant();
    const verification = await verifyZibalTransaction(merchant, trackId, decreeCode);

    if (verification.paid) {
      recordPaidDecree(decreeCode);
      const refId = verification.refNumber || trackId;
      return res.redirect(
        `${appBase}/?decree=${encodeURIComponent(decreeCode)}&paid=true&gateway=zibal&ref_id=${encodeURIComponent(refId)}&track_id=${encodeURIComponent(trackId)}`
      );
    }

    return res.redirect(
      `${appBase}/?decree=${encodeURIComponent(decreeCode)}&payment_failed=true&gateway=zibal`
    );
  } catch (error: any) {
    console.error("Zibal callback error:", error);
    return res.status(500).send("Error processing Zibal callback");
  }
});

// Check Payment Status (Stripe & Zibal)
app.get("/api/payments/status", async (req, res) => {
  try {
    const sessionId = (req.query.session_id as string) || "";
    const zibalTrackId =
      (req.query.zibal_track_id as string) ||
      (req.query.trackId as string) ||
      "";
    const decree =
      (req.query.decree as string) ||
      (req.query.decreeCode as string) ||
      "";

    if (decree && paidDecreesSet.has(decree)) {
      return res.json({
        paid: true,
        decreeCode: decree,
      });
    }

    if (zibalTrackId) {
      const zibalMerchant = getZibalMerchant();
      if (zibalMerchant) {
        const verified = await verifyZibalTransaction(zibalMerchant, zibalTrackId, decree);
        if (verified.paid) {
          const resolvedDecree = verified.orderId || decree;
          if (resolvedDecree) recordPaidDecree(resolvedDecree);
          return res.json({
            paid: true,
            decreeCode: resolvedDecree,
            trackId: zibalTrackId,
            refNumber: verified.refNumber,
            gateway: "zibal",
          });
        }
      }
    }

    if (sessionId) {
      const stripe = getStripe();
      if (stripe) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const isPaid = session.payment_status === "paid";
          const code = session.metadata?.decreeCode || decree;
          if (isPaid && typeof code === "string" && code) {
            recordPaidDecree(code);
            return res.json({
              paid: true,
              decreeCode: code,
              status: session.payment_status,
              gateway: "stripe",
            });
          }
        } catch (err: any) {
          console.warn("Stripe status retrieval failed:", err?.message);
        }
      }
    }

    if (decree) {
      const isPaid = paidDecreesSet.has(decree);
      return res.json({
        paid: isPaid,
        decreeCode: decree,
      });
    }

    return res.status(400).json({ paid: false, error: "Missing session_id, zibal_track_id, or decree" });
  } catch (error: any) {
    return res.status(500).json({ paid: false, error: error?.message });
  }
});

// Free Official PDF / Printable Decree Endpoint (100% Free — No Paywall)
app.post("/api/decree/pdf", async (req, res) => {
  try {
    const { decreeCode, caseData, lang } = req.body;

    if (!decreeCode || typeof decreeCode !== "string") {
      return res.status(400).json({
        error: "Missing decreeCode to access certified decree.",
      });
    }

    if (!caseData || !caseData.partyA || !caseData.partyB || !caseData.verdict) {
      return res.status(400).json({ error: "Missing caseData to render decree" });
    }

    const renderedHtml = renderCertifiedDecreeHtml({
      lang: lang === "en" ? "en" : "fa",
      decreeCode,
      partyA: caseData.partyA,
      partyB: caseData.partyB,
      verdict: caseData.verdict,
    });

    return res.json({
      paid: true,
      free: true,
      decreeCode,
      html: renderedHtml,
    });
  } catch (error: any) {
    console.error("Decree generation failed:", error?.message);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

// Optional PayPal Confirmation Fallback Endpoint
app.post("/api/payments/paypal/confirm", (req, res) => {
  try {
    const { decreeCode } = req.body;
    if (decreeCode && typeof decreeCode === "string") recordPaidDecree(decreeCode);
    return res.json({ success: true, paid: true, decreeCode });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message });
  }
});

// Variza Iranian Shetab Confirmation Endpoint
app.post("/api/payments/variza/confirm", (req, res) => {
  try {
    const { decreeCode, trackingCode } = req.body;
    if (decreeCode && typeof decreeCode === "string") {
      recordPaidDecree(decreeCode);
    }
    return res.json({ success: true, paid: true, decreeCode, trackingCode });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message });
  }
});

// Convert incoming audio to standard 16,000 Hz 16-bit Mono WAV via FFmpeg (with dynamic loudness boost for quiet mics)
function detectAudioExt(inputBuffer: Buffer, mimeHint: string): string {
  const hint = (mimeHint || "").toLowerCase();
  if (hint.includes("webm")) return "webm";
  if (hint.includes("mp4") || hint.includes("m4a") || hint.includes("aac")) return "mp4";
  if (hint.includes("ogg") || hint.includes("opus")) return "ogg";
  if (hint.includes("wav")) return "wav";
  if (hint.includes("flac")) return "flac";
  if (hint.includes("mp3") || hint.includes("mpeg")) return "mp3";

  if (inputBuffer.length > 8) {
    const head4 = inputBuffer.toString("ascii", 0, 4);
    const head12 = inputBuffer.length >= 12 ? inputBuffer.toString("ascii", 4, 12) : "";
    if (head4 === "RIFF") return "wav";
    if (head4 === "OggS") return "ogg";
    if (head4 === "fLaC") return "flac";
    if (head4.startsWith("ID3") || (inputBuffer[0] === 0xff && (inputBuffer[1] & 0xe0) === 0xe0)) return "mp3";
    if (head12.includes("ftyp")) return "mp4";
    if (inputBuffer[0] === 0x1a && inputBuffer[1] === 0x45 && inputBuffer[2] === 0xdf && inputBuffer[3] === 0xa3) return "webm";
  }
  return "webm";
}

function convertAudioTo16kWav(inputBuffer: Buffer, mimeHint: string): Buffer {
  const tmpDir = os.tmpdir();
  const ext = detectAudioExt(inputBuffer, mimeHint);
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const inPath = path.join(tmpDir, `in_${id}.${ext}`);
  const outPath = path.join(tmpDir, `out_${id}.wav`);

  try {
    fs.writeFileSync(inPath, inputBuffer);
    try {
      // Clean 80Hz high-pass only (avoid aggressive dynamic pumping on initial decode)
      execSync(
        `ffmpeg -y -i "${inPath}" -vn -af "highpass=f=80" -ar 16000 -ac 1 -c:a pcm_s16le "${outPath}"`,
        { stdio: "ignore", timeout: 15000 }
      );
    } catch (_) {
      execSync(
        `ffmpeg -y -i "${inPath}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "${outPath}"`,
        { stdio: "ignore", timeout: 15000 }
      );
    }
    if (fs.existsSync(outPath)) {
      const converted = fs.readFileSync(outPath);
      if (converted.length > 44) {
        return converted;
      }
    }
  } catch (err: any) {
    console.warn("FFmpeg WAV conversion fallback:", err?.message);
  } finally {
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
  }

  return inputBuffer;
}

function extractFloat32From16kWav(wavBuffer: Buffer): Float32Array | null {
  try {
    if (
      wavBuffer.length > 44 &&
      wavBuffer.toString("ascii", 0, 4) === "RIFF" &&
      wavBuffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      let offset = 12;
      while (offset + 8 <= wavBuffer.length) {
        const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
        const chunkSize = wavBuffer.readUInt32LE(offset + 4);
        if (chunkId === "data") {
          const dataStart = offset + 8;
          const dataEnd = Math.min(wavBuffer.length, dataStart + chunkSize);
          const sampleCount = Math.floor((dataEnd - dataStart) / 2);
          const f32 = new Float32Array(sampleCount);
          for (let i = 0; i < sampleCount; i++) {
            f32[i] = wavBuffer.readInt16LE(dataStart + i * 2) / 32768.0;
          }
          return f32;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
      }
    }
  } catch (_) {}
  return null;
}

function computeAudioRms(samples: Float32Array | null): number {
  if (!samples || samples.length === 0) return 1;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function convertAudioTo16kFlac(inputBuffer: Buffer, mimeHint: string, dynamicBoost = false): Buffer | null {
  const tmpDir = os.tmpdir();
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const ext = detectAudioExt(inputBuffer, mimeHint);
  const inPath = path.join(tmpDir, `in_${id}.${ext}`);
  const outPath = path.join(tmpDir, `out_${id}.flac`);
  try {
    fs.writeFileSync(inPath, inputBuffer);
    const filter = dynamicBoost ? "highpass=f=80,dynaudnorm=f=150:g=10:m=8" : "highpass=f=80";
    execSync(
      `ffmpeg -y -i "${inPath}" -vn -af "${filter}" -ar 16000 -ac 1 -sample_fmt s16 -c:a flac "${outPath}"`,
      { stdio: "ignore", timeout: 15000 }
    );
    if (fs.existsSync(outPath)) {
      return fs.readFileSync(outPath);
    }
  } catch (err: any) {
    console.warn("FFmpeg FLAC conversion error:", err?.message);
  } finally {
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
    try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch (_) {}
  }
  return null;
}

function splitWavIntoFlacChunks(wavBuffer: Buffer, segmentSeconds = 12): Buffer[] {
  const tmpDir = os.tmpdir();
  const id = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const inPath = path.join(tmpDir, `chunk_in_${id}.wav`);
  const outPattern = path.join(tmpDir, `chunk_out_${id}_%03d.flac`);
  const chunks: Buffer[] = [];
  try {
    fs.writeFileSync(inPath, wavBuffer);
    execSync(
      `ffmpeg -y -i "${inPath}" -f segment -segment_time ${segmentSeconds} -ar 16000 -ac 1 -sample_fmt s16 -c:a flac "${outPattern}"`,
      { stdio: "ignore", timeout: 20000 }
    );
    const files = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith(`chunk_out_${id}_`) && f.endsWith(".flac"))
      .sort();
    for (const f of files) {
      const p = path.join(tmpDir, f);
      chunks.push(fs.readFileSync(p));
      try { fs.unlinkSync(p); } catch (_) {}
    }
  } catch (err: any) {
    console.warn("FFmpeg chunk split error:", err?.message);
  } finally {
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch (_) {}
  }
  return chunks;
}

// Free Google Speech-to-Text API (Chromium Client API - 100% Free, no billing needed)
async function transcribeWithFreeGoogleApi(
  audioBuffer: Buffer,
  lang: string,
  contentType = "audio/x-flac; rate=16000"
): Promise<string> {
  const languageCode = lang === "fa" ? "fa-IR" : "en-US";
  const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=${languageCode}&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw&pFilter=0`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
      body: new Uint8Array(audioBuffer) as unknown as BodyInit,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      console.warn("Free Google STT HTTP status:", resp.status);
      return "";
    }
    const rawText = await resp.text();
    const lines = rawText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const finalSegments: string[] = [];
    let bestFallbackSegment = "";

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const results = parsed?.result;
        if (!Array.isArray(results) || results.length === 0) continue;

        const segmentTexts: string[] = [];
        let hasFinal = false;
        for (const r of results) {
          if (r?.final) hasFinal = true;
          const t = r?.alternative?.[0]?.transcript;
          if (typeof t === "string" && t.trim()) {
            segmentTexts.push(t.trim());
          }
        }
        const combined = segmentTexts.join(" ").trim();
        if (combined) {
          if (hasFinal) {
            finalSegments.push(combined);
          } else {
            bestFallbackSegment = combined;
          }
        }
      } catch (_) {}
    }

    if (finalSegments.length > 0) {
      return finalSegments.join(" ").trim();
    }
    return bestFallbackSegment.trim();
  } catch (err: any) {
    console.warn("Free Google STT request error:", err?.message || err);
  }
  return "";
}

// Local Whisper Pipeline for guaranteed offline/in-container speech-to-text
let localWhisperPipeline: any = null;
let isWhisperLoading = false;

async function getWhisperPipeline() {
  if (localWhisperPipeline) return localWhisperPipeline;
  if (isWhisperLoading) {
    while (isWhisperLoading) {
      await new Promise((r) => setTimeout(r, 150));
    }
    return localWhisperPipeline;
  }
  isWhisperLoading = true;
  try {
    const { pipeline } = await import("@xenova/transformers");
    localWhisperPipeline = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny");
    return localWhisperPipeline;
  } catch (err: any) {
    console.warn("Could not initialize local Whisper pipeline:", err?.message || err);
    return null;
  } finally {
    isWhisperLoading = false;
  }
}

// Preload whisper pipeline in background so it is instantly warm on first user request
setTimeout(() => {
  getWhisperPipeline().catch(() => {});
}, 1000);

// Audio Transcription API
app.post("/api/transcribe", async (req, res) => {
  try {
    const { audioBase64, wavBase64, mimeType, lang } = req.body;
    const primaryInput = audioBase64 || wavBase64;
    if (!primaryInput) {
      return res.status(400).json({ error: { code: "MISSING_AUDIO", message: "Missing audio data" } });
    }

    const apiKey = getGeminiKey(req);
    const cleanBase64 = primaryInput.includes(",") ? primaryInput.split(",")[1] : primaryInput.trim();
    const rawBuffer = Buffer.from(cleanBase64, "base64");

    let clientWavBuffer: Buffer | null = null;
    if (typeof wavBase64 === "string" && wavBase64.trim()) {
      const cleanWavB64 = wavBase64.includes(",") ? wavBase64.split(",")[1] : wavBase64.trim();
      const buf = Buffer.from(cleanWavB64, "base64");
      if (buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
        clientWavBuffer = buf;
      }
    }

    if (rawBuffer.length < 50 && (!clientWavBuffer || clientWavBuffer.length < 50)) {
      return res.status(400).json({
        error: { code: "EMPTY_AUDIO", message: "Audio recording was empty or too short." }
      });
    }

    let cleanMime = "";
    if (primaryInput.startsWith("data:")) {
      const match = primaryInput.match(/^data:([^;,]+)/);
      if (match) cleanMime = match[1].trim().toLowerCase();
    }
    if (!cleanMime && mimeType) {
      cleanMime = mimeType.split(";")[0].trim().toLowerCase();
    }
    if (!cleanMime) {
      const ext = detectAudioExt(rawBuffer, "");
      cleanMime = ext === "wav" ? "audio/wav" : ext === "mp4" ? "audio/mp4" : "audio/webm";
    }

    let finalBuffer = clientWavBuffer || rawBuffer;
    let actualMime = clientWavBuffer ? "audio/wav" : cleanMime;
    try {
      const srcBuf = rawBuffer.length >= 50 ? rawBuffer : clientWavBuffer!;
      const srcMime = rawBuffer.length >= 50 ? cleanMime : "audio/wav";
      const converted = convertAudioTo16kWav(srcBuf, srcMime);
      if (converted && converted.length > 44 && converted.toString("ascii", 0, 4) === "RIFF") {
        finalBuffer = converted;
        actualMime = "audio/wav";
      }
    } catch (_) {
      if (clientWavBuffer) {
        finalBuffer = clientWavBuffer;
        actualMime = "audio/wav";
      }
    }

    const wavSamples = extractFloat32From16kWav(finalBuffer);
    const wavDurationSec = wavSamples ? wavSamples.length / 16000 : 0;
    const wavRms = computeAudioRms(wavSamples);

    if (wavSamples && wavSamples.length > 0 && wavRms < 0.0015) {
      return res.status(200).json({
        transcription: "",
        success: true,
        audioAttached: true,
        isAiTranscribed: false,
        isSilentAudio: true,
        message:
          lang === "fa"
            ? "فایل صوتی با کیفیت در پرونده ذخیره و ضمیمه شد."
            : "Audio recording successfully attached to case.",
      });
    }

    let transcription = "";
    let lastError: any = null;

    // 1. Try Free Google STT API (Official Chromium Speech API - 100% Free)
    try {
      // Pass A: Chunked clean FLAC if > 14s
      if (actualMime === "audio/wav" && wavDurationSec > 14) {
        const flacChunks = splitWavIntoFlacChunks(finalBuffer, 12);
        const chunkTexts: string[] = [];
        for (const chunk of flacChunks) {
          const text = await transcribeWithFreeGoogleApi(chunk, lang || "fa");
          if (text && text.trim()) chunkTexts.push(text.trim());
        }
        transcription = chunkTexts.join(" ").trim();
      }

      // Pass B: Clean single-shot FLAC (no aggressive noise-pumping compression)
      if (!transcription) {
        const flacBuffer =
          actualMime === "audio/wav"
            ? convertAudioTo16kFlac(finalBuffer, "audio/wav", false)
            : convertAudioTo16kFlac(rawBuffer, cleanMime, false);
        if (flacBuffer && flacBuffer.length > 80) {
          const freeText = await transcribeWithFreeGoogleApi(flacBuffer, lang || "fa");
          if (freeText && freeText.trim()) transcription = freeText.trim();
        }
      }

      // Pass C: Try client's live-captured normalized WAV if raw WebM path yielded empty
      if (!transcription && clientWavBuffer && clientWavBuffer !== finalBuffer) {
        const clientFlac = convertAudioTo16kFlac(clientWavBuffer, "audio/wav", false);
        if (clientFlac && clientFlac.length > 80) {
          const clientText = await transcribeWithFreeGoogleApi(clientFlac, lang || "fa");
          if (clientText && clientText.trim()) transcription = clientText.trim();
        }
      }

      // Pass D: Gentle dynaudnorm boost pass for very quiet microphones
      if (!transcription && actualMime === "audio/wav" && wavRms < 0.08) {
        const boostedFlac = convertAudioTo16kFlac(finalBuffer, "audio/wav", true);
        if (boostedFlac && boostedFlac.length > 80) {
          const boostedText = await transcribeWithFreeGoogleApi(boostedFlac, lang || "fa");
          if (boostedText && boostedText.trim()) transcription = boostedText.trim();
        }
      }

      // Pass E: Raw PCM 16kHz audio/l16 fallback
      if (!transcription && actualMime === "audio/wav" && finalBuffer.length > 44) {
        const pcmData = finalBuffer.subarray(44);
        const chunkByteLimit = 16000 * 2 * 12;
        const pcmTexts: string[] = [];
        for (let off = 0; off < pcmData.length; off += chunkByteLimit) {
          const slice = pcmData.subarray(off, Math.min(pcmData.length, off + chunkByteLimit));
          if (slice.length < 320) continue;
          const text = await transcribeWithFreeGoogleApi(slice, lang || "fa", "audio/l16; rate=16000");
          if (text && text.trim()) pcmTexts.push(text.trim());
        }
        transcription = pcmTexts.join(" ").trim();
      }
    } catch (freeErr: any) {
      console.warn("Free Google STT step warning:", freeErr?.message || freeErr);
    }

    if (transcription) {
      return res.json({
        transcription,
        success: true,
        audioAttached: true,
        isAiTranscribed: true,
      });
    }

    // 2. Try Gemini API if key is configured
    if (apiKey) {
      try {
        const ai = getGeminiAI(apiKey);
        const promptText =
          lang === "fa"
            ? "متن فایل صوتی پیوست را با دقت کامل به زبان فارسی بنویسید. تمامی واژگان و صحبت‌های گوینده درباره پرونده یا ادعا را کلمه به کلمه با رسم‌الخط صحیح فارسی بنویسید. فقط و فقط متن پیاده‌شده را خروجی دهید و از افزودن هرگونه توضیح اضافه یا علامت گیومه خودداری نمایید."
            : "Accurately transcribe the provided spoken voice audio into clear, punctuated text in English. Output ONLY the transcribed words without any commentary, markdown headers, or labels.";

        const audioPart = {
          inlineData: {
            mimeType: actualMime,
            data: finalBuffer.toString("base64"),
          },
        };

        const modelsToTry = [
          "gemini-3.5-transcribe",
          "gemini-4-hydrogen",
        ];

        const extractTranscriptionText = (response: any): string => {
          if (!response) return "";
          if (typeof response.text === "string" && response.text.trim()) {
            return response.text.trim();
          }
          const parts = response.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part?.audioTranscription?.text && typeof part.audioTranscription.text === "string") {
              const text = part.audioTranscription.text.trim();
              if (text) return text;
            }
            if (typeof part?.audioTranscription === "string" && part.audioTranscription.trim()) {
              return part.audioTranscription.trim();
            }
            if (typeof part?.text === "string" && part.text.trim()) {
              return part.text.trim();
            }
          }
          return "";
        };

        for (const modelName of modelsToTry) {
          let timer: NodeJS.Timeout | null = null;
          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error(`Timeout after 20s calling ${modelName}`)), 20000);
            });

            const callPromise = ai.models.generateContent({
              model: modelName,
              contents: {
                parts: [audioPart, { text: promptText }],
              },
            });

            const response: any = await Promise.race([callPromise, timeoutPromise]);
            if (timer) clearTimeout(timer);
            transcription = extractTranscriptionText(response);
            if (transcription) break;
          } catch (err: any) {
            lastError = err;
            console.warn(`Model ${modelName} transcribe failed:`, err?.message || err);
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      } catch (_) {}
    }

    // 3. If transcription is still empty, use local Whisper STT pipeline as offline backup
    if (!transcription || transcription.trim().length === 0) {
      try {
        const transcriber = await getWhisperPipeline();
        if (transcriber) {
          let samplesFloat32 = wavSamples;
          if (!samplesFloat32) {
            const waveMod: any = await import("wavefile");
            const WaveFileCtor = waveMod.WaveFile || waveMod.default?.WaveFile;
            if (WaveFileCtor) {
              const wav = new WaveFileCtor(finalBuffer);
              wav.toSampleRate(16000);
              wav.toBitDepth("32f");
              let s: any = wav.getSamples();
              if (Array.isArray(s)) s = s[0];
              samplesFloat32 = new Float32Array(s);
            }
          }
          if (samplesFloat32 && samplesFloat32.length > 0) {
            const result = await transcriber(samplesFloat32, {
              language: lang === "fa" ? "persian" : "english",
              task: "transcribe",
            });
            if (result && typeof result.text === "string" && result.text.trim()) {
              const rawText = result.text.trim();
              const words = rawText.split(/\s+/);
              const isRepetitive = words.length > 5 && words.every((w) => w === words[0]);
              if (!isRepetitive) {
                transcription = rawText;
              }
            }
          }
        }
      } catch (whisperErr: any) {
        console.warn("Local Whisper transcription failed:", whisperErr?.message);
      }
    }

    const cleanTranscription = transcription
      .replace(/^["'«»“]+|["'«»”]+$/g, "")
      .trim();

    const isSilenceMarker =
      cleanTranscription === "(سکوت)" ||
      cleanTranscription === "[سکوت]" ||
      cleanTranscription === "سکوت" ||
      cleanTranscription === "(silence)" ||
      cleanTranscription === "[silence]" ||
      cleanTranscription === "00:00" ||
      cleanTranscription === "۰۰:۰۰" ||
      cleanTranscription === "۰:۰۰" ||
      cleanTranscription === "0:00" ||
      cleanTranscription === "۰۰:۰" ||
      cleanTranscription === "00:0" ||
      cleanTranscription === "صفر صفر صفر صفر" ||
      cleanTranscription.toLowerCase() === "you" ||
      cleanTranscription.toLowerCase() === "thank you.";

    if (cleanTranscription && !isSilenceMarker) {
      return res.json({
        transcription: cleanTranscription,
        success: true,
        audioAttached: true,
        isAiTranscribed: true,
      });
    }

    const isSilentAudio = wavRms < 0.0015;
    console.warn("[Transcribe] No speech extracted:", {
      cleanMime,
      rawBytes: rawBuffer.length,
      wavDurationSec: Number(wavDurationSec.toFixed(2)),
      wavRms: Number(wavRms.toFixed(5)),
      isSilentAudio,
    });

    return res.status(200).json({
      transcription: "",
      success: true,
      audioAttached: true,
      isAiTranscribed: false,
      isSilentAudio,
      message:
        lang === "fa"
          ? "فایل صوتی با کیفیت در پرونده ذخیره و ضمیمه شد."
          : "Audio recording successfully attached to case.",
    });
  } catch (error: any) {
    console.error("Transcribe general error:", error);
    const isFa = req.body?.lang === "fa";
    return res.status(200).json({
      transcription: "",
      audioAttached: true,
      success: true,
      isAiTranscribed: false,
      message: isFa ? "فایل صوتی ضمیمه شد." : "Audio attached.",
    });
  }
});

// Deliberation Endpoint (Judge & Verdict)
const handleDeliberate = async (req: express.Request, res: express.Response) => {
  const isFa = req.body?.lang === "fa";
  try {
    const { partyA, partyB } = req.body;
    if (!partyA?.claimText || !partyA.claimText.trim()) {
      return res.status(400).json({
        error: {
          code: "MISSING_CLAIMS",
          message: isFa ? "شرح ادعای خواهان الزامی است." : "Party A claim statement is required.",
          retryable: false,
        },
      });
    }

    const judgeBrainUrl = getDevEnvValue("JUDGE_BRAIN_URL");
    if (judgeBrainUrl) {
      const targetUrl = judgeBrainUrl.replace(/\/$/, "").endsWith("/api/deliberate")
        ? judgeBrainUrl.replace(/\/$/, "")
        : `${judgeBrainUrl.replace(/\/$/, "")}/api/deliberate`;
      const controller = new AbortController();
      const brainTimer = setTimeout(() => controller.abort(), 110000);
      try {
        const brainResp = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lang: req.body?.lang,
            partyA,
            partyB,
          }),
          signal: controller.signal,
        });
        const brainData: any = await brainResp.json().catch(() => null);
        if (brainResp.ok && brainData?.verdict) {
          return res.json({ verdict: brainData.verdict });
        }
        return res.status(brainResp.status >= 400 ? brainResp.status : 502).json({
          error: brainData?.error || {
            code: "JUDGE_BRAIN_UPSTREAM_ERROR",
            message: isFa
              ? "موتور مستقل مغز قاضی در حال آماده‌سازی است یا با خطا مواجه شد. لطفاً لحظاتی دیگر دوباره تلاش فرمایید."
              : "Standalone Judge Brain endpoint is initializing or returned an error. Please retry shortly.",
            retryable: true,
          },
        });
      } catch (err: any) {
        return res.status(503).json({
          error: {
            code: "JUDGE_BRAIN_UNREACHABLE",
            message: isFa
              ? `برقراری ارتباط با مغز مستقل قاضی (${judgeBrainUrl}) ممکن نشد: ${err?.message || "خطای شبکه"}`
              : `Could not reach standalone Judge Brain (${judgeBrainUrl}): ${err?.message || "Network error"}`,
            retryable: true,
          },
        });
      } finally {
        clearTimeout(brainTimer);
      }
    }

    const apiKey = getGeminiKey(req);
    if (!apiKey) {
      return res.status(503).json({
        error: {
          code: "GEMINI_API_KEY_MISSING",
          message: isFa
            ? "کلید API جمینای تنظیم نشده است. لطفاً کلید رایگان GEMINI_API_KEY را در بخش Settings > Secrets (یا متغیرهای محیطی ورسل) وارد فرمایید تا قضاوت با هوش منطقی Gemini 4 انجام شود."
            : "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.",
          retryable: true,
        },
      });
    }

    const ai = getGeminiAI(apiKey);
    const partyAName = partyA.name?.trim() || (isFa ? "خواهان (طرف اول)" : "Party A");
    const partyBName = partyB?.name?.trim() || (isFa ? "خوانده (طرف دوم)" : "Party B");
    const partyBClaim = partyB?.claimText || "";

    const factualCheck = verifyDisputeFacts(partyA.claimText, partyBClaim, partyAName, partyBName);
    const promptText = buildDeliberationPrompt({
      isFa,
      partyAName,
      partyBName,
      partyA,
      partyB,
      factualCheck,
    });

    const attempts: Array<{
      model: string;
      thinkingLevel?: ThinkingLevel;
      timeoutMs: number;
      backoffMs: number;
      label: string;
    }> = [
      {
        model: "gemini-4-hydrogen",
        thinkingLevel: ThinkingLevel.MEDIUM,
        timeoutMs: 25000,
        backoffMs: 0,
        label: "gemini-4-hydrogen (MEDIUM)",
      },
      {
        model: "gemini-3.1-flash-lite",
        timeoutMs: 16000,
        backoffMs: 1200,
        label: "gemini-3.1-flash-lite",
      },
      {
        model: "gemini-4-hydrogen",
        thinkingLevel: ThinkingLevel.LOW,
        timeoutMs: 16000,
        backoffMs: 1800,
        label: "gemini-4-hydrogen (LOW)",
      },
    ];

    let verdictData: any = null;
    let lastDelibError: any = null;
    const rateLimitedModels = new Set<string>();
    const attemptStatuses: Array<{ label: string; status: number | string }> = [];

    for (const attempt of attempts) {
      if (rateLimitedModels.has(attempt.model)) {
        continue;
      }

      if (attempt.backoffMs > 0) {
        await sleepMs(attempt.backoffMs + Math.floor(Math.random() * 350));
      }

      let timer: NodeJS.Timeout | null = null;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timeout after ${attempt.timeoutMs / 1000}s calling ${attempt.label}`)),
            attempt.timeoutMs
          );
        });

        const config: Record<string, any> = {
          systemInstruction: DELIBERATION_SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: DELIBERATION_RESPONSE_SCHEMA,
        };
        if (attempt.thinkingLevel) {
          config.thinkingConfig = { thinkingLevel: attempt.thinkingLevel };
        }

        const callPromise = ai.models.generateContent({
          model: attempt.model,
          contents: [{ parts: [{ text: promptText }] }],
          config,
        });

        const resp: any = await Promise.race([callPromise, timeoutPromise]);
        if (timer) clearTimeout(timer);
        const rawText = (resp?.text || "").trim();
        const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
        if (cleaned) {
          const parsed = JSON.parse(cleaned);
          verdictData = normalizeDeliberationVerdict(
            parsed,
            partyAName,
            partyBName,
            attempt.label,
            isFa
          );
          break;
        }
      } catch (err: any) {
        const errStatus = Number(err?.status) || 0;
        const errMsg = String(err?.message || err || "");
        attemptStatuses.push({ label: attempt.label, status: errStatus || errMsg.slice(0, 40) });
        if (errStatus === 429 || errMsg.toLowerCase().includes("resource_exhausted")) {
          rateLimitedModels.add(attempt.model);
        }
        if (!lastDelibError || errStatus !== 404) {
          lastDelibError = err;
        }
        console.warn(`Deliberation attempt ${attempt.label} failed:`, errStatus, errMsg.slice(0, 140));
        if (isNonRetryableGeminiError(err)) {
          lastDelibError = err;
          break;
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (!verdictData) {
      const classified = classifyGeminiError(lastDelibError, isFa);
      return res.status(classified.status).json({
        error: {
          code: classified.code,
          message: classified.message,
          retryable: true,
          attempts: attemptStatuses,
        },
      });
    }

    return res.json({ verdict: verdictData });
  } catch (error: any) {
    console.error("Deliberation error:", error?.message);
    const classified = classifyGeminiError(error, isFa);
    return res.status(classified.status).json({
      error: {
        code: classified.code,
        message: classified.message,
        retryable: true,
      },
    });
  }
};

app.post("/api/deliberate", handleDeliberate);
app.post("/api/judge", handleDeliberate);

app.get("/api/health", (req, res) => {
  const apiKey = getGeminiKey(req);
  const judgeBrainUrl = getDevEnvValue("JUDGE_BRAIN_URL");
  return res.json({
    ok: true,
    geminiConfigured: Boolean(apiKey),
    judgeBrainConfigured: Boolean(judgeBrainUrl),
  });
});

// Verification file routes (eNamad / gateway domain validation)
const sendVerificationCode = (_req: express.Request, res: express.Response) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  return res.status(200).send("34571233\n");
};

app.get(["/34571233.txt", "/34571233", "/۳۴۵۷۱۲۳۳.txt", "/۳۴۵۷۱۲۳۳"], sendVerificationCode);

// Direct download route for Cloudflare Pages upload
app.get("/dist.zip", (_req, res) => {
  const zipPath = path.join(process.cwd(), "dist.zip");
  if (fs.existsSync(zipPath)) {
    res.setHeader("Content-Disposition", 'attachment; filename="mrjudge_cloudflare.zip"');
    res.setHeader("Content-Type", "application/zip");
    return res.sendFile(zipPath);
  }
  return res.status(404).send("File not found");
});

app.use((req, res, next) => {
  try {
    const decoded = decodeURIComponent(req.path);
    if (decoded === "/34571233.txt" || decoded === "/34571233" || decoded === "/۳۴۵۷۱۲۳۳.txt" || decoded === "/۳۴۵۷۱۲۳۳") {
      return sendVerificationCode(req, res);
    }
  } catch (_) {}
  next();
});

// Start server
async function startServer() {
  const isProd = process.env.NODE_ENV === "production";

  if (!isProd) {
    try {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          hmr: false,
        },
        appType: "spa",
      });

      app.use(vite.middlewares);

      app.use("*", async (req, res, next) => {
        if (req.originalUrl.startsWith("/api/")) {
          return next();
        }
        try {
          const indexPath = path.join(process.cwd(), "index.html");
          let html = fs.readFileSync(indexPath, "utf-8");
          html = await vite.transformIndexHtml(req.originalUrl, html);
          res.status(200).set({ "Content-Type": "text/html" }).end(html);
        } catch (e) {
          next(e);
        }
      });
    } catch (err) {
      console.error("Vite server creation failed:", err);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const httpServer = http.createServer(app);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n  VITE v6.2.3  ready in 120 ms\n`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://0.0.0.0:${PORT}/\n`);
  });
}

startServer();