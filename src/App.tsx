import React, { useState, useEffect } from 'react';
import {
  Scale,
  Sparkles,
  Languages,
  History,
  Shield,
  HelpCircle,
  Share2,
  AlertCircle,
  Loader2,
  X,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Gavel,
  Trash2,
  ExternalLink,
  Users,
} from 'lucide-react';
import { Language, PartyClaim, CourtVerdict, SavedCase } from './types.ts';
import { getTranslation } from './translations.ts';
import { ClaimInput } from './components/ClaimInput.tsx';
import { VerdictView } from './components/VerdictView.tsx';
import { ShareCaseModal } from './components/ShareCaseModal.tsx';
import { BrandLogo } from './components/BrandLogo.tsx';
import { SAMPLE_CASES } from './data/sampleCases.ts';
import { METHODOLOGY_PRINCIPLES } from './data/legalMethodology.ts';
import { PRIVACY_POLICY_SECTIONS } from './data/privacyPolicy.ts';
import { formatNum } from './utils/numberHelper.ts';
import { decodeCasePayload } from './utils/shareLinkHelper.ts';

export const App: React.FC = () => {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem('dadgar_lang');
      return (stored === 'en' ? 'en' : 'fa') as Language;
    } catch {
      return 'fa';
    }
  });

  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isDeliberating, setIsDeliberating] = useState<boolean>(false);
  const [currentVerdict, setCurrentVerdict] = useState<CourtVerdict | null>(null);

  const [partyA, setPartyA] = useState<PartyClaim>({
    name: t.defaultPartyAName,
    claimText: '',
    evidenceNotes: '',
  });

  const [partyB, setPartyB] = useState<PartyClaim>({
    name: t.defaultPartyBName,
    claimText: '',
    evidenceNotes: '',
  });

  const [aiError, setAiError] = useState<{
    message: string;
    details?: string;
  } | null>(null);

  const [paymentNotice, setPaymentNotice] = useState<{
    type: 'success' | 'canceled';
    message: string;
  } | null>(null);

  const [savedCases, setSavedCases] = useState<SavedCase[]>(() => {
    try {
      const stored = localStorage.getItem('dadgar_verdicts_history');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showSamplesModal, setShowSamplesModal] = useState(false);
  const [showMethodologyModal, setShowMethodologyModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);

  // Two-party collaborative case sharing state
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [isPartyBInvite, setIsPartyBInvite] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isSavingCase, setIsSavingCase] = useState(false);

  useEffect(() => {
    document.documentElement.dir = isFa ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    localStorage.setItem('dadgar_lang', lang);
  }, [lang, isFa]);

  // Handle shared case loading and payment callbacks
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);

    // 1. Check for shared case invite link (?caseId=... & ?d=...)
    const sharedCaseParam = params.get('caseId');
    const encodedDataParam = params.get('d') || params.get('caseData');

    // Instantly unpack case payload if embedded in link
    if (encodedDataParam) {
      const decoded = decodeCasePayload(encodedDataParam);
      if (decoded) {
        if (decoded.caseId) setActiveCaseId(decoded.caseId);
        if (decoded.partyA?.claimText) setPartyA(decoded.partyA);
        if (decoded.partyB?.claimText) {
          setPartyB(decoded.partyB);
        } else if (decoded.partyB?.name) {
          setPartyB((prev) => ({ ...prev, name: decoded.partyB!.name }));
        }
        if (decoded.lang) setLang(decoded.lang);
        setIsPartyBInvite(true);
        setCurrentStep(2);
      }
    }

    if (sharedCaseParam) {
      setActiveCaseId(sharedCaseParam);
      fetch(`/api/cases/${encodeURIComponent(sharedCaseParam)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data?.caseData) {
            const cd = data.caseData;
            if (cd.partyA) setPartyA(cd.partyA);
            if (cd.partyB && cd.partyB.claimText) setPartyB(cd.partyB);
            if (cd.verdict) {
              setCurrentVerdict(cd.verdict);
              setCurrentStep(4);
            } else {
              setIsPartyBInvite(true);
              setCurrentStep(2);
            }
          }
        })
        .catch((err) => console.warn('Could not load shared case:', err));
    }

    // 2. Check for payment callbacks (Stripe, Zibal, Variza)
    const sessionId = params.get('session_id');
    const decreeCode = params.get('decree') || params.get('decreeCode');
    const gateway = params.get('gateway');
    const refId = params.get('ref_id');
    const trackId = params.get('track_id') || params.get('trackId');
    const isCanceled = params.get('canceled') === 'true' || params.get('payment_canceled') === 'true';
    const isFailed = params.get('payment_failed') === 'true';
    const isPaid = params.get('paid') === 'true' || !!sessionId || !!refId;

    if (isCanceled) {
      setPaymentNotice({ type: 'canceled', message: t.paymentCanceledNotice });
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('canceled');
        url.searchParams.delete('payment_canceled');
        url.searchParams.delete('decree');
        url.searchParams.delete('gateway');
        window.history.replaceState({}, document.title, url.pathname);
      } catch (_) {}
      return;
    }

    if (isFailed) {
      setPaymentNotice({
        type: 'canceled',
        message: isFa
          ? 'تراکنش ناموفق بود یا توسط کاربر لغو گردید. در صورت کسر وجه، مبلغ تا ۷۲ ساعت آینده توسط بانک مسترد می‌شود.'
          : 'Payment failed or was canceled. Please try again.',
      });
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('payment_failed');
        url.searchParams.delete('decree');
        url.searchParams.delete('gateway');
        window.history.replaceState({}, document.title, url.pathname);
      } catch (_) {}
      return;
    }

    if (decreeCode && isPaid) {
      try {
        const stored = localStorage.getItem('dadgar_paid_decrees');
        const list = stored ? JSON.parse(stored) : [];
        if (Array.isArray(list)) {
          if (!list.includes(decreeCode)) list.push(decreeCode);
          localStorage.setItem('dadgar_paid_decrees', JSON.stringify(list));
        } else {
          localStorage.setItem('dadgar_paid_decrees', JSON.stringify([decreeCode]));
        }

        if (sessionId) {
          const storedSessions = localStorage.getItem('dadgar_paid_sessions');
          const sessionMap = storedSessions ? JSON.parse(storedSessions) : {};
          sessionMap[decreeCode] = sessionId;
          localStorage.setItem('dadgar_paid_sessions', JSON.stringify(sessionMap));
        }

        if (trackId) {
          const storedTracks = localStorage.getItem('dadgar_zibal_tracks');
          const trackMap = storedTracks ? JSON.parse(storedTracks) : {};
          trackMap[decreeCode] = trackId;
          localStorage.setItem('dadgar_zibal_tracks', JSON.stringify(trackMap));
        }

        if (refId) {
          const storedRefs = localStorage.getItem('dadgar_payment_refs');
          const refMap = storedRefs ? JSON.parse(storedRefs) : {};
          refMap[decreeCode] = refId;
          localStorage.setItem('dadgar_payment_refs', JSON.stringify(refMap));
        }

        const histRaw = localStorage.getItem('dadgar_verdicts_history');
        const hist = histRaw ? JSON.parse(histRaw) : [];
        if (Array.isArray(hist)) {
          const matched = hist.find((item: any) => item?.id === decreeCode || item?.verdict?.courtDecreeCode === decreeCode);
          if (matched?.verdict) {
            if (matched.partyA) setPartyA(matched.partyA);
            if (matched.partyB) setPartyB(matched.partyB);
            setCurrentVerdict(matched.verdict);
            setCurrentStep(4);
          }
        }
      } catch (_) {}

      const successMsg =
        gateway === 'zibal'
          ? (isFa
              ? `پرداخت از طریق درگاه زیبال با موفقیت تأیید شد (کد رهگیری: ${refId || trackId || 'تأییدشده'}). سند رسمی تک‌برگی ممهور بازگشایی گردید.`
              : `Zibal payment confirmed (Ref: ${refId || trackId || 'verified'}). Certified decree is now unlocked.`)
          : t.paymentSuccessNotice;

      setPaymentNotice({ type: 'success', message: successMsg });
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('paid');
        cleanUrl.searchParams.delete('session_id');
        cleanUrl.searchParams.delete('decree');
        cleanUrl.searchParams.delete('gateway');
        cleanUrl.searchParams.delete('ref_id');
        cleanUrl.searchParams.delete('track_id');
        cleanUrl.searchParams.delete('trackId');
        window.history.replaceState({}, document.title, cleanUrl.pathname);
      } catch (_) {}
    }
  }, [isFa, t.paymentCanceledNotice, t.paymentSuccessNotice]);

  const handleStartDeliberation = async () => {
    const claimA = (partyA.claimText || '').trim();
    const hasAudioA = !!partyA.audioBase64;

    if (!claimA && !hasAudioA) {
      setAiError({
        message: isFa
          ? 'لطفاً شرح ادعای خواهان را وارد فرمایید یا صدای خود را ضبط نمایید.'
          : "Please provide the plaintiff's claim or record voice statement.",
      });
      setCurrentStep(1);
      return;
    }

    const effectivePartyA: PartyClaim = {
      ...partyA,
      claimText: claimA || (isFa ? '«لایحه بر مبنای فایل صوتی ضبط‌شده»' : '«Claim based on recorded voice»'),
    };

    setIsDeliberating(true);
    setAiError(null);

    try {
      const response = await fetch('/api/deliberate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partyA: effectivePartyA,
          partyB,
          lang,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      const data = await response.json().catch(() => null);

      if (response.ok && (!data || !contentType.includes('application/json'))) {
        setAiError({
          message: isFa
            ? 'سرویس سرور داوری (/api/deliberate) در این هاست پاسخ JSON نداد (صفحه HTML برگردانده شد). لطفاً پروژه را با بک‌اند کامل Node/Vercel اجرا فرمایید.'
            : 'The arbitration API endpoint (/api/deliberate) returned HTML instead of JSON. Please ensure the backend server or Vercel API function is active.',
          details: 'NON_JSON_API_RESPONSE',
        });
        return;
      }

      if (!response.ok || !data?.verdict || !data.verdict.courtDecreeCode) {
        const serverErrMsg =
          data?.error?.message ||
          (isFa
            ? `خطا در ارتباط با موتور هوش مصنوعی (${response.status}). لطفاً دقایقی دیگر دوباره تلاش فرمایید.`
            : `AI deliberation engine error (${response.status}). Please try again shortly.`);
        setAiError({
          message: serverErrMsg,
          details: data?.error?.code,
        });
        return;
      }

      const finalVerdict: CourtVerdict = data.verdict;
      setCurrentVerdict(finalVerdict);
      setCurrentStep(4);

      // If this is a shared two-party case, persist the verdict so both parties see it
      if (activeCaseId) {
        fetch(`/api/cases/${encodeURIComponent(activeCaseId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partyA,
            partyB,
            verdict: finalVerdict,
          }),
        }).catch(() => {});
      }

      // Save to history
      const newHistoryItem: SavedCase = {
        id: finalVerdict.courtDecreeCode,
        date: new Date().toISOString(),
        partyA,
        partyB,
        verdict: finalVerdict,
        lang,
      };

      setSavedCases((prev) => {
        const updated = [newHistoryItem, ...prev.filter((c) => c.id !== newHistoryItem.id)].slice(0, 30);
        try {
          localStorage.setItem('dadgar_verdicts_history', JSON.stringify(updated));
        } catch (_) {}
        return updated;
      });
    } catch (err: any) {
      console.error('Deliberation error:', err);
      setAiError({
        message: isFa
          ? 'خطا در برقراری ارتباط با سرور داوری هوش مصنوعی. لطفاً اتصال اینترنت را بررسی و دوباره تلاش فرمایید.'
          : 'Failed to reach AI arbitration server. Please check your connection and try again.',
        details: err?.message,
      });
    } finally {
      setIsDeliberating(false);
    }
  };

  const handleOpenShareCase = async () => {
    if (!partyA.claimText.trim()) {
      setAiError({
        message: isFa ? 'لطفاً ابتدا شرح ادعای خواهان را وارد فرمایید.' : "Please provide plaintiff's claim first.",
      });
      setCurrentStep(1);
      return;
    }

    const cid =
      activeCaseId ||
      `dadgar_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    setActiveCaseId(cid);
    setShowShareModal(true);

    // Save in background to server
    try {
      fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cid, partyA, partyB, lang }),
      }).catch(() => {});
    } catch (_) {}
  };

  const handleReset = () => {
    setCurrentVerdict(null);
    setAiError(null);
    setActiveCaseId(null);
    setIsPartyBInvite(false);
    setCurrentStep(1);
    setPartyA({ name: t.defaultPartyAName, claimText: '', evidenceNotes: '' });
    setPartyB({ name: t.defaultPartyBName, claimText: '', evidenceNotes: '' });
    if (typeof window !== 'undefined') {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('caseId');
      cleanUrl.searchParams.delete('mode');
      window.history.replaceState({}, document.title, cleanUrl.pathname);
    }
  };

  const handleLoadSample = (sample: typeof SAMPLE_CASES[0]) => {
    setPartyA({
      name: isFa ? sample.partyANameFa : sample.partyANameEn,
      claimText: isFa ? sample.partyAClaimFa : sample.partyAClaimEn,
      evidenceNotes: '',
    });
    setPartyB({
      name: isFa ? sample.partyBNameFa : sample.partyBNameEn,
      claimText: isFa ? sample.partyBClaimFa : sample.partyBClaimEn,
      evidenceNotes: '',
    });
    setShowSamplesModal(false);
    setCurrentStep(1);
  };

  const handleClearHistory = () => {
    localStorage.removeItem('dadgar_verdicts_history');
    setSavedCases([]);
  };

  return (
    <div className="min-h-screen bg-white text-[#111111] flex flex-col font-sans selection:bg-[#FFC400]/40 selection:text-[#111111]">
      {/* Clean 3-Zone Top Header */}
      <header className="border-b-2 border-[#111111] bg-white sticky top-0 z-40">
        <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Brand Wordmark + Geometric Square-Block Logo */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleReset();
            }}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 group"
          >
            <BrandLogo className="w-7 h-9 shrink-0 transition-transform duration-150 group-hover:scale-105" />
            <span className="font-black text-base sm:text-lg text-[#111111] tracking-tight">
              {t.appTitle}
            </span>
          </a>

          {/* Zone 2: Clean Single-Line Text Navigation */}
          <nav className="flex items-center gap-4 sm:gap-6 text-xs sm:text-sm font-semibold text-neutral-600 overflow-x-auto">
            <button
              type="button"
              onClick={() => setShowSamplesModal(true)}
              className="hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isFa ? 'نمونه‌ها' : 'Samples'}
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isFa ? 'آرشیو احکام' : 'Archive'}
            </button>
            <button
              type="button"
              onClick={() => setShowMethodologyModal(true)}
              className="hidden sm:inline-block hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isFa ? 'اصول منطق' : 'Methodology'}
            </button>
            <button
              type="button"
              onClick={() => setShowPrivacyModal(true)}
              className="hidden md:inline-block hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 underline-offset-4 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {isFa ? 'حریم خصوصی' : 'Privacy'}
            </button>
          </nav>

          {/* Zone 3: Primary Header Control */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setLang(lang === 'fa' ? 'en' : 'fa')}
              className="min-h-[38px] px-3 py-1.5 bg-[#111111] hover:bg-[#FFC400] text-[#FFC400] hover:text-[#111111] border border-[#111111] rounded-[3px] text-xs font-black transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Languages className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'EN' : 'فا'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-7 space-y-6">
        {/* Notice Banner */}
        {paymentNotice && (
          <div
            className={`p-4 rounded-[3px] border-2 flex items-center justify-between text-xs animate-fade-in ${
              paymentNotice.type === 'success'
                ? 'bg-emerald-50 border-emerald-700 text-emerald-950'
                : 'bg-[#FFFDF2] border-[#111111] text-[#111111]'
            }`}
          >
            <div className="flex items-center gap-2.5 font-medium">
              {paymentNotice.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-[#111111] shrink-0" />
              )}
              <span>{paymentNotice.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setPaymentNotice(null)}
              className="p-1 text-neutral-600 hover:text-[#111111]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* AI Deliberation Error Banner */}
        {aiError && (
          <div className="p-4 rounded-[3px] bg-rose-50 border-2 border-rose-700 text-rose-950 text-xs space-y-2.5 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-black text-sm block">{t.aiErrorTitle}</span>
                <p className="text-rose-900 leading-relaxed">{aiError.message}</p>
                <p className="text-xs text-rose-800/80">{t.aiErrorNotice}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleStartDeliberation}
              className="px-4 py-2 bg-[#111111] hover:bg-neutral-800 text-[#FFC400] font-bold rounded-[3px] text-xs transition-colors cursor-pointer"
            >
              {t.aiErrorTryAgain}
            </button>
          </div>
        )}

        {/* View Mode: Input Steps or Verdict View */}
        {currentVerdict ? (
          <VerdictView
            lang={lang}
            partyA={partyA}
            partyB={partyB}
            verdict={currentVerdict}
            onNewCase={handleReset}
            onOpenPrivacy={() => setShowPrivacyModal(true)}
          />
        ) : (
          <div className="space-y-6">
            {/* Editorial Courtroom Masthead */}
            <section className="border-b border-neutral-200 pb-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="text-xs font-bold text-neutral-500">
                  <span>{t.courtName}</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-[#111111] leading-snug">
                  {t.appSubtitle}
                </h1>
              </div>
            </section>

            {/* Two-Party Case Invitation Notice if opened via shared link */}
            {isPartyBInvite && (
              <div className="bg-[#FFFDF2] border-2 border-[#111111] rounded-[4px] p-5 space-y-3 animate-fade-in">
                <div className="flex items-center gap-2 text-[#111111] font-black text-sm">
                  <Scale className="w-5 h-5" />
                  <span>{isFa ? 'پرونده داوری مشارکتی · دعوت به ثبت دفاعیه' : 'Tribunal Case Invitation'}</span>
                </div>
                <div className="bg-white border border-neutral-300 rounded-[3px] p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500">{isFa ? 'طرف طرح‌کننده دعوا (خواهان):' : 'Plaintiff:'}</span>
                    <span className="font-bold text-[#111111]">{partyA.name}</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#111111] leading-relaxed pt-1.5 border-t border-neutral-200">
                    «{partyA.claimText}»
                  </p>
                </div>
                <p className="text-xs text-neutral-700 leading-relaxed">
                  {isFa
                    ? 'شما به عنوان طرف دوم دعوا به این پرونده دعوت شده‌اید. لطفاً در کادر زیر پاسخ و دفاعیه خود را بنویسید یا ویس ضبط فرمایید، سپس دکمه صدور رأی را بزنید.'
                    : 'You have been invited as the opposing party. Please write or record your defense below and click Deliberate to receive the verdict.'}
                </p>
              </div>
            )}

            {/* Rectangular 2-Step Tabs */}
            <div className="grid grid-cols-2 gap-3 text-center text-xs sm:text-sm">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className={`min-h-[46px] px-4 py-3 rounded-[3px] transition-colors cursor-pointer whitespace-nowrap truncate ${
                  currentStep === 1
                    ? 'bg-[#FFC400] border-2 border-[#111111] text-[#111111] font-black'
                    : 'bg-[#FAFAFA] hover:bg-neutral-100 border border-neutral-300 text-neutral-600 font-semibold'
                }`}
              >
                <span>۱. {t.step1Title}</span>
              </button>

              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className={`min-h-[46px] px-4 py-3 rounded-[3px] transition-colors cursor-pointer whitespace-nowrap truncate ${
                  currentStep === 2
                    ? 'bg-[#FFC400] border-2 border-[#111111] text-[#111111] font-black'
                    : 'bg-[#FAFAFA] hover:bg-neutral-100 border border-neutral-300 text-neutral-600 font-semibold'
                }`}
              >
                <span>۲. {t.step2Title}</span>
              </button>
            </div>

            {/* Current Step Input */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <ClaimInput
                  lang={lang}
                  party={partyA}
                  partyKey="partyA"
                  label={t.step1Title}
                  onChange={setPartyA}
                  accentColor="amber"
                />

                {/* Invite Option */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#FAFAFA] border border-neutral-300 rounded-[3px] text-xs text-neutral-700">
                  <span className="flex items-center gap-2 font-medium">
                    <Users className="w-4 h-4 text-[#111111]" />
                    <span>{isFa ? 'تمایل دارید طرف دوم خودش دفاعیه را ثبت کند؟' : 'Invite second party to respond directly?'}</span>
                  </span>
                  <button
                    type="button"
                    disabled={isSavingCase || (!partyA.claimText.trim() && !partyA.audioBase64)}
                    onClick={handleOpenShareCase}
                    className="text-[#111111] hover:bg-[#FFC400] px-2.5 py-1 rounded-[2px] border border-[#111111] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>{isFa ? 'ارسال لینک دعوت' : 'Send Invite'}</span>
                  </button>
                </div>
              </div>
            )}

            {currentStep === 2 && (
              <ClaimInput
                lang={lang}
                party={partyB}
                partyKey="partyB"
                label={t.step2Title}
                onChange={setPartyB}
                accentColor="sky"
              />
            )}

            {/* Step Navigation & Primary Action */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                {currentStep > 1 && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(1)}
                    className="min-h-[46px] px-4 py-2.5 bg-white hover:bg-neutral-100 border border-[#111111] text-[#111111] rounded-[3px] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {isFa ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
                    <span>{t.prevStep}</span>
                  </button>
                )}

                {currentStep === 1 && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep(2)}
                    className="min-h-[46px] px-4 py-2.5 bg-[#111111] hover:bg-neutral-800 text-white rounded-[3px] text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span>{t.nextStep}</span>
                    {isFa ? <ArrowLeft className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Start Deliberation Button */}
              <button
                type="button"
                disabled={isDeliberating || (!partyA.claimText.trim() && !partyA.audioBase64)}
                onClick={handleStartDeliberation}
                className="min-h-[48px] px-6 py-3 bg-[#FFC400] hover:bg-[#FFD000] text-[#111111] border-2 border-[#111111] font-black rounded-[3px] text-sm flex items-center gap-2.5 shadow-[4px_4px_0px_#111111] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[2px_2px_0px_#111111] transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeliberating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-[#111111]" />
                    <span>{t.deliberatingNotice}</span>
                  </>
                ) : (
                  <>
                    <Gavel className="w-5 h-5 text-[#111111]" />
                    <span>{t.deliberateButton}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 bg-[#FAFAFA] py-5 text-xs text-neutral-600">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <BrandLogo className="w-4 h-5 shrink-0" />
            <span>
              {t.courtName} · {isFa ? 'داوری هوشمند بر پایه عقل و واقعیات' : 'AI Rational Arbiter'}
            </span>
          </div>
          <div className="flex items-center gap-5 font-semibold">
            <button
              type="button"
              onClick={() => setShowMethodologyModal(true)}
              className="hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 cursor-pointer"
            >
              {t.methodologyTitle}
            </button>
            <button
              type="button"
              onClick={() => setShowPrivacyModal(true)}
              className="hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 cursor-pointer"
            >
              {t.privacyPolicyTitle}
            </button>
            <button
              type="button"
              onClick={() => setShowSupportModal(true)}
              className="hover:text-[#111111] hover:underline decoration-[#FFC400] decoration-2 cursor-pointer"
            >
              {t.supportTitle}
            </button>
          </div>
        </div>
      </footer>

      {/* Sample Cases Modal */}
      {showSamplesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-[8px_8px_0px_#111111]">
            <div className="flex items-center justify-between border-b-2 border-[#111111] pb-3">
              <h3 className="font-black text-base text-[#111111]">{t.sampleCasesTitle}</h3>
              <button
                type="button"
                onClick={() => setShowSamplesModal(false)}
                className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {SAMPLE_CASES.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleLoadSample(s)}
                  className="p-4 rounded-[3px] bg-[#FAFAFA] border border-neutral-300 hover:border-[#111111] hover:bg-[#FFFDF2] cursor-pointer transition-colors space-y-1.5"
                >
                  <span className="text-[11px] font-bold text-neutral-600 block">
                    {isFa ? s.categoryFa : s.categoryEn}
                  </span>
                  <h4 className="font-bold text-sm text-[#111111]">
                    {isFa ? s.titleFa : s.titleEn}
                  </h4>
                  <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
                    {isFa ? s.partyAClaimFa : s.partyAClaimEn}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-[8px_8px_0px_#111111]">
            <div className="flex items-center justify-between border-b-2 border-[#111111] pb-3">
              <h3 className="font-black text-base text-[#111111]">{t.historyTitle}</h3>
              <div className="flex items-center gap-2">
                {savedCases.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="p-1.5 text-rose-700 hover:bg-rose-50 rounded-[3px] text-xs font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.clearHistory}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowHistoryModal(false)}
                  className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {savedCases.length === 0 ? (
              <p className="text-xs text-neutral-500 py-6 text-center">{t.noHistory}</p>
            ) : (
              <div className="space-y-3">
                {savedCases.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setPartyA(c.partyA);
                      setPartyB(c.partyB);
                      setCurrentVerdict(c.verdict);
                      setCurrentStep(4);
                      setShowHistoryModal(false);
                    }}
                    className="p-4 rounded-[3px] bg-[#FAFAFA] border border-neutral-300 hover:border-[#111111] hover:bg-[#FFFDF2] cursor-pointer transition-colors space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                      <span className="font-bold text-[#111111] bg-[#FFC400] px-1.5 py-0.5 rounded-[2px]">
                        {c.id}
                      </span>
                      <span className="text-neutral-500">
                        {new Date(c.date).toLocaleDateString(isFa ? 'fa-IR' : 'en-US')}
                      </span>
                    </div>
                    <h4 className="font-bold text-sm text-[#111111] pt-1">{c.verdict.verdictTitle}</h4>
                    <p className="text-xs text-neutral-600 line-clamp-1 tabular-nums">
                      {c.partyA.name} ({c.verdict.partyAScore}%) · {c.partyB.name} ({c.verdict.partyBScore}%)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Methodology Modal */}
      {showMethodologyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-[8px_8px_0px_#111111]">
            <div className="flex items-center justify-between border-b-2 border-[#111111] pb-3">
              <h3 className="font-black text-base text-[#111111]">{t.methodologyTitle}</h3>
              <button
                type="button"
                onClick={() => setShowMethodologyModal(false)}
                className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {METHODOLOGY_PRINCIPLES.map((m, idx) => (
                <div key={idx} className="p-4 rounded-[3px] bg-[#FAFAFA] border border-neutral-300 space-y-1">
                  <h4 className="font-extrabold text-xs text-[#111111]">
                    {isFa ? m.titleFa : m.titleEn}
                  </h4>
                  <p className="text-xs text-neutral-700 leading-relaxed">
                    {isFa ? m.descFa : m.descEn}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Privacy Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-[8px_8px_0px_#111111]">
            <div className="flex items-center justify-between border-b-2 border-[#111111] pb-3">
              <h3 className="font-black text-base text-[#111111]">{t.privacyPolicyTitle}</h3>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              {PRIVACY_POLICY_SECTIONS.map((p, idx) => (
                <div key={idx} className="p-4 rounded-[3px] bg-[#FAFAFA] border border-neutral-300 space-y-1">
                  <h4 className="font-extrabold text-xs text-[#111111]">
                    {isFa ? p.titleFa : p.titleEn}
                  </h4>
                  <p className="text-xs text-neutral-700 leading-relaxed">
                    {isFa ? p.contentFa : p.contentEn}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Support Modal */}
      {showSupportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-md w-full p-6 space-y-4 shadow-[8px_8px_0px_#111111]">
            <div className="flex items-center justify-between border-b-2 border-[#111111] pb-3">
              <h3 className="font-black text-base text-[#111111]">{t.supportTitle}</h3>
              <button
                type="button"
                onClick={() => setShowSupportModal(false)}
                className="p-1 text-neutral-500 hover:text-[#111111] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-neutral-700 leading-relaxed">
              <p>
                {isFa
                  ? 'تمامی امکانات آقای قاضی به صورت رایگان ارائه می‌شود. جهت هرگونه پرسش، پیشنهاد یا گزارش خطا، می‌توانید با ایمیل پشتیبانی تماس بگیرید:'
                  : 'All features of Mr. Judger are completely free. For any questions, feedback, or inquiries, contact support directly at:'}
              </p>
              <a
                href="mailto:sobhanganji@gmail.com"
                className="p-3 rounded-[3px] bg-[#FFC400] hover:bg-[#FFD000] border border-[#111111] font-mono text-[#111111] font-bold text-center block transition-colors"
                title="Send email"
              >
                sobhanganji@gmail.com
              </a>
              <div className="pt-2 border-t border-neutral-200 flex items-center justify-between">
                <span>{t.supportProjectNotice}</span>
                <a
                  href="https://paypal.me/ganjisobhan"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#111111] hover:underline font-bold inline-flex items-center gap-1"
                >
                  <span>PayPal.me</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Case Modal for Two-Party Collaborative Dispute */}
      {showShareModal && activeCaseId && (
        <ShareCaseModal
          lang={lang}
          caseId={activeCaseId}
          partyA={partyA}
          partyB={partyB}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
};

export default App;
