import React, { useState } from 'react';
import { User, FileText, CheckCircle2, Mic, Loader2, Sparkles, Smartphone } from 'lucide-react';
import { Language, PartyClaim } from '../types.ts';
import { getTranslation } from '../translations.ts';
import { AudioRecorder } from './AudioRecorder.tsx';

interface ClaimInputProps {
  lang: Language;
  party: PartyClaim;
  partyKey: 'partyA' | 'partyB';
  label: string;
  onChange: (updated: PartyClaim) => void;
  accentColor?: 'amber' | 'sky';
}

export const ClaimInput: React.FC<ClaimInputProps> = ({
  lang,
  party,
  partyKey,
  label,
  onChange,
  accentColor = 'amber',
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  const [recordingState, setRecordingState] = useState<{
    isRecording: boolean;
    isTranscribing: boolean;
    duration: number;
  }>({
    isRecording: false,
    isTranscribing: false,
    duration: 0,
  });

  const [recentlyTranscribed, setRecentlyTranscribed] = useState(false);

  const handleAppendText = (chunk: string) => {
    const trimmed = chunk.trim();
    if (!trimmed) return;
    const current = (party.claimText || '').trim();
    const updated = current ? `${current}\n${trimmed}` : trimmed;
    onChange({
      ...party,
      claimText: updated,
    });
    setRecentlyTranscribed(true);
    setTimeout(() => setRecentlyTranscribed(false), 3000);
  };

  const handleTranscription = (transcribedText: string, audioBase64?: string, mimeType?: string) => {
    let updatedText = (party.claimText || '').trim();
    const incoming = (transcribedText || '').trim();

    if (incoming) {
      if (
        !updatedText ||
        updatedText === '«لایحه بر مبنای فایل صوتی ضبط‌شده»' ||
        updatedText === '«Claim based on recorded voice»'
      ) {
        updatedText = incoming;
      } else if (!updatedText.includes(incoming)) {
        updatedText = `${updatedText}\n\n${incoming}`;
      }
      setRecentlyTranscribed(true);
      setTimeout(() => setRecentlyTranscribed(false), 4000);
    }

    onChange({
      ...party,
      claimText: updatedText,
      audioBase64: audioBase64 !== undefined ? audioBase64 : party.audioBase64,
      audioMimeType: mimeType || party.audioMimeType,
    });
  };

  const handleRemoveAudio = () => {
    onChange({
      ...party,
      audioBase64: undefined,
      audioMimeType: undefined,
    });
  };

  const handleQuickInsert = (sampleText: string) => {
    const existing = party.claimText.trim();
    const updated = existing ? `${existing}\n\n${sampleText}` : sampleText;
    onChange({
      ...party,
      claimText: updated,
    });
  };

  const isSecondParty = accentColor === 'sky' || partyKey === 'partyB';

  const samplesFa = [
    {
      title: 'بدهی و واریزی',
      text:
        partyKey === 'partyA'
          ? 'در تاریخ ۱۵ بهمن مبلغ ۵۰ میلیون تومان بابت خرید کالا به حساب خوانده واریز نمودم و فیش واریز موجود است، اما ایشان از تحویل کالا و بازگرداندن وجه استنکاف می‌ورزد.'
          : 'مبلغ واریزی بابت بدهی قبلی خواهان در پروژه مشترک بوده و رسید تسویه حساب فیمابین در پیام‌رسان موجود است و دینی بر ذمه اینجانب باقی نمانده است.',
    },
    {
      title: 'قرارداد کاری و پروژه',
      text:
        partyKey === 'partyA'
          ? 'طبق قرارداد فیمابین، طراحی کامل نرم‌افزار را در موعد مقرر تحویل دادم اما کارفرما قسط آخر حق‌الزحمه به مبلغ ۳۵ میلیون تومان را به بهانه تغییرات خارج از قرارداد پرداخت نکرده است.'
          : 'مجری پروژه وظایف مندرج در قرارداد را با تاخیر ۴۵ روزه و دارای خطاهای اساسی فنی تحویل داده که موجب خسارت به کسب‌وکار گردیده است.',
    },
    {
      title: 'ودیعه و اجاره ملک',
      text:
        partyKey === 'partyA'
          ? 'ملک استیجاری را در پایان مهلت قرارداد کاملاً تخلیه و تحویل دادم ولی موجر از عودت ۱۰۰ میلیون تومان پول پیش (ودیعه مسکن) خودداری می‌کند.'
          : 'مستاجر محترم قبوض آب و گاز و خسارت وارده به شیرآلات و نقاشی منزل را تسویه ننموده و پس از کسر خسارات واقعی، مابقی ودیعه قابل استرداد است.',
    },
  ];

  return (
    <div className="bg-white border-2 border-[#111111] rounded-[4px] p-5 sm:p-7 space-y-5 shadow-[4px_4px_0px_#111111]">
      {/* Box Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 pb-3.5 gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-[3px] flex items-center justify-center font-black text-sm tabular-nums border border-[#111111] ${
              isSecondParty
                ? 'bg-[#111111] text-[#FFC400]'
                : 'bg-[#FFC400] text-[#111111]'
            }`}
          >
            {partyKey === 'partyA' ? '۱' : '۲'}
          </div>
          <h3 className="font-black text-sm sm:text-base text-[#111111]">{label}</h3>
        </div>

        {(party.claimText.trim().length > 20 || !!party.audioBase64) && (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{isFa ? 'آماده داوری' : 'Ready'}</span>
          </span>
        )}
      </div>

      {/* Party Name */}
      <div className="space-y-1.5">
        <label className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-neutral-600" />
          <span>{partyKey === 'partyA' ? t.claimantLabel : t.defendantLabel}</span>
        </label>
        <input
          type="text"
          value={party.name}
          onChange={(e) => onChange({ ...party, name: e.target.value })}
          placeholder={partyKey === 'partyA' ? t.defaultPartyAName : t.defaultPartyBName}
          className="w-full bg-[#FAFAFA] border border-neutral-300 focus:bg-white focus:border-[#111111] focus:ring-2 focus:ring-[#FFC400] rounded-[3px] px-4 py-2.5 text-xs sm:text-sm text-[#111111] placeholder-neutral-400 outline-none transition-colors"
        />
      </div>

      {/* Claim Text Area */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <label className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#111111]" />
              <span>{t.claimTextLabel}</span>
            </label>

            {recordingState.isRecording && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                <span className="w-2 h-2 bg-rose-600 inline-block" />
                <span>{isFa ? 'در حال ضبط ویس...' : 'Recording voice...'}</span>
              </span>
            )}

            {recordingState.isTranscribing && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-[#111111]">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#111111]" />
                <span>{isFa ? 'در حال تبدیل صوت به متن...' : 'Transcribing...'}</span>
              </span>
            )}

            {recentlyTranscribed && (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>{isFa ? 'متن ویس درج شد' : 'Transcribed'}</span>
              </span>
            )}
          </div>

          <span className="text-[11px] font-mono tabular-nums text-neutral-500">
            {party.claimText.length} {isFa ? 'کاراکتر' : 'chars'}
          </span>
        </div>

        {/* Textarea Box */}
        <div className="relative">
          <textarea
            rows={5}
            value={party.claimText}
            onChange={(e) => onChange({ ...party, claimText: e.target.value })}
            placeholder={
              recordingState.isRecording
                ? isFa
                  ? 'در حال گوش دادن به صحبت‌های شما... کلمات مستقیماً در این کادر نوشته می‌شوند.'
                  : 'Listening... Spoken words will be written directly into this box.'
                : t.claimPlaceholder
            }
            className={`w-full bg-[#FAFAFA] border ${
              recordingState.isRecording
                ? 'border-rose-600 ring-2 ring-rose-500/25 bg-white'
                : recordingState.isTranscribing
                ? 'border-[#111111] ring-2 ring-[#FFC400] bg-white'
                : recentlyTranscribed
                ? 'border-emerald-600 ring-2 ring-emerald-500/20 bg-white'
                : 'border-neutral-300 focus:bg-white focus:border-[#111111] focus:ring-2 focus:ring-[#FFC400]'
            } rounded-[3px] p-4 text-xs sm:text-sm text-[#111111] placeholder-neutral-400 outline-none transition-colors resize-y leading-relaxed`}
          />
        </div>

        {/* Sample text links when empty */}
        {!party.claimText.trim() && isFa && !recordingState.isRecording && !recordingState.isTranscribing && (
          <div className="pt-0.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>موضوعات پرتکرار:</span>
            {samplesFa.map((item, idx) => (
              <React.Fragment key={idx}>
                <button
                  type="button"
                  onClick={() => handleQuickInsert(item.text)}
                  className="text-[#111111] font-semibold hover:bg-[#FFC400] px-1 py-0.5 transition-colors cursor-pointer underline decoration-[#FFC400] decoration-2 underline-offset-4"
                >
                  {item.title}
                </button>
                {idx < samplesFa.length - 1 && <span aria-hidden="true">·</span>}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Spoken Voice & Dictation Input */}
        <AudioRecorder
          lang={lang}
          partyLabel={party.name}
          existingAudioBase64={party.audioBase64}
          onRemoveAudio={handleRemoveAudio}
          onTranscriptionComplete={handleTranscription}
          onAppendText={handleAppendText}
          onRecordingStateChange={setRecordingState}
        />
      </div>
    </div>
  );
};
