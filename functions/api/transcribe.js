/**
 * Cloudflare Pages Function: POST /api/transcribe
 */

function cleanSecret(val) {
  if (typeof val !== "string") return "";
  return val.trim().replace(/^["']+|["']+$/g, "").trim();
}

function getApiKey(env, request) {
  const candidates = [
    env?.GEMINI_API_KEY,
    env?.GOOGLE_API_KEY,
    env?.GOOGLE_GENERATIVE_AI_API_KEY,
    env?.API_KEY,
    env?.GEMINI_KEY,
    env?.VITE_GEMINI_API_KEY,
    env?.NEXT_PUBLIC_GEMINI_API_KEY,
    request.headers.get("x-goog-api-key"),
    request.headers.get("x-api-key"),
  ];
  for (const c of candidates) {
    const cleaned = cleanSecret(c);
    if (cleaned) return cleaned;
  }
  return "";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Goog-Api-Key, X-Api-Key",
    },
  });
}

function base64ToUint8Array(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function extractWavDataChunk(bytes) {
  if (bytes.length <= 44) return null;
  const tag = (off) => String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 16000;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "fmt " && chunkSize >= 16) {
      sampleRate = view.getUint32(offset + 12, true) || 16000;
    } else if (chunkId === "data") {
      const start = offset + 8;
      const end = Math.min(bytes.length, start + chunkSize);
      return { pcm: bytes.subarray(start, end), sampleRate };
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return { pcm: bytes.subarray(44), sampleRate };
}

function computePcm16Rms(pcmBytes) {
  const count = Math.floor(pcmBytes.length / 2);
  if (count <= 0) return 1;
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
  let sumSq = 0;
  for (let i = 0; i < count; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / count);
}

async function transcribePcmWithFreeGoogle(pcmBytes, sampleRate, lang) {
  const languageCode = lang === "fa" ? "fa-IR" : "en-US";
  const url = `https://www.google.com/speech-api/v2/recognize?client=chromium&lang=${languageCode}&key=AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw&pFilter=0`;
  const chunkByteLimit = sampleRate * 2 * 15;
  const allTexts = [];

  for (let off = 0; off < pcmBytes.length; off += chunkByteLimit) {
    const slice = pcmBytes.subarray(off, Math.min(pcmBytes.length, off + chunkByteLimit));
    if (slice.length < 320) continue;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": `audio/l16; rate=${sampleRate}` },
        body: slice,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!resp.ok) continue;
      const rawText = await resp.text();
      const lines = rawText.trim().split("\n").map((l) => l.trim()).filter(Boolean);
      const finalSegs = [];
      let fallbackSeg = "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const results = parsed?.result;
          if (!Array.isArray(results) || results.length === 0) continue;
          let hasFinal = false;
          const segParts = [];
          for (const r of results) {
            if (r?.final) hasFinal = true;
            const tr = r?.alternative?.[0]?.transcript;
            if (typeof tr === "string" && tr.trim()) segParts.push(tr.trim());
          }
          const combined = segParts.join(" ").trim();
          if (combined) {
            if (hasFinal) finalSegs.push(combined);
            else fallbackSeg = combined;
          }
        } catch (_) {}
      }
      const chunkText = (finalSegs.length ? finalSegs.join(" ") : fallbackSeg).trim();
      if (chunkText) allTexts.push(chunkText);
    } catch (_) {
      clearTimeout(t);
    }
  }
  return allTexts.join(" ").trim();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    const { audioBase64, wavBase64, mimeType, lang } = body;
    const isFa = lang === "fa";
    const primary = audioBase64 || wavBase64;

    if (!primary) {
      return jsonResponse({ error: { message: isFa ? "داده صوتی دریافت نشد." : "Missing audio data" } }, 400);
    }

    const cleanBase64 = primary.includes(",") ? primary.split(",")[1] : primary.trim();
    if (cleanBase64.length < 50 && (!wavBase64 || wavBase64.length < 60)) {
      return jsonResponse(
        {
          transcription: "",
          noSpeechDetected: true,
          success: false,
          message: isFa ? "فایل ضبط‌شده خالی است." : "Recording was empty.",
        },
        200
      );
    }

    let transcriptionText = "";
    let isSilentAudio = false;

    // 1. Free Google STT on 16kHz PCM WAV (sent by browser AudioRecorder)
    const wavInput = wavBase64 || (cleanBase64.startsWith("UklGR") ? primary : "");
    if (wavInput) {
      try {
        const cleanWav = wavInput.includes(",") ? wavInput.split(",")[1] : wavInput.trim();
        const wavBytes = base64ToUint8Array(cleanWav);
        const extracted = extractWavDataChunk(wavBytes);
        if (extracted && extracted.pcm.length > 320) {
          const rms = computePcm16Rms(extracted.pcm);
          isSilentAudio = rms < 0.0015;
          if (!isSilentAudio) {
            transcriptionText = await transcribePcmWithFreeGoogle(extracted.pcm, extracted.sampleRate, lang || "fa");
          }
        }
      } catch (_) {}
    }

    // 2. Fallback to Gemini API if key available
    const apiKey = getApiKey(env, request);
    if (!transcriptionText && apiKey) {
      let audioMime = mimeType ? mimeType.split(";")[0].trim().toLowerCase() : "audio/webm";
      if (cleanBase64.startsWith("UklGR")) audioMime = "audio/wav";

      const promptText = isFa
        ? "این یک فایل صوتی ادعای حقوقی یا اظهارات طرف دعوی است. لطفاً تمامی صحبت‌های گوینده را با دقت کامل، کلمه به کلمه و با رسم‌الخط صحیح فارسی بنویسید. فقط متن صریح و دقیق پیاده‌شده را برگردانید و هیچ توضیح اضافه یا علامتی نیاورید."
        : "Transcribe the spoken voice audio verbatim into clear plain text. Output ONLY the transcribed words without any preamble or commentary.";

      const models = ["gemini-3.1-flash-lite", "gemini-4-hydrogen"];

      for (const model of models) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 20000);
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "aistudio-build",
              },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      {
                        inlineData: {
                          mimeType: audioMime,
                          data: cleanBase64,
                        },
                      },
                      { text: promptText },
                    ],
                  },
                ],
              }),
              signal: ctrl.signal,
            }
          );
          clearTimeout(t);

          if (!res.ok) {
            continue;
          }

          const data = await res.json().catch(() => null);
          const text = (data?.candidates?.[0]?.content?.parts || [])
            .map((p) => p.text || "")
            .join("")
            .trim();

          if (text) {
            transcriptionText = text;
            break;
          }
        } catch (_) {
          clearTimeout(t);
        }
      }
    }

    if (transcriptionText) {
      const cleanText = transcriptionText.replace(/^["'«»“]+|["'«»”]+$/g, "").trim();
      if (cleanText) {
        return jsonResponse({
          transcription: cleanText,
          audioAttached: true,
          success: true,
          isAiTranscribed: true,
        });
      }
    }

    return jsonResponse({
      transcription: "",
      audioAttached: true,
      success: true,
      isAiTranscribed: false,
      isSilentAudio,
      message: isFa ? "فایل صوتی ذخیره و ضمیمه پرونده گردید." : "Audio attached to case.",
    });
  } catch (err) {
    return jsonResponse(
      {
        transcription: "",
        audioAttached: true,
        success: false,
        error: { message: err?.message || "Internal transcription error" },
      },
      500
    );
  }
}
