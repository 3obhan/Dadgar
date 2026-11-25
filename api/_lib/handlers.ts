import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { verifyDisputeFacts } from "../../src/utils/factualVerifier.js";
import { renderCertifiedDecreeHtml } from "../../src/utils/decreeHtmlRenderer.js";
import {
  buildDeliberationPrompt,
  classifyGeminiError,
  DELIBERATION_RESPONSE_SCHEMA,
  DELIBERATION_SYSTEM_INSTRUCTION,
  isNonRetryableGeminiError,
  normalizeDeliberationVerdict,
  sleepMs,
} from "../../src/utils/deliberationPrompt.js";
import {
  getAppBaseUrl,
  getEnvValue,
  getGeminiKey,
  getStripe,
  getZibalMerchant,
  paidDecreesSet,
  parseBodyAsync,
  PDF_PRICE_RIAL,
  PDF_PRICE_TOMAN,
  PDF_PRICE_USD_CENTS,
  pendingZibalMap,
  SharedCaseItem,
  sharedCasesMap,
} from "./http.js";

function extractWavPcmInfo(
  wavBuffer: Buffer
): { pcm: Buffer; sampleRate: number; rms: number; durationSec: number } | null {
  try {
    if (
      wavBuffer.length <= 44 ||
      wavBuffer.toString("ascii", 0, 4) !== "RIFF" ||
      wavBuffer.toString("ascii", 8, 12) !== "WAVE"
    ) {
      return null;
    }

    let sampleRate = 16000;
    let offset = 12;
    while (offset + 8 <= wavBuffer.length) {
      const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
      const chunkSize = wavBuffer.readUInt32LE(offset + 4);
      if (chunkId === "fmt " && chunkSize >= 16) {
        sampleRate = wavBuffer.readUInt32LE(offset + 12) || 16000;
      } else if (chunkId === "data") {
        const dataStart = offset + 8;
        const dataEnd = Math.min(wavBuffer.length, dataStart + chunkSize);
        const pcm = wavBuffer.subarray(dataStart, dataEnd);
        const sampleCount = Math.floor(pcm.length / 2);
        let sumSq = 0;
        for (let i = 0; i < sampleCount; i++) {
          const s = pcm.readInt16LE(i * 2) / 32768.0;
          sumSq += s * s;
        }
        const rms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 1;
        const durationSec = sampleRate > 0 ? sampleCount / sampleRate : 0;
        return { pcm, sampleRate, rms, durationSec };
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  } catch (_) {}
  return null;
}

const FLAC_CRC8_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let b = 0; b < 8; b++) {
    crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  FLAC_CRC8_TABLE[i] = crc;
}

const FLAC_CRC16_TABLE = new Uint16Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i << 8;
  for (let b = 0; b < 8; b++) {
    crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
  }
  FLAC_CRC16_TABLE[i] = crc;
}

function flacCrc8(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) crc = FLAC_CRC8_TABLE[(crc ^ buf[i]) & 0xff];
  return crc;
}

function flacCrc16(buf: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc = (((crc << 8) & 0xffff) ^ FLAC_CRC16_TABLE[((crc >> 8) ^ buf[i]) & 0xff]) & 0xffff;
  }
  return crc;
}

function encodeFlacUtf8Number(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
  return [
    0xf0 | (n >> 18),
    0x80 | ((n >> 12) & 0x3f),
    0x80 | ((n >> 6) & 0x3f),
    0x80 | (n & 0x3f),
  ];
}

export function encodePcm16ToFlac(pcm: Buffer, sampleRate = 16000): Buffer {
  const totalSamples = Math.floor(pcm.length / 2);
  const blockMax = 4096;
  const parts: Buffer[] = [];

  // fLaC magic (4 bytes) + STREAMINFO metadata block (4 + 34 bytes)
  const header = Buffer.alloc(42);
  header.write("fLaC", 0, "ascii");
  header[4] = 0x80; // Last metadata block + STREAMINFO (0)
  header[5] = 0x00;
  header[6] = 0x00;
  header[7] = 0x22; // Length = 34
  header.writeUInt16BE(blockMax, 8); // min block size
  header.writeUInt16BE(blockMax, 10); // max block size
  // Bytes 12..17 (min/max frame size = 0) already zero

  // Packed 64 bits at bytes 18..25:
  // sampleRate (20b) | channels-1 (3b = 0) | bps-1 (5b = 15) | totalSamples (36b)
  header[18] = (sampleRate >> 12) & 0xff;
  header[19] = (sampleRate >> 4) & 0xff;
  header[20] = ((sampleRate & 0x0f) << 4) | 0x00;
  const totalBig = BigInt(totalSamples);
  header[21] = 0xf0 | Number((totalBig >> 32n) & 0x0fn);
  header.writeUInt32BE(Number(totalBig & 0xffffffffn), 22);
  // Bytes 26..41 MD5 zeros allowed
  parts.push(header);

  let sampleOffset = 0;
  let frameNumber = 0;

  while (sampleOffset < totalSamples) {
    const blockSize = Math.min(blockMax, totalSamples - sampleOffset);
    const frameNumBytes = encodeFlacUtf8Number(frameNumber);
    // Header: 4 fixed + utf8 + 2 (16-bit blockSize-1) + 1 (CRC-8)
    const hdrLen = 4 + frameNumBytes.length + 2 + 1;
    // Subframe header (1 byte VERBATIM) + PCM samples (blockSize * 2) + CRC-16 (2 bytes)
    const frameBuf = Buffer.allocUnsafe(hdrLen + 1 + blockSize * 2 + 2);

    frameBuf[0] = 0xff;
    frameBuf[1] = 0xf8; // Sync + fixed block size strategy (0)
    frameBuf[2] = 0x70; // 0111 (16-bit blockSize-1 at end) + 0000 (sample rate from STREAMINFO)
    frameBuf[3] = 0x08; // 0000 (1ch mono) + 100 (16-bit) + 0 (reserved)
    for (let i = 0; i < frameNumBytes.length; i++) {
      frameBuf[4 + i] = frameNumBytes[i];
    }
    frameBuf.writeUInt16BE(blockSize - 1, 4 + frameNumBytes.length);
    frameBuf[hdrLen - 1] = flacCrc8(frameBuf, 0, hdrLen - 1);

    // Subframe: 0x02 = VERBATIM, 0 wasted bits
    frameBuf[hdrLen] = 0x02;
    let writePos = hdrLen + 1;
    let readPos = sampleOffset * 2;
    for (let i = 0; i < blockSize; i++) {
      // Convert LE s16 to BE s16 without bounds branches
      frameBuf[writePos] = pcm[readPos + 1];
      frameBuf[writePos + 1] = pcm[readPos];
      writePos += 2;
      readPos += 2;
    }

    const crc16 = flacCrc16(frameBuf, 0, writePos);
    frameBuf.writeUInt16BE(crc16, writePos);

    parts.push(frameBuf);
    sampleOffset += blockSize;
    frameNumber++;
  }

  return Buffer.concat(parts);
}

function parseGoogleSttResponseText(rawText: string): string {
  const lines = rawText
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const finalSegments: string[] = [];
  let fallbackSegment = "";

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      const results = parsed?.result;
      if (!Array.isArray(results) || results.length === 0) continue;

      let hasFinal = false;
      const segParts: string[] = [];
      for (const r of results) {
        if (r?.final) hasFinal = true;
        const t = r?.alternative?.[0]?.transcript;
        if (typeof t === "string" && t.trim()) segParts.push(t.trim());
      }
      const combined = segParts.join(" ").trim();
      if (combined) {
        if (hasFinal) finalSegments.push(combined);
        else fallbackSegment = combined;
      }
    } catch (_) {}
  }

  return (finalSegments.length > 0 ? finalSegments.join(" ") : fallbackSegment).trim();
}

const CHROMIUM_STT_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function sendGoogleSttChunk(
  url: string,
  contentType: string,
  payloadBytes: Uint8Array
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "User-Agent": CHROMIUM_STT_UA,
        Accept: "*/*",
      },
      body: payloadBytes as unknown as BodyInit,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      return { ok: false, status: resp.status, text: "" };
    }
    const rawText = await resp.text();
    return { ok: true, status: resp.status, text: parseGoogleSttResponseText(rawText) };
  } catch (_) {
    clearTimeout(timer);
    return { ok: false, status: 0, text: "" };
  }
}

async function transcribeSliceWithFlacAndL16(
  url: string,
  slice: Buffer,
  sampleRate: number
): Promise<{ text: string; anyOk: boolean; hadFailure: boolean }> {
  let anyOk = false;
  let hadFailure = false;

  // Attempt 1: Native lossless FLAC container (most reliable for Chromium v2 endpoint)
  try {
    const flacBuf = encodePcm16ToFlac(slice, sampleRate);
    const flacRes = await sendGoogleSttChunk(
      url,
      `audio/x-flac; rate=${sampleRate}`,
      new Uint8Array(flacBuf)
    );
    if (flacRes.ok) {
      anyOk = true;
      if (flacRes.text) return { text: flacRes.text, anyOk, hadFailure: false };
    } else {
      hadFailure = true;
    }
  } catch (_) {
    hadFailure = true;
  }

  // Attempt 2: Raw PCM audio/l16 fallback with isolated byte copy
  const l16Copy = new Uint8Array(slice.length);
  l16Copy.set(slice);
  const l16Res = await sendGoogleSttChunk(url, `audio/l16; rate=${sampleRate}`, l16Copy);
  if (l16Res.ok) {
    anyOk = true;
    if (l16Res.text) return { text: l16Res.text, anyOk, hadFailure: false };
  } else {
    hadFailure = true;
  }

  return { text: "", anyOk, hadFailure };
}

async function transcribePcmWithGoogleFreeStt(
  pcmBuffer: Buffer,
  sampleRate: number,
  lang: string
): Promise<{ text: string; upstreamFailed: boolean }> {
  const languageCode = lang === "fa" ? "fa-IR" : "en-US";
  const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=${languageCode}&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw&pFilter=0`;
  const chunkByteLimit = Math.max(32000, sampleRate * 2 * 12);
  const texts: string[] = [];
  let sliceCount = 0;
  let anyUpstreamOk = false;
  let anyUpstreamFailed = false;

  for (let off = 0; off < pcmBuffer.length; off += chunkByteLimit) {
    const slice = pcmBuffer.subarray(off, Math.min(pcmBuffer.length, off + chunkByteLimit));
    if (slice.length < 320) continue;
    sliceCount++;
    const r = await transcribeSliceWithFlacAndL16(url, slice, sampleRate);
    if (r.anyOk) anyUpstreamOk = true;
    if (r.hadFailure) anyUpstreamFailed = true;
    if (r.text) texts.push(r.text);
  }

  // If chunking >= 2 slices yielded nothing and total is <= 15s, try full buffer once
  if (texts.length === 0 && sliceCount >= 2 && pcmBuffer.length <= sampleRate * 2 * 15) {
    const fullRes = await transcribeSliceWithFlacAndL16(url, pcmBuffer, sampleRate);
    if (fullRes.anyOk) anyUpstreamOk = true;
    if (fullRes.hadFailure) anyUpstreamFailed = true;
    if (fullRes.text) texts.push(fullRes.text);
  }

  return {
    text: texts.join(" ").trim(),
    upstreamFailed: !anyUpstreamOk && anyUpstreamFailed,
  };
}

export async function handleTranscribe(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const body = await parseBodyAsync(req);
  const isFa = body?.lang === "fa";

  try {
    const { audioBase64, wavBase64, mimeType, lang = "fa" } = body;
    const primaryInput = audioBase64 || wavBase64;
    if (!primaryInput || typeof primaryInput !== "string") {
      return res.status(400).json({ error: { code: "MISSING_AUDIO", message: "Missing audio data" } });
    }

    const cleanPrimaryB64 = primaryInput.includes(",") ? primaryInput.split(",")[1] : primaryInput.trim();
    const rawBuffer = Buffer.from(cleanPrimaryB64, "base64");

    let wavBuffer: Buffer | null = null;
    if (typeof wavBase64 === "string" && wavBase64.trim()) {
      const cleanWavB64 = wavBase64.includes(",") ? wavBase64.split(",")[1] : wavBase64.trim();
      wavBuffer = Buffer.from(cleanWavB64, "base64");
    } else if (
      rawBuffer.length > 44 &&
      rawBuffer.toString("ascii", 0, 4) === "RIFF" &&
      rawBuffer.toString("ascii", 8, 12) === "WAVE"
    ) {
      wavBuffer = rawBuffer;
    }

    if (rawBuffer.length < 50 && (!wavBuffer || wavBuffer.length < 50)) {
      return res.status(400).json({
        error: { code: "EMPTY_AUDIO", message: "Audio recording was empty or too short." },
      });
    }

    let cleanMime = "";
    if (primaryInput.startsWith("data:")) {
      const match = primaryInput.match(/^data:([^;,]+)/);
      if (match) cleanMime = match[1].trim().toLowerCase();
    }
    if (!cleanMime && typeof mimeType === "string" && mimeType) {
      cleanMime = mimeType.split(";")[0].trim().toLowerCase();
    }
    if (!cleanMime) cleanMime = wavBuffer ? "audio/wav" : "audio/webm";

    let transcription = "";
    let isSilentAudio = false;
    let sttUpstreamFailed = false;

    if (wavBuffer) {
      const pcmInfo = extractWavPcmInfo(wavBuffer);
      if (pcmInfo && pcmInfo.pcm.length >= 320) {
        isSilentAudio = pcmInfo.rms < 0.0015;
        if (!isSilentAudio) {
          const sttResult = await transcribePcmWithGoogleFreeStt(pcmInfo.pcm, pcmInfo.sampleRate, lang);
          transcription = sttResult.text;
          sttUpstreamFailed = sttResult.upstreamFailed;
        }
      }
    }

    const apiKey = getGeminiKey(req);
    if (!transcription && !isSilentAudio && apiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            timeout: 25000,
            headers: { "User-Agent": "aistudio-build" },
          },
        });
        const promptText = isFa
          ? "متن فایل صوتی پیوست را با دقت کامل به زبان فارسی بنویسید. تمامی واژگان و صحبت‌های گوینده درباره پرونده یا ادعا را کلمه به کلمه با رسم‌الخط صحیح فارسی بنویسید. فقط و فقط متن پیاده‌شده را خروجی دهید و از افزودن هرگونه توضیح اضافه یا علامت گیومه خودداری نمایید."
          : "Accurately transcribe the provided spoken voice audio into clear, punctuated text in English. Output ONLY the transcribed words without any commentary, markdown headers, or labels.";

        const audioPart = {
          inlineData: {
            mimeType: cleanMime,
            data: cleanPrimaryB64,
          },
        };

        const modelsToTry = ["gemini-3.5-transcribe", "gemini-4-hydrogen"];
        for (const modelName of modelsToTry) {
          try {
            const response: any = await ai.models.generateContent({
              model: modelName,
              contents: { parts: [audioPart, { text: promptText }] },
            });
            const text =
              typeof response?.text === "string" && response.text.trim()
                ? response.text.trim()
                : (response?.candidates?.[0]?.content?.parts || [])
                    .map((p: any) => p?.text || p?.audioTranscription?.text || "")
                    .join(" ")
                    .trim();
            if (text) {
              transcription = text;
              break;
            }
          } catch (_) {}
        }
      } catch (_) {}
    }

    const cleanTranscription = transcription.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
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
      cleanTranscription === "صفر صفر صفر صفر" ||
      cleanTranscription.toLowerCase() === "you" ||
      cleanTranscription.toLowerCase() === "thank you.";

    if (cleanTranscription && !isSilenceMarker) {
      return res.status(200).json({
        transcription: cleanTranscription,
        success: true,
        audioAttached: true,
        isAiTranscribed: true,
      });
    }

    const reason =
      !isSilentAudio && sttUpstreamFailed && !apiKey ? "STT_UPSTREAM_BLOCKED" : undefined;

    return res.status(200).json({
      transcription: "",
      success: true,
      audioAttached: true,
      isAiTranscribed: false,
      isSilentAudio,
      ...(reason ? { reason } : {}),
      message: isFa
        ? "فایل صوتی با کیفیت در پرونده ذخیره و ضمیمه شد."
        : "Audio recording successfully attached to case.",
    });
  } catch (error: any) {
    console.error("Vercel transcribe error:", error?.message || error);
    return res.status(200).json({
      transcription: "",
      audioAttached: true,
      success: true,
      isAiTranscribed: false,
      message: isFa ? "فایل صوتی ضمیمه شد." : "Audio attached.",
    });
  }
}

export async function handleDeliberate(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const body = await parseBodyAsync(req);
  const isFa = body?.lang === "fa";

  try {
    const { partyA, partyB } = body;
    if (!partyA?.claimText || !String(partyA.claimText).trim()) {
      return res.status(400).json({
        error: {
          code: "MISSING_CLAIMS",
          message: isFa ? "شرح ادعای خواهان الزامی است." : "Party A claim statement is required.",
          retryable: false,
        },
      });
    }

    const judgeBrainUrl = getEnvValue("JUDGE_BRAIN_URL");
    if (judgeBrainUrl) {
      const targetUrl = judgeBrainUrl.replace(/\/$/, "").endsWith("/api/deliberate")
        ? judgeBrainUrl.replace(/\/$/, "")
        : `${judgeBrainUrl.replace(/\/$/, "")}/api/deliberate`;
      const controller = new AbortController();
      const brainTimer = setTimeout(() => controller.abort(), 55000);
      try {
        const brainResp = await fetch(targetUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lang: body?.lang,
            partyA,
            partyB,
          }),
          signal: controller.signal,
        });
        const brainData: any = await brainResp.json().catch(() => null);
        if (brainResp.ok && brainData?.verdict) {
          return res.status(200).json({ verdict: brainData.verdict });
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

    const partyAName = (partyA.name || "").trim() || (isFa ? "خواهان (طرف اول)" : "Party A");
    const partyBName = (partyB?.name || "").trim() || (isFa ? "خوانده (طرف دوم)" : "Party B");
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

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        timeout: 55000,
        headers: { "User-Agent": "aistudio-build" },
      },
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
        timeoutMs: 20000,
        backoffMs: 0,
        label: "gemini-4-hydrogen (MEDIUM)",
      },
      {
        model: "gemini-3.1-flash-lite",
        timeoutMs: 14000,
        backoffMs: 1000,
        label: "gemini-3.1-flash-lite",
      },
      {
        model: "gemini-4-hydrogen",
        thinkingLevel: ThinkingLevel.LOW,
        timeoutMs: 14000,
        backoffMs: 1400,
        label: "gemini-4-hydrogen (LOW)",
      },
    ];

    let verdictData: any = null;
    let lastDelibError: any = null;
    const rateLimitedModels = new Set<string>();

    for (const attempt of attempts) {
      if (rateLimitedModels.has(attempt.model)) {
        continue;
      }

      if (attempt.backoffMs > 0) {
        await sleepMs(attempt.backoffMs + Math.floor(Math.random() * 350));
      }

      let timer: ReturnType<typeof setTimeout> | null = null;
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
        if (errStatus === 429 || errMsg.toLowerCase().includes("resource_exhausted")) {
          rateLimitedModels.add(attempt.model);
        }
        if (!lastDelibError || errStatus !== 404) {
          lastDelibError = err;
        }
        console.warn(`Vercel deliberation attempt ${attempt.label} failed:`, errStatus, errMsg.slice(0, 140));
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
        },
      });
    }

    return res.status(200).json({ verdict: verdictData });
  } catch (error: any) {
    console.error("Vercel deliberate error:", error?.message || error);
    const classified = classifyGeminiError(error, isFa);
    return res.status(classified.status).json({
      error: {
        code: classified.code,
        message: classified.message,
        retryable: true,
      },
    });
  }
}

export async function handleCases(req: any, res: any, caseId?: string) {
  if (!caseId) {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    try {
      const body = await parseBodyAsync(req);
      const { partyA, partyB, lang } = body;
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
      return res.status(200).json({ success: true, caseId: id, caseData: caseItem });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Internal server error" });
    }
  }

  if (req.method === "GET") {
    const caseItem = sharedCasesMap.get(caseId);
    if (!caseItem) {
      return res.status(404).json({ error: "Case not found or expired" });
    }
    return res.status(200).json({ success: true, caseData: caseItem });
  }

  if (req.method === "PUT") {
    try {
      const existing = sharedCasesMap.get(caseId);
      if (!existing) {
        return res.status(404).json({ error: "Case not found" });
      }
      const body = await parseBodyAsync(req);
      const { partyB, partyA, verdict } = body;
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
      if (verdict) existing.verdict = verdict;
      existing.updatedAt = Date.now();
      sharedCasesMap.set(caseId, existing);
      return res.status(200).json({ success: true, caseData: existing });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

export async function handleDecreePdf(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await parseBodyAsync(req);
    const { decreeCode, caseData, lang } = body;

    if (!decreeCode || typeof decreeCode !== "string") {
      return res.status(400).json({ error: "Missing decreeCode to access certified decree." });
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

    return res.status(200).json({
      paid: true,
      free: true,
      decreeCode,
      html: renderedHtml,
    });
  } catch (error: any) {
    console.error("Vercel decree PDF generation failed:", error?.message || error);
    return res.status(500).json({ error: error?.message || "Internal server error" });
  }
}

export async function handlePaymentCheckout(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }
  try {
    const body = await parseBodyAsync(req);
    const { decreeCode, lang } = body;
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
      metadata: { decreeCode },
      success_url: `${appBase}/?session_id={CHECKOUT_SESSION_ID}&decree=${encodeURIComponent(decreeCode)}&paid=true`,
      cancel_url: `${appBase}/?canceled=true&decree=${encodeURIComponent(decreeCode)}`,
    });
    return res.status(200).json({ url: session.url, id: session.id });
  } catch (error: any) {
    return res.status(500).json({
      error: {
        code: "CHECKOUT_FAILED",
        message: error?.message || "Failed to create Stripe checkout session",
      },
    });
  }
}

export async function handlePaymentStatus(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ paid: false, error: "Method not allowed" });
  }
  try {
    const query = req?.query || {};
    const sessionId = String(query.session_id || "");
    const zibalTrackId = String(query.zibal_track_id || query.trackId || "");
    const decree = String(query.decree || query.decreeCode || "");

    if (decree && paidDecreesSet.has(decree)) {
      return res.status(200).json({
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
          if (resolvedDecree) paidDecreesSet.add(resolvedDecree);
          return res.status(200).json({
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
            paidDecreesSet.add(code);
            return res.status(200).json({
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
      return res.status(200).json({
        paid: paidDecreesSet.has(decree),
        decreeCode: decree,
      });
    }

    return res.status(400).json({ paid: false, error: "Missing session_id, zibal_track_id, or decree" });
  } catch (error: any) {
    return res.status(500).json({ paid: false, error: error?.message });
  }
}

export async function handleVarizaConfirm(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const body = await parseBodyAsync(req);
  const { decreeCode, trackingCode } = body;
  if (decreeCode && typeof decreeCode === "string") paidDecreesSet.add(decreeCode);
  return res.status(200).json({ success: true, paid: true, decreeCode, trackingCode });
}

export async function handlePaypalConfirm(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const body = await parseBodyAsync(req);
  const { decreeCode } = body;
  if (decreeCode && typeof decreeCode === "string") paidDecreesSet.add(decreeCode);
  return res.status(200).json({ success: true, paid: true, decreeCode });
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

export async function handleZibalRequest(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "Method not allowed" } });
  }

  const body = await parseBodyAsync(req);
  const isFa = body?.lang !== "en";

  try {
    const { decreeCode, mobile } = body;
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

    const requestPayload: Record<string, any> = {
      merchant,
      amount: PDF_PRICE_RIAL,
      callbackUrl,
      description: `صدور دادنامه رسمی و سند تک‌برگی دیوان دادگر - کد پرونده ${decreeCode}`,
      orderId: decreeCode,
    };
    const cleanMobile = typeof mobile === "string" ? mobile.trim() : "";
    if (cleanMobile) {
      requestPayload.mobile = cleanMobile;
    }

    const response = await fetch("https://gateway.zibal.ir/v1/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const data: any = await response.json().catch(() => null);
    if (data?.result === 100 && data?.trackId) {
      const trackId = String(data.trackId);
      pendingZibalMap.set(trackId, {
        decreeCode,
        amountRial: PDF_PRICE_RIAL,
        createdAt: Date.now(),
      });
      return res.status(200).json({
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
    console.error("Vercel Zibal request error:", error?.message || error);
    return res.status(502).json({
      error: {
        code: "ZIBAL_CONNECTION_FAILED",
        message: isFa
          ? "برقراری ارتباط با سرور درگاه زیبال ممکن نشد. لطفاً دقایقی دیگر تلاش فرمایید."
          : error?.message || "Failed to connect to Zibal gateway.",
      },
    });
  }
}

export async function handleZibalCallback(req: any, res: any) {
  try {
    const q = req?.query || {};
    const body = req?.method === "POST" ? await parseBodyAsync(req) : {};
    const trackId = String(q.trackId || body.trackId || "");
    const success = String(q.success || body.success || "");
    const decreeCodeParam = String(q.decreeCode || q.orderId || body.orderId || "");
    const pendingTx = trackId ? pendingZibalMap.get(trackId) : undefined;
    const decreeCode = decreeCodeParam || pendingTx?.decreeCode || "";
    const appBase = getAppBaseUrl(req);

    if (!decreeCode) {
      return res.redirect(`${appBase}/?payment_failed=true&error=missing_decree&gateway=zibal`);
    }

    if (success !== "1" || !trackId) {
      return res.redirect(
        `${appBase}/?canceled=true&decree=${encodeURIComponent(decreeCode)}&gateway=zibal`
      );
    }

    const merchant = getZibalMerchant();
    const verification = await verifyZibalTransaction(merchant, trackId, decreeCode);

    if (verification.paid) {
      paidDecreesSet.add(decreeCode);
      const refId = verification.refNumber || trackId;
      return res.redirect(
        `${appBase}/?decree=${encodeURIComponent(decreeCode)}&paid=true&gateway=zibal&ref_id=${encodeURIComponent(refId)}&track_id=${encodeURIComponent(trackId)}`
      );
    }

    return res.redirect(
      `${appBase}/?decree=${encodeURIComponent(decreeCode)}&payment_failed=true&gateway=zibal`
    );
  } catch (error: any) {
    console.error("Vercel Zibal callback error:", error?.message || error);
    return res.status(500).send("Error processing Zibal callback");
  }
}
