import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  Square,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  Play,
  Pause,
  Trash2,
  FileAudio,
  Sparkles,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { Language } from '../types.ts';
import { getTranslation } from '../translations.ts';

interface AudioRecorderProps {
  lang: Language;
  onTranscriptionComplete: (text: string, audioBase64?: string, mimeType?: string) => void;
  onAppendText?: (chunk: string) => void;
  onRecordingStateChange?: (state: { isRecording: boolean; isTranscribing: boolean; duration: number }) => void;
  partyLabel?: string;
  existingAudioBase64?: string;
  onRemoveAudio?: () => void;
}

// 80Hz highpass + 85th-percentile speech RMS gain + soft ceiling (preserves speech/silence contrast)
function normalizeSpeechPcm(monoSamples: Float32Array, sampleRate = 16000): Float32Array {
  const n = monoSamples.length;
  if (n === 0) return monoSamples;

  // 1. 80Hz 1-pole high-pass filter to remove DC offset and sub-80Hz mic rumble/clicks
  const rc = 1 / (2 * Math.PI * 80);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);
  const hp = new Float32Array(n);
  let prevY = 0;
  let prevX = monoSamples[0] || 0;
  hp[0] = 0;
  for (let i = 1; i < n; i++) {
    const x = monoSamples[i];
    const y = alpha * (prevY + x - prevX);
    hp[i] = y;
    prevY = y;
    prevX = x;
  }

  // 2. Check overall energy — keep pure digital silence untouched so muted mics are caught properly
  let totalSq = 0;
  for (let i = 0; i < n; i++) totalSq += hp[i] * hp[i];
  const overallRms = Math.sqrt(totalSq / n);
  if (overallRms < 0.0005) {
    return hp;
  }

  // 3. Measure 50ms block RMS values and pick the 85th percentile (ignores click spikes and silent gaps)
  const blockLen = Math.max(160, Math.floor(sampleRate * 0.05));
  const blockRmsList: number[] = [];
  for (let start = 0; start < n; start += blockLen) {
    const end = Math.min(n, start + blockLen);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      sumSq += hp[i] * hp[i];
    }
    blockRmsList.push(Math.sqrt(sumSq / Math.max(1, end - start)));
  }
  blockRmsList.sort((a, b) => a - b);
  const p85Idx = Math.min(blockRmsList.length - 1, Math.floor(blockRmsList.length * 0.85));
  const speechRms = Math.max(blockRmsList[p85Idx] || overallRms, overallRms);

  // Compute one uniform gain so pauses aren't pumped into loud hiss; cap gain at 10x
  const gain = speechRms < 0.16 ? Math.min(10, Math.max(1, 0.16 / Math.max(speechRms, 1e-4))) : 1;

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const scaled = hp[i] * gain;
    // Soft knee ceiling above 0.85 to absorb isolated button clicks without clipping speech
    if (Math.abs(scaled) <= 0.85) {
      out[i] = scaled;
    } else {
      const sign = scaled < 0 ? -1 : 1;
      const excess = Math.abs(scaled) - 0.85;
      out[i] = sign * (0.85 + 0.13 * Math.tanh(excess / 0.35));
    }
  }
  return out;
}

function encode16kMonoToWavDataUrl(mono16k: Float32Array): string {
  const maxSamples = 16000 * 75; // <= ~3.2MB base64, well within Vercel 4.5MB limit
  const sampleCount = Math.min(mono16k.length, maxSamples);
  const slice = sampleCount === mono16k.length ? mono16k : mono16k.subarray(0, sampleCount);
  const normalized = normalizeSpeechPcm(slice, 16000);

  const dataBytes = normalized.length * 2;
  const wavBuffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wavBuffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let outOffset = 44;
  for (let i = 0; i < normalized.length; i++) {
    const sample = Math.max(-1, Math.min(1, normalized[i]));
    view.setInt16(outOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    outOffset += 2;
  }

  const bytes = new Uint8Array(wavBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function resampleChunksTo16kWavDataUrl(
  chunks: Float32Array[],
  srcRate: number
): { dataUrl: string; rms: number } | null {
  try {
    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    if (totalLen < 800 || !srcRate) return null;

    const merged = new Float32Array(totalLen);
    let offset = 0;
    let sumSq = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      for (let i = 0; i < c.length; i++) sumSq += c[i] * c[i];
      offset += c.length;
    }
    const rms = Math.sqrt(sumSq / totalLen);

    const ratio = srcRate / 16000;
    const outLen = Math.max(1, Math.floor(totalLen / ratio));
    const downsampled = new Float32Array(outLen);

    if (Math.abs(ratio - 1) < 0.01) {
      downsampled.set(merged.subarray(0, outLen));
    } else {
      // Box-filter averaging downsample to prevent aliasing distortion on speech
      for (let i = 0; i < outLen; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(totalLen, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (let j = start; j < end; j++) sum += merged[j];
        downsampled[i] = sum / (end - start);
      }
    }

    return { dataUrl: encode16kMonoToWavDataUrl(downsampled), rms };
  } catch (err) {
    console.warn('Direct PCM WAV conversion failed:', err);
    return null;
  }
}

// Fallback converter for uploaded audio files (MP3, OGG, M4A, WebM, WAV)
async function convertBlobTo16kMonoWavBase64(blob: Blob): Promise<string | null> {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    const arrayBuf = await blob.arrayBuffer();
    const decodeCtx = new AudioCtx();
    let decoded: AudioBuffer;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
    } finally {
      try {
        await decodeCtx.close();
      } catch (_) {}
    }

    const targetRate = 16000;
    const maxSeconds = 75;
    const rawDuration = Number.isFinite(decoded.duration) && decoded.duration > 0
      ? decoded.duration
      : decoded.length / (decoded.sampleRate || 48000);
    const duration = Math.min(rawDuration, maxSeconds);
    const targetSamples = Math.max(1, Math.floor(duration * targetRate));

    let monoSamples: Float32Array;
    if (typeof OfflineAudioContext !== 'undefined') {
      const offline = new OfflineAudioContext(1, targetSamples, targetRate);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0, 0, duration);
      const rendered = await offline.startRendering();
      monoSamples = rendered.getChannelData(0);
    } else {
      const srcRate = decoded.sampleRate || 48000;
      const ch0 = decoded.getChannelData(0);
      const ratio = srcRate / targetRate;
      monoSamples = new Float32Array(targetSamples);
      for (let i = 0; i < targetSamples; i++) {
        const idx = Math.min(ch0.length - 1, Math.floor(i * ratio));
        monoSamples[i] = ch0[idx] || 0;
      }
    }

    return encode16kMonoToWavDataUrl(monoSamples);
  } catch (err) {
    console.warn('Client 16k WAV conversion skipped:', err);
    return null;
  }
}

export const AudioRecorder: React.FC<AudioRecorderProps> = ({
  lang,
  onTranscriptionComplete,
  onAppendText,
  onRecordingStateChange,
  partyLabel,
  existingAudioBase64,
  onRemoveAudio,
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [micBlockedByFrame, setMicBlockedByFrame] = useState(false);

  // Audio Context and MediaRecorder references
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const rawPcmChunksRef = useRef<Float32Array[]>([]);
  const pcmSampleRateRef = useRef<number>(48000);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  // Hidden file inputs
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nativeRecordInputRef = useRef<HTMLInputElement | null>(null);

  // Sync state changes with parent ClaimInput
  useEffect(() => {
    if (onRecordingStateChange) {
      onRecordingStateChange({
        isRecording,
        isTranscribing,
        duration: recordingDuration,
      });
    }
  }, [isRecording, isTranscribing, recordingDuration]);

  useEffect(() => {
    if (existingAudioBase64 && !recordedAudioUrl) {
      setRecordedAudioUrl(existingAudioBase64);
    }
    return () => {
      cleanupAllAudio();
    };
  }, [existingAudioBase64]);

  const cleanupAllAudio = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
        processorRef.current.onaudioprocess = null;
      } catch (_) {}
      processorRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (_) {}
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {}
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => track.stop());
      } catch (_) {}
      streamRef.current = null;
    }
    rawPcmChunksRef.current = [];
    setAudioLevel(0);
  };

  const startRecording = async () => {
    cleanupAllAudio();
    setErrorNotice(null);
    setSuccessNotice(null);
    setMicBlockedByFrame(false);
    audioChunksRef.current = [];
    rawPcmChunksRef.current = [];

    // Step 1: Request Microphone cleanly with constraint fallback
    let stream: MediaStream | null = null;
    try {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error('INSECURE_CONTEXT');
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('NOT_SUPPORTED');
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (constraintErr: any) {
        // Retry with minimal constraints if advanced constraints fail (e.g. OverconstrainedError)
        const name = constraintErr?.name || '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
          throw constraintErr;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;
    } catch (micErr: any) {
      console.warn('Microphone permission or support error:', micErr);
      const errName = micErr?.name || '';
      const errMsg = micErr?.message || '';
      const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
      let frameBlocksMic = false;
      try {
        const policy = (document as any).permissionsPolicy || (document as any).featurePolicy;
        if (policy && typeof policy.allowsFeature === 'function' && !policy.allowsFeature('microphone')) {
          frameBlocksMic = true;
        }
      } catch (_) {}

      let browserPermState: string = '';
      try {
        if (navigator.permissions && typeof navigator.permissions.query === 'function') {
          const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          browserPermState = perm?.state || '';
        }
      } catch (_) {}

      if (errMsg === 'INSECURE_CONTEXT') {
        setErrorNotice(
          isFa
            ? 'دسترسی میکروفون تنها در ارتباط امن (HTTPS) فعال می‌شود. لطفاً صفحه را با آدرس https باز کنید یا فایل صوتی آپلود نمایید.'
            : 'Microphone requires a secure HTTPS context.'
        );
      } else if (errMsg === 'NOT_SUPPORTED') {
        setErrorNotice(
          isFa
            ? 'مرورگر شما از ضبط مستقیم صدا پشتیبانی نمی‌کند. لطفاً از دکمه «ارسال فایل صوتی» یا ضبط مستقیم دستگاه استفاده فرمایید.'
            : 'Browser does not support direct audio recording. Please upload an audio file.'
        );
      } else if (
        errName === 'NotAllowedError' ||
        errName === 'PermissionDeniedError' ||
        errName === 'SecurityError'
      ) {
        if (frameBlocksMic || (isInIframe && browserPermState !== 'denied')) {
          setMicBlockedByFrame(true);
          setErrorNotice(
            isFa
              ? 'فریم پیش‌نمایش فعلی دسترسی مستقیم به میکروفون را محدود کرده است (با اینکه دسترسی مرورگر شما مشکلی ندارد). برای ضبط مستقیم صدا، صفحه را در تب مستقل باز کنید یا فایل صوتی ضبط‌شده را ارسال فرمایید:'
              : 'The embedded preview frame blocks direct microphone access. Open the app in a standalone tab to record, or upload an audio file:'
          );
        } else {
          setMicBlockedByFrame(isInIframe);
          setErrorNotice(
            isFa
              ? 'مرورگر اجازه دسترسی به میکروفون را نداد. لطفاً در تنظیمات سایت مرورگر گزینه Microphone را روی Allow بگذارید، یا از گزینه‌های جایگزین زیر استفاده کنید:'
              : 'Microphone permission was denied by the browser. Please allow microphone access in site settings or use the options below:'
          );
        }
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setErrorNotice(
          isFa
            ? 'میکروفونی در این دستگاه شناسایی نشد. لطفاً از اتصال میکروفون اطمینان حاصل کنید یا از دکمه «ارسال فایل صوتی» استفاده نمایید.'
            : 'No microphone found on this device. Please connect a microphone or upload an audio file.'
        );
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setErrorNotice(
          isFa
            ? 'میکروفون هم‌اکنون در برنامه یا تب دیگری در حال استفاده است. لطفاً آن را ببندید و دوباره تلاش کنید.'
            : 'Microphone is already in use by another application or tab.'
        );
      } else {
        setErrorNotice(
          isFa
            ? `امکان دسترسی به میکروفون فراهم نشد (${errMsg || errName || 'خطای دسترسی'}). می‌توانید از دکمه «ارسال فایل صوتی» استفاده کنید.`
            : 'Could not access microphone. Please upload an audio file or try again.'
        );
      }
      return;
    }

    // Step 2: Start Volume Level Analyser + Direct Live PCM Capture
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          await Promise.race([
            ctx.resume().catch(() => {}),
            new Promise<void>((r) => setTimeout(r, 150)),
          ]);
        }
        audioContextRef.current = ctx;
        pcmSampleRateRef.current = ctx.sampleRate || 48000;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;

        // Capture raw PCM directly so serverless transcription never relies on WebM decodeAudioData
        try {
          if (typeof ctx.createScriptProcessor === 'function') {
            const processor = ctx.createScriptProcessor(4096, 1, 1);
            const zeroGain = ctx.createGain();
            zeroGain.gain.value = 0;
            processor.onaudioprocess = (ev) => {
              if (!isRecordingRef.current) return;
              const ch = ev.inputBuffer.getChannelData(0);
              if (ch && ch.length > 0) {
                rawPcmChunksRef.current.push(new Float32Array(ch));
              }
            };
            source.connect(processor);
            processor.connect(zeroGain);
            zeroGain.connect(ctx.destination);
            processorRef.current = processor;
          }
        } catch (_) {}

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (!isRecordingRef.current || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.max(5, Math.round((avg / 96) * 100))));
          animFrameRef.current = requestAnimationFrame(updateLevel);
        };
        animFrameRef.current = requestAnimationFrame(updateLevel);
      }
    } catch (_) {}

    // Step 3: Start MediaRecorder
    let chosenMime = '';
    const mimeCandidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg',
    ];
    if (typeof MediaRecorder !== 'undefined') {
      for (const m of mimeCandidates) {
        try {
          if (MediaRecorder.isTypeSupported(m)) {
            chosenMime = m;
            break;
          }
        } catch (_) {}
      }
    }

    try {
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(
          stream,
          chosenMime ? { mimeType: chosenMime } : undefined
        );
      } catch (_) {
        chosenMime = '';
        recorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const mime = chosenMime || recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';
        const finalBlob = new Blob(audioChunksRef.current, { type: mime });
        const capturedPcm = rawPcmChunksRef.current.slice();
        const capturedRate = pcmSampleRateRef.current || 48000;
        handleRecordingComplete(finalBlob, mime, capturedPcm, capturedRate);
      };

      recorder.start(250);
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (recorderErr: any) {
      console.warn('MediaRecorder init error:', recorderErr);
      cleanupAllAudio();
      setErrorNotice(
        isFa
          ? 'مرورگر اجازه ضبط مستقیم صدا را نداد. لطفاً از گزینه ارسال فایل صوتی استفاده فرمایید.'
          : 'Could not record audio. Please upload an audio file.'
      );
      return;
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (_) {
        cleanupAllAudio();
      }
    } else {
      cleanupAllAudio();
    }
  };

  const cancelRecording = () => {
    cleanupAllAudio();
  };

  const handleRecordingComplete = (
    blob: Blob,
    mime: string,
    capturedPcm?: Float32Array[],
    capturedRate?: number
  ) => {
    cleanupAllAudio();

    if (blob.size < 200 && (!capturedPcm || capturedPcm.length === 0)) {
      setErrorNotice(
        isFa
          ? 'صدایی ضبط نشد (فایل بسیار کوتاه یا خالی است). لطفاً پس از زدن دکمه ضبط، شمرده صحبت بفرمایید و سپس دکمه توقف را بزنید.'
          : 'No voice captured. Please speak into the microphone before stopping.'
      );
      return;
    }

    const localUrl = URL.createObjectURL(blob);
    setRecordedAudioUrl(localUrl);

    // Convert to base64 and normalized 16kHz PCM WAV, then send for transcription
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onloadend = async () => {
      const base64Audio = reader.result as string;
      setIsTranscribing(true);
      setErrorNotice(null);

      try {
        let wavDataUrl: string | null = null;
        if (capturedPcm && capturedPcm.length > 0 && capturedRate) {
          const direct = resampleChunksTo16kWavDataUrl(capturedPcm, capturedRate);
          if (direct) {
            if (direct.rms >= 0.0005) {
              wavDataUrl = direct.dataUrl;
            } else {
              // Double-check decoded MediaRecorder blob in case ScriptProcessor got suspended by OS/browser
              const decodedWav = await convertBlobTo16kMonoWavBase64(blob);
              wavDataUrl = decodedWav || direct.dataUrl;
            }
          }
        }
        if (!wavDataUrl) {
          wavDataUrl = await convertBlobTo16kMonoWavBase64(blob);
        }

        const combinedTooLarge = wavDataUrl && base64Audio.length + wavDataUrl.length > 3_400_000;
        const payload = wavDataUrl
          ? {
              audioBase64: combinedTooLarge ? wavDataUrl : base64Audio,
              wavBase64: wavDataUrl,
              mimeType: combinedTooLarge ? 'audio/wav' : mime,
              lang,
            }
          : {
              audioBase64: base64Audio,
              mimeType: mime,
              lang,
            };

        const res = await fetch('/api/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);

        const serverText = (data?.transcription || '').trim();

        if (serverText) {
          onTranscriptionComplete(serverText, base64Audio, mime);
          setSuccessNotice(
            isFa
              ? `متن گفتار شما در کادر بالا درج شد: «${serverText.slice(0, 50)}${serverText.length > 50 ? '...' : ''}»`
              : 'Speech transcribed and inserted into claim box.'
          );
        } else {
          onTranscriptionComplete('', base64Audio, mime);
          if (!res.ok) {
            setErrorNotice(
              isFa
                ? `فایل صوتی ضمیمه شد، اما سرور تبدیل صوت پاسخ نداد (کد ${res.status}). می‌توانید شرح ماوقع را در کادر بالا تایپ فرمایید.`
                : `Voice memo saved, but transcription server returned HTTP ${res.status}.`
            );
          } else if (data?.isSilentAudio) {
            setErrorNotice(
              isFa
                ? 'فایل صوتی ذخیره شد، اما هیچ صدایی از میکروفون دریافت نشد (فایل بی‌صداست). لطفاً مطمئن شوید میکروفون دستگاه شما بی‌صدا (Mute) نیست و در تنظیمات سیستم میکروفون صحیح فعال است.'
                : 'Voice memo saved, but the audio was completely silent. Please check your microphone input.'
            );
          } else if (data?.reason === 'STT_UPSTREAM_BLOCKED') {
            setErrorNotice(
              isFa
                ? 'فایل صوتی ذخیره شد، اما سرویس رایگان تشخیص گفتار از سرور فعلی پاسخ نداد. برای اطمینان ۱۰۰٪ در ورسل، متغیر GEMINI_API_KEY را در تنظیمات Environment Variables ورسل اضافه فرمایید یا متن را در کادر بنویسید.'
                : 'Voice memo saved, but upstream free STT did not respond. Set GEMINI_API_KEY in Vercel Environment Variables for reliable cloud transcription.'
            );
          } else {
            setErrorNotice(
              isFa
                ? 'فایل صوتی ذخیره شد، اما کلمات قابل‌تشخیصی استخراج نشد. لطفاً با صدای واضح‌تر و شمرده‌تر نزدیک میکروفون صحبت کنید یا متن را در کادر بالا بنویسید.'
                : 'Voice memo saved, but speech was not recognized. Please speak clearly closer to the microphone or type your claim directly.'
            );
          }
        }
      } catch (err: any) {
        console.warn('Transcribe request network error:', err);
        onTranscriptionComplete('', base64Audio, mime);
        setErrorNotice(
          isFa
            ? 'خطا در ارتباط با سرور تبدیل صوت. فایل صوتی ضمیمه شد، اما می‌توانید شرح ماوقع را در کادر بالا تایپ نمایید.'
            : 'Network error contacting transcription server. Audio attached.'
        );
      } finally {
        setIsTranscribing(false);
        setTimeout(() => setSuccessNotice(null), 8000);
      }
    };
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorNotice(null);
    setSuccessNotice(null);

    const localUrl = URL.createObjectURL(file);
    setRecordedAudioUrl(localUrl);

    handleRecordingComplete(file, file.type || 'audio/mp3');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (nativeRecordInputRef.current) nativeRecordInputRef.current.value = '';
  };

  const handleRemoveRecordedAudio = () => {
    if (recordedAudioUrl && recordedAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(recordedAudioUrl);
    }
    setRecordedAudioUrl(null);
    setIsPlaying(false);
    setPlaybackTime(0);
    setAudioDuration(0);
    if (onRemoveAudio) onRemoveAudio();
  };

  const togglePlayback = () => {
    if (!audioElementRef.current) return;
    if (isPlaying) {
      audioElementRef.current.pause();
      setIsPlaying(false);
    } else {
      audioElementRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="space-y-2.5 pt-1">
      {/* Primary Voice Action Row */}
      {!isRecording ? (
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Main Voice Button */}
          <button
            type="button"
            disabled={isTranscribing}
            onClick={startRecording}
            className="min-h-[42px] px-4 py-2 bg-[#FFC400] hover:bg-[#FFD000] text-[#111111] border border-[#111111] font-bold rounded-[3px] text-xs flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            title={isFa ? 'صحبت بفرمایید تا وویس شما به صورت خودکار به متن تبدیل شده و در کادر بالا نوشته شود' : 'Record voice to automatically transcribe and type into box'}
          >
            <Mic className="w-4 h-4 text-[#111111] shrink-0" />
            <span>{isFa ? 'ضبط ویس و تبدیل به متن' : 'Record Voice & Transcribe'}</span>
          </button>

          {/* Upload Audio File */}
          <button
            type="button"
            disabled={isTranscribing}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[42px] px-3.5 py-2 bg-white hover:bg-neutral-100 text-[#111111] border border-neutral-300 hover:border-[#111111] rounded-[3px] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
            title={isFa ? 'ارسال فایل صوتی ضبط‌شده قبلی' : 'Upload existing audio file'}
          >
            <Upload className="w-3.5 h-3.5 text-neutral-700" />
            <span>{isFa ? 'ارسال فایل صوتی' : 'Upload Audio'}</span>
          </button>

          {/* Hidden inputs */}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.webm,.flac"
            onChange={handleFileUpload}
            className="hidden"
          />
          <input
            ref={nativeRecordInputRef}
            type="file"
            accept="audio/*"
            capture="user"
            onChange={handleFileUpload}
            className="hidden"
          />

          {/* Loading Indicator */}
          {isTranscribing && (
            <div className="flex items-center gap-2 text-xs text-[#111111] bg-[#FFFDF2] border border-[#111111] px-3.5 py-2 rounded-[3px]">
              <Loader2 className="w-4 h-4 animate-spin text-[#111111] shrink-0" />
              <span className="font-bold">{isFa ? 'در حال تبدیل ویس به متن...' : 'Transcribing audio...'}</span>
            </div>
          )}
        </div>
      ) : (
        /* Active Recording State */
        <div className="p-3.5 bg-[#FFFDF2] border-2 border-[#111111] rounded-[3px] flex flex-col gap-2 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 bg-rose-600 shrink-0" />
              <span className="text-xs font-mono tabular-nums font-bold text-rose-700">
                {formatSeconds(recordingDuration)}
              </span>
              <span className="text-xs font-bold text-[#111111]">
                {isFa ? 'در حال ضبط ویس... صحبت بفرمایید' : 'Recording voice... Speak now'}
              </span>
              <div
                className="w-16 h-2 bg-neutral-200 border border-neutral-300 overflow-hidden hidden sm:block"
                title={isFa ? 'سطح صدای دریافتی میکروفون' : 'Microphone input level'}
              >
                <div
                  className="h-full bg-[#111111] transition-all duration-75"
                  style={{ width: `${audioLevel}%` }}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={stopRecording}
                className="min-h-[36px] px-3.5 py-1.5 bg-[#111111] hover:bg-neutral-800 text-[#FFC400] rounded-[3px] text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Square className="w-3 h-3 fill-[#FFC400]" />
                <span>{isFa ? 'توقف و درج در کادر' : 'Stop & Insert'}</span>
              </button>

              <button
                type="button"
                onClick={cancelRecording}
                className="p-1.5 text-neutral-500 hover:text-[#111111] rounded-[3px] transition-colors cursor-pointer"
                title={isFa ? 'انصراف' : 'Cancel'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Playable Audio Row when File Attached */}
      {recordedAudioUrl && !isRecording && (
        <div className="px-3.5 py-2.5 bg-[#FAFAFA] border border-neutral-300 rounded-[3px] flex items-center justify-between gap-3 animate-fade-in text-xs">
          <audio
            ref={audioElementRef}
            src={recordedAudioUrl}
            onTimeUpdate={() => setPlaybackTime(audioElementRef.current?.currentTime || 0)}
            onLoadedMetadata={() => setAudioDuration(audioElementRef.current?.duration || 0)}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={togglePlayback}
              className="w-7 h-7 rounded-[2px] bg-[#FFC400] hover:bg-[#FFD000] border border-[#111111] text-[#111111] flex items-center justify-center cursor-pointer transition-colors"
              title={isPlaying ? (isFa ? 'توقف' : 'Pause') : (isFa ? 'پخش' : 'Play')}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-[#111111]" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-[#111111] ml-0.5" />
              )}
            </button>

            <div className="flex items-center gap-2">
              <span className="text-[#111111] font-bold flex items-center gap-1.5">
                <FileAudio className="w-3.5 h-3.5 text-[#111111]" />
                <span>{isFa ? 'فایل صوتی ذخیره شد' : 'Voice memo saved'}</span>
              </span>
              {audioDuration > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-neutral-600">
                  ({formatSeconds(playbackTime)} / {formatSeconds(audioDuration)})
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={startRecording}
              className="text-xs text-[#111111] font-semibold hover:underline cursor-pointer"
            >
              {isFa ? 'ضبط مجدد' : 'Re-record'}
            </button>
            <button
              type="button"
              onClick={handleRemoveRecordedAudio}
              className="p-1 text-neutral-500 hover:text-rose-700 rounded-[2px] transition-colors cursor-pointer"
              title={isFa ? 'حذف صوت' : 'Remove audio'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {successNotice && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-300 px-3 py-2 rounded-[3px] animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          <span>{successNotice}</span>
        </div>
      )}

      {/* Error / Assistance Notice */}
      {errorNotice && (
        <div className="p-3.5 bg-[#FFFDF2] border border-[#111111] rounded-[3px] space-y-2.5 text-xs text-[#111111] animate-fade-in">
          <div className="flex items-start justify-between gap-2">
            <span className="leading-relaxed font-medium">{errorNotice}</span>
            <button
              type="button"
              onClick={() => {
                setErrorNotice(null);
                setMicBlockedByFrame(false);
              }}
              className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {micBlockedByFrame && (
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <a
                href={typeof window !== 'undefined' ? window.location.href : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 bg-[#FFC400] hover:bg-[#FFD000] border border-[#111111] text-[#111111] font-bold rounded-[3px] text-xs inline-flex items-center gap-1.5 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{isFa ? 'باز کردن در تب مستقل (میکروفون آزاد)' : 'Open in standalone tab'}</span>
              </a>

              <button
                type="button"
                onClick={() => nativeRecordInputRef.current?.click()}
                className="px-3 py-1.5 bg-white hover:bg-neutral-100 text-[#111111] border border-neutral-400 font-semibold rounded-[3px] text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Smartphone className="w-3.5 h-3.5 text-[#111111]" />
                <span>{isFa ? 'ضبط با ضبط‌صوت دستگاه' : 'Use device recorder'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
