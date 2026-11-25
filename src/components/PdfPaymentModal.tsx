import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Lock,
  X,
  AlertCircle,
  ExternalLink,
  Loader2,
  Scale,
  CheckCircle2,
  CreditCard,
  Building2,
  Smartphone,
  Check,
  RefreshCw,
  Copy,
} from 'lucide-react';
import { Language } from '../types.ts';
import { getTranslation } from '../translations.ts';
import { formatNum } from '../utils/numberHelper.ts';
import { copyTextToClipboard } from '../utils/shareLinkHelper.ts';
import {
  PDF_PRICE_USD,
  PDF_PRICE_TOMAN_FORMATTED,
  PAYPAL_ME_URL,
  PAYPAL_ME_BASE,
  VARIZA_PAY_URL,
  openExternalUrl,
} from '../config.ts';

interface PdfPaymentModalProps {
  lang: Language;
  decreeCode: string;
  onClose: () => void;
  onOpenPrivacy?: () => void;
  onPaymentSuccess?: () => void;
}

export const PdfPaymentModal: React.FC<PdfPaymentModalProps> = ({
  lang,
  decreeCode,
  onClose,
  onOpenPrivacy,
  onPaymentSuccess,
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  const [paymentMethod, setPaymentMethod] = useState<'zibal' | 'variza' | 'stripe' | 'paypal'>(
    isFa ? 'zibal' : 'stripe'
  );

  // Zibal state
  const [zibalMobile, setZibalMobile] = useState('');
  const [zibalTrackId, setZibalTrackId] = useState<string | null>(null);
  const [zibalCheckoutUrl, setZibalCheckoutUrl] = useState<string | null>(null);
  const [isCreatingZibal, setIsCreatingZibal] = useState(false);
  const [isCheckingZibal, setIsCheckingZibal] = useState(false);

  // Variza state
  const [varizaTracking, setVarizaTracking] = useState('');
  const [isVerifyingVariza, setIsVerifyingVariza] = useState(false);

  // Stripe state
  const [stripeSessionId, setStripeSessionId] = useState<string | null>(null);
  const [stripeCheckoutUrl, setStripeCheckoutUrl] = useState<string | null>(null);
  const [isCreatingStripe, setIsCreatingStripe] = useState(false);
  const [isCheckingStripe, setIsCheckingStripe] = useState(false);

  // PayPal state
  const [isVerifyingPaypal, setIsVerifyingPaypal] = useState(false);

  // Link copy feedback states
  const [copiedZibal, setCopiedZibal] = useState(false);
  const [copiedVariza, setCopiedVariza] = useState(false);
  const [copiedPaypal, setCopiedPaypal] = useState(false);
  const [copiedStripe, setCopiedStripe] = useState(false);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollTimerRef = useRef<any>(null);

  const saveZibalTrackLocally = (trackId: string) => {
    try {
      const stored = localStorage.getItem('dadgar_zibal_tracks');
      const map = stored ? JSON.parse(stored) : {};
      map[decreeCode] = trackId;
      localStorage.setItem('dadgar_zibal_tracks', JSON.stringify(map));
    } catch (_) {}
  };

  const handleCopyZibalLink = async () => {
    if (!zibalCheckoutUrl) return;
    const ok = await copyTextToClipboard(zibalCheckoutUrl);
    if (ok) {
      setCopiedZibal(true);
      setTimeout(() => setCopiedZibal(false), 2500);
    }
  };

  const handleCopyVarizaLink = async () => {
    const ok = await copyTextToClipboard(VARIZA_PAY_URL);
    if (ok) {
      setCopiedVariza(true);
      setTimeout(() => setCopiedVariza(false), 2500);
    }
  };

  const handleCopyPaypalLink = async () => {
    const ok = await copyTextToClipboard(PAYPAL_ME_URL);
    if (ok) {
      setCopiedPaypal(true);
      setTimeout(() => setCopiedPaypal(false), 2500);
    }
  };

  const handleCopyStripeLink = async () => {
    if (!stripeCheckoutUrl) return;
    const ok = await copyTextToClipboard(stripeCheckoutUrl);
    if (ok) {
      setCopiedStripe(true);
      setTimeout(() => setCopiedStripe(false), 2500);
    }
  };

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const markDecreePaidLocally = () => {
    try {
      const stored = localStorage.getItem('dadgar_paid_decrees');
      const list = stored ? JSON.parse(stored) : [];
      if (Array.isArray(list)) {
        if (!list.includes(decreeCode)) list.push(decreeCode);
        localStorage.setItem('dadgar_paid_decrees', JSON.stringify(list));
      } else {
        localStorage.setItem('dadgar_paid_decrees', JSON.stringify([decreeCode]));
      }
    } catch (_) {}
    onPaymentSuccess?.();
    onClose();
  };

  // --- ZIBAL FLOW ---
  const handleStartZibalCheckout = async () => {
    setIsCreatingZibal(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/payments/zibal/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decreeCode,
          mobile: zibalMobile.trim() || undefined,
          lang,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.url || !data?.trackId) {
        setErrorMessage(
          data?.error?.message ||
            (isFa
              ? 'اتصال به درگاه زیبال برقرار نشد. لطفاً کد مرچنت ZIBAL_MERCHANT را بررسی فرمایید.'
              : 'Could not initialize Zibal payment gateway.')
        );
        setIsCreatingZibal(false);
        return;
      }

      const track = String(data.trackId);
      setZibalTrackId(track);
      setZibalCheckoutUrl(data.url);
      saveZibalTrackLocally(track);
      openExternalUrl(data.url);
      setIsCreatingZibal(false);

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const checkRes = await fetch(
            `/api/payments/status?zibal_track_id=${encodeURIComponent(track)}&decree=${encodeURIComponent(decreeCode)}`
          );
          const checkData = await checkRes.json().catch(() => null);
          if (checkData?.paid) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            markDecreePaidLocally();
          }
        } catch (_) {}
      }, 3000);
    } catch (err: any) {
      console.error('Failed to initiate Zibal checkout:', err);
      setErrorMessage(
        isFa
          ? 'خطا در برقراری ارتباط با سرور برای اتصال به درگاه زیبال.'
          : 'Failed to reach server for Zibal checkout.'
      );
      setIsCreatingZibal(false);
    }
  };

  const handleManualCheckZibalStatus = async () => {
    if (!zibalTrackId) {
      handleStartZibalCheckout();
      return;
    }

    setIsCheckingZibal(true);
    setErrorMessage(null);

    try {
      const checkRes = await fetch(
        `/api/payments/status?zibal_track_id=${encodeURIComponent(zibalTrackId)}&decree=${encodeURIComponent(decreeCode)}`
      );
      const checkData = await checkRes.json().catch(() => null);

      if (checkData?.paid) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        markDecreePaidLocally();
      } else {
        setErrorMessage(
          isFa
            ? 'تراکنش زیبال هنوز تأیید نهایی نشده است. پس از تکمیل پرداخت بانکی، چند ثانیه صبر کرده و دوباره بررسی را بزنید.'
            : 'Zibal transaction is not yet verified. Please complete bank payment and retry check.'
        );
      }
    } catch (_) {
      setErrorMessage(
        isFa ? 'خطا در استعلام وضعیت تراکنش زیبال.' : 'Error checking Zibal payment status.'
      );
    } finally {
      setIsCheckingZibal(false);
    }
  };

  // --- VARIZA FLOW ---
  const handleOpenVariza = () => {
    setErrorMessage(null);
    openExternalUrl(VARIZA_PAY_URL);
  };

  const handleConfirmVarizaPayment = async () => {
    setIsVerifyingVariza(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/payments/variza/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decreeCode,
          trackingCode: varizaTracking.trim(),
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setErrorMessage(
          isFa
            ? 'خطا در ثبت تأییدیه پرداخت. لطفاً مجدداً امتحان فرمایید.'
            : 'Payment confirmation failed. Please retry.'
        );
        setIsVerifyingVariza(false);
        return;
      }

      setIsVerifyingVariza(false);
      markDecreePaidLocally();
    } catch (err: any) {
      console.error('Variza confirm error:', err);
      setIsVerifyingVariza(false);
      markDecreePaidLocally();
    }
  };

  // --- STRIPE FLOW ---
  const handleStartStripeCheckout = async () => {
    setIsCreatingStripe(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decreeCode,
          lang,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.url) {
        const errorText =
          data?.error?.message ||
          (isFa ? t.stripeUnavailable : 'Payment initialization failed. Please try again.');
        setErrorMessage(errorText);
        setIsCreatingStripe(false);
        return;
      }

      setStripeSessionId(data.id);
      setStripeCheckoutUrl(data.url);
      openExternalUrl(data.url);
      setIsCreatingStripe(false);

      // Start background poll to detect when user finishes payment on Stripe
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const checkRes = await fetch(`/api/payments/status?session_id=${encodeURIComponent(data.id)}&decree=${encodeURIComponent(decreeCode)}`);
          const checkData = await checkRes.json().catch(() => null);
          if (checkData?.paid) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            markDecreePaidLocally();
          }
        } catch (_) {}
      }, 3000);
    } catch (err: any) {
      console.error('Failed to initiate Stripe checkout:', err);
      setErrorMessage(
        isFa
          ? 'ارتباط با سرور پرداخت Stripe برقرار نشد. لطفاً اتصال اینترنت خود را بررسی و مجدداً تلاش فرمایید.'
          : 'Could not connect to Stripe payment gateway. Please check your connection and try again.'
      );
      setIsCreatingStripe(false);
    }
  };

  const handleManualCheckStripeStatus = async () => {
    if (!stripeSessionId) {
      handleStartStripeCheckout();
      return;
    }

    setIsCheckingStripe(true);
    setErrorMessage(null);

    try {
      const checkRes = await fetch(`/api/payments/status?session_id=${encodeURIComponent(stripeSessionId)}&decree=${encodeURIComponent(decreeCode)}`);
      const checkData = await checkRes.json().catch(() => null);

      if (checkData?.paid) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        markDecreePaidLocally();
      } else {
        setErrorMessage(
          isFa
            ? 'تراکنش هنوز توسط استرایپ نهایی نشده است. اگر پرداخت را در صفحه Stripe تکمیل کرده‌اید، لطفاً چند ثانیه دیگر دکمه بررسی را بزنید.'
            : 'Payment is not yet marked completed by Stripe. If you completed checkout, please retry check in a few moments.'
        );
      }
    } catch (err: any) {
      console.warn('Status check error:', err);
      setErrorMessage(
        isFa
          ? 'خطا در بررسی وضعیت پرداخت. لطفاً دوباره تلاش نمایید.'
          : 'Error checking payment status.'
      );
    } finally {
      setIsCheckingStripe(false);
    }
  };

  // --- PAYPAL FLOW ---
  const handleOpenPayPal = () => {
    setErrorMessage(null);
    openExternalUrl(PAYPAL_ME_URL);
  };

  const handleConfirmPayPalPayment = async () => {
    setIsVerifyingPaypal(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/payments/paypal/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decreeCode }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        setErrorMessage(
          isFa
            ? 'خطا در ثبت تأییدیه پی‌پال. لطفاً مجدداً امتحان فرمایید.'
            : 'PayPal confirmation failed. Please retry.'
        );
        setIsVerifyingPaypal(false);
        return;
      }

      setIsVerifyingPaypal(false);
      markDecreePaidLocally();
    } catch (err: any) {
      console.error('PayPal confirm error:', err);
      setIsVerifyingPaypal(false);
      markDecreePaidLocally();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-md animate-fade-in overflow-y-auto"
    >
      <div className="bg-slate-900 border border-amber-500/30 rounded-3xl max-w-lg w-full shadow-2xl relative overflow-hidden my-auto text-slate-100 flex flex-col max-h-[92vh]">
        {/* Modal Top Bar */}
        <div className="px-5 py-4 bg-slate-950 text-white flex items-center justify-between border-b border-amber-500/20 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
              <Lock className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 id="payment-modal-title" className="font-black text-sm sm:text-base text-white leading-tight">
                {isFa ? 'صدور سند رسمی تک‌برگی دیوان دادگر' : 'Official 1-Page Decree Issuance'}
              </h3>
              <p className="text-[10.5px] font-mono text-amber-400">
                {t.verdictCode} {formatNum(decreeCode, lang)} • {paymentMethod === 'zibal' || paymentMethod === 'variza' ? PDF_PRICE_TOMAN_FORMATTED : `$${PDF_PRICE_USD.toFixed(2)} USD`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isFa ? 'بستن پنجره' : 'Close modal'}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Overview Banner */}
          <div className="bg-amber-950/40 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-4 text-slate-200">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-serif font-black text-xs shrink-0 shadow-inner">
              DADGAR
            </div>
            <div className="space-y-1">
              <span className="font-extrabold text-amber-300 block text-xs sm:text-sm">
                {isFa
                  ? 'داوری کاملاً رایگان • سند رسمی ممهور: ۵۰,۰۰۰ تومان (۱ دلار)'
                  : 'Deliberation 100% Free • Certified PDF: $1.00 USD'}
              </span>
              <p className="text-slate-300 text-[11px] leading-relaxed">
                {isFa
                  ? 'بررسی دعوا و مشاهده آنلاین رأی کاملاً رایگان است. تعرفه ۱ دلار (۵۰ هزار تومان) جهت دانلود نسخه تک‌برگی رسمی A4 با مهر زرین، کد رهگیری ضدجعل و زمان‌بندی دقیق ثبتی است.'
                  : 'Deliberation and reading online are free. The $1.00 fee unlocks the certified single-page A4 PDF decree with the golden wax seal and registry timestamp.'}
              </p>
            </div>
          </div>

          {/* Payment Method Selector Tabs (4 options: Zibal Shetab, Variza, Stripe USD, PayPal USD) */}
          <div className="space-y-2">
            <span className="text-[11px] font-bold text-slate-300 block">
              {isFa ? 'انتخاب روش پرداخت (ریالی یا دلاری):' : 'Select Payment Method:'}
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-950 border border-slate-800 rounded-2xl">
              {/* Option 1: Zibal Direct Shetab IPG */}
              <button
                type="button"
                onClick={() => { setPaymentMethod('zibal'); setErrorMessage(null); }}
                className={`py-2 px-2 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  paymentMethod === 'zibal'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  <span>{isFa ? 'درگاه زیبال' : 'Zibal'}</span>
                </div>
                <span className={`text-[10px] font-mono ${paymentMethod === 'zibal' ? 'text-slate-900 font-black' : 'text-amber-400'}`}>
                  {PDF_PRICE_TOMAN_FORMATTED}
                </span>
              </button>

              {/* Option 2: Variza Pay Link */}
              <button
                type="button"
                onClick={() => { setPaymentMethod('variza'); setErrorMessage(null); }}
                className={`py-2 px-2 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  paymentMethod === 'variza'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-1">
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>{isFa ? 'واریزا' : 'Variza'}</span>
                </div>
                <span className={`text-[10px] font-mono ${paymentMethod === 'variza' ? 'text-slate-900 font-black' : 'text-amber-400'}`}>
                  {PDF_PRICE_TOMAN_FORMATTED}
                </span>
              </button>

              {/* Option 3: International Cards (Stripe) */}
              <button
                type="button"
                onClick={() => { setPaymentMethod('stripe'); setErrorMessage(null); }}
                className={`py-2 px-2 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  paymentMethod === 'stripe'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>{isFa ? 'Stripe' : 'Stripe'}</span>
                </div>
                <span className={`text-[10px] font-mono ${paymentMethod === 'stripe' ? 'text-slate-900 font-black' : 'text-amber-400'}`}>
                  $1.00 USD
                </span>
              </button>

              {/* Option 4: PayPal ($1.00 USD) */}
              <button
                type="button"
                onClick={() => { setPaymentMethod('paypal'); setErrorMessage(null); }}
                className={`py-2 px-2 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  paymentMethod === 'paypal'
                    ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className="font-serif font-black text-xs">P</span>
                  <span>{isFa ? 'پی‌پال' : 'PayPal'}</span>
                </div>
                <span className={`text-[10px] font-mono ${paymentMethod === 'paypal' ? 'text-slate-900 font-black' : 'text-amber-400'}`}>
                  $1.00 USD
                </span>
              </button>
            </div>
          </div>

          {/* Pricing Summary */}
          <div className="bg-slate-800/80 border border-slate-700/80 rounded-2xl p-4 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-slate-200 block">
                {isFa ? 'مبلغ نهایی تعرفه:' : 'Amount Due:'}
              </span>
              <span className="text-[11px] text-slate-400">
                {paymentMethod === 'zibal' || paymentMethod === 'variza'
                  ? (isFa ? 'کلیه کارت‌های شتاب بانکی کشور (۵۰,۰۰۰ تومان)' : 'Iranian Shetab Cards (50,000 Tomans)')
                  : (isFa ? 'پرداخت مستقیم دلاری ۱.۰۰ دلار به حساب بین‌المللی' : 'Direct $1.00 USD payment to international account')}
              </span>
            </div>
            <div className="bg-amber-500/20 border border-amber-500/40 text-amber-300 font-black px-4 py-1.5 rounded-xl text-base shadow-sm font-mono">
              {paymentMethod === 'zibal' || paymentMethod === 'variza' ? PDF_PRICE_TOMAN_FORMATTED : `$${PDF_PRICE_USD.toFixed(2)} USD`}
            </div>
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div className="bg-rose-950/60 border border-rose-500/50 rounded-2xl p-3.5 text-xs text-rose-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold block">{isFa ? 'پیام درگاه:' : 'Notice:'}</span>
                <p className="text-[11px] leading-relaxed text-rose-300">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* TAB 0: ZIBAL DIRECT SHETAB IPG (50,000 TOMANS) */}
          {paymentMethod === 'zibal' && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isFa ? 'شماره موبایل (اختیاری - جهت ارسال رسید بانکی):' : 'Mobile Number (Optional):'}</span>
                </label>
                <input
                  type="tel"
                  dir="ltr"
                  placeholder="09123456789"
                  value={zibalMobile}
                  onChange={(e) => setZibalMobile(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                />
              </div>

              <button
                type="button"
                disabled={isCreatingZibal}
                onClick={handleStartZibalCheckout}
                className="w-full min-h-[50px] py-3.5 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2.5 active:scale-98 cursor-pointer disabled:opacity-60"
              >
                {isCreatingZibal ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                    <span>{isFa ? 'در حال اتصال به درگاه رسمی زیبال...' : 'Connecting to Zibal...'}</span>
                  </>
                ) : (
                  <>
                    <Building2 className="w-4 h-4 text-slate-950" />
                    <span>{isFa ? 'پرداخت آنلاین با درگاه زیبال (۵۰,۰۰۰ تومان)' : 'Pay Online via Zibal (50,000 Tomans)'}</span>
                    <ExternalLink className="w-4 h-4 text-slate-950" />
                  </>
                )}
              </button>

              <div className="flex items-center justify-center gap-2 text-[10.5px] text-slate-400 font-medium flex-wrap">
                <span>بانک ملی</span>
                <span>•</span>
                <span>بانک ملت</span>
                <span>•</span>
                <span>بانک صادرات</span>
                <span>•</span>
                <span>بانک سامان</span>
                <span>•</span>
                <span>بانک پاسارگاد</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">تایید آنی با درگاه شاپرک زیبال</span>
              </div>

              {zibalTrackId && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3 animate-fade-in">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isFa ? `درگاه زیبال باز شد (کد رهگیری: ${zibalTrackId})` : `Zibal Checkout Active (Track: ${zibalTrackId})`}</span>
                    </span>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {isFa
                        ? 'پس از تکمیل پرداخت در صفحه شاپرک زیبال، وضعیت به‌صورت خودکار هر ۳ ثانیه بررسی و سند ممهور فعال می‌شود:'
                        : 'System polls automatically every 3 seconds once you complete Zibal checkout:'}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      disabled={isCheckingZibal}
                      onClick={handleManualCheckZibalStatus}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                    >
                      {isCheckingZibal ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-white" />
                      )}
                      <span>{isFa ? 'بررسی و فعال‌سازی فوری سند' : 'Verify Zibal & Unlock'}</span>
                    </button>

                    {zibalCheckoutUrl && (
                      <div className="flex items-center gap-2">
                        <a
                          href={zibalCheckoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>{isFa ? 'باز کردن مجدد' : 'Reopen'}</span>
                        </a>
                        <button
                          type="button"
                          onClick={handleCopyZibalLink}
                          className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer border border-amber-500/20"
                        >
                          {copiedZibal ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedZibal ? (isFa ? 'کپی شد' : 'Copied') : (isFa ? 'کپی لینک' : 'Copy')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: VARIZA (SHETAB 50,000 TOMANS) */}
          {paymentMethod === 'variza' && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-amber-300 block">
                  {isFa ? 'مرحله ۱: ورود به درگاه پرداخت واریزا و واریز مبلغ' : 'Step 1: Open Variza Gateway'}
                </span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={VARIZA_PAY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-[50px] py-3.5 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2.5 active:scale-98 text-center"
                  >
                    <Building2 className="w-4 h-4 text-slate-950" />
                    <span>{isFa ? 'ورود به درگاه پرداخت واریزا (۵۰,۰۰۰ تومان)' : 'Pay via Variza (50,000 Tomans)'}</span>
                    <ExternalLink className="w-4 h-4 text-slate-950" />
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyVarizaLink}
                    className="py-3 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    title={isFa ? 'کپی آدرس لینک پرداخت' : 'Copy payment link'}
                  >
                    {copiedVariza ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedVariza ? (isFa ? 'کپی شد ✓' : 'Copied!') : (isFa ? 'کپی لینک' : 'Copy Link')}</span>
                  </button>
                </div>
              </div>

              {/* Supported Banks */}
              <div className="flex items-center justify-center gap-2 text-[10.5px] text-slate-400 font-medium flex-wrap">
                <span>بانک ملی</span>
                <span>•</span>
                <span>بانک ملت</span>
                <span>•</span>
                <span>بانک صادرات</span>
                <span>•</span>
                <span>بانک سامان</span>
                <span>•</span>
                <span>بانک پاسارگاد</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">کلیه کارت‌های شتاب</span>
              </div>

              {/* Step 2: Confirm */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-200 block">
                    {isFa ? 'مرحله ۲: تأیید و بازگشایی سند رسمی' : 'Step 2: Confirm & Unlock Decree'}
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {isFa
                      ? 'پس از پرداخت ۵۰,۰۰۰ تومان، روی دکمه زیر کلیک نمایید تا سند رسمی تک‌برگی بلافاصله بازگشایی شود:'
                      : 'After payment, click below to immediately unlock the decree:'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                    <span>شماره پیگیری یا ۴ رقم آخر کارت (اختیاری):</span>
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    placeholder="مثلاً: 123456"
                    value={varizaTracking}
                    onChange={(e) => setVarizaTracking(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500 font-mono"
                  />
                </div>

                <button
                  type="button"
                  disabled={isVerifyingVariza}
                  onClick={handleConfirmVarizaPayment}
                  className="w-full min-h-[46px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isVerifyingVariza ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>{isFa ? 'در حال ثبت و تأیید...' : 'Confirming...'}</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-white" />
                      <span>{isFa ? 'تأیید پرداخت و بازگشایی سند رسمی تک‌برگی ✓' : 'Confirm Payment & Unlock Certified Decree ✓'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: STRIPE ($1.00 USD - VISA / MASTERCARD / APPLE PAY) */}
          {paymentMethod === 'stripe' && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-amber-300 block">
                  {isFa ? 'پرداخت دلاری با درگاه رسمی Stripe (کارت اعتباری / Apple Pay / Google Pay):' : 'Pay $1.00 USD via Stripe:'}
                </span>

                <button
                  type="button"
                  disabled={isCreatingStripe}
                  onClick={handleStartStripeCheckout}
                  className="w-full min-h-[50px] py-3.5 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2.5 active:scale-98 cursor-pointer disabled:opacity-60"
                >
                  {isCreatingStripe ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin text-slate-950" />
                      <span>{t.openingStripe}</span>
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4 text-slate-950" />
                      <span>{isFa ? 'ورود به صفحه پرداخت امن Stripe ($1.00 USD)' : 'Proceed to Stripe Checkout ($1.00 USD)'}</span>
                      <ExternalLink className="w-4 h-4 text-slate-950" />
                    </>
                  )}
                </button>
              </div>

              {/* Supported payment instruments */}
              <div className="flex items-center justify-center gap-2 text-[10.5px] text-slate-400 font-medium flex-wrap">
                <span>Visa</span>
                <span>•</span>
                <span>Mastercard</span>
                <span>•</span>
                <span>American Express</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">Apple Pay</span>
                <span>•</span>
                <span className="text-amber-300 font-bold">Google Pay</span>
              </div>

              {/* Verification & Manual Status Checker */}
              {stripeSessionId && (
                <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3 animate-fade-in">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-emerald-400 block flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{isFa ? 'صفحه پرداخت Stripe فعال است' : 'Stripe Checkout Active'}</span>
                    </span>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {isFa
                        ? 'پس از پرداخت در تب استرایپ، سیستم به‌صورت خودکار هر ۳ ثانیه وضعیت را بررسی می‌کند. همچنین می‌توانید دکمه زیر را لمس فرمایید:'
                        : 'System is checking status automatically. You can also click below to verify immediately:'}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      disabled={isCheckingStripe}
                      onClick={handleManualCheckStripeStatus}
                      className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                    >
                      {isCheckingStripe ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <RefreshCw className="w-4 h-4 text-white" />
                      )}
                      <span>{isFa ? 'بررسی و فعال‌سازی فوری سند' : 'Check Status & Unlock'}</span>
                    </button>

                    {stripeCheckoutUrl && (
                      <div className="flex items-center gap-2">
                        <a
                          href={stripeCheckoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 text-center"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>{isFa ? 'باز کردن مجدد Stripe' : 'Reopen Stripe'}</span>
                        </a>
                        <button
                          type="button"
                          onClick={handleCopyStripeLink}
                          className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer border border-amber-500/20"
                          title={isFa ? 'کپی آدرس لینک Stripe' : 'Copy Stripe link'}
                        >
                          {copiedStripe ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedStripe ? (isFa ? 'کپی شد' : 'Copied') : (isFa ? 'کپی لینک' : 'Copy Link')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PAYPAL ($1.00 USD - PAYPAL.ME / BALANCE) */}
          {paymentMethod === 'paypal' && (
            <div className="space-y-3 pt-1">
              <div className="space-y-2">
                <span className="text-[11px] font-bold text-amber-300 block">
                  {isFa ? 'مرحله ۱: پرداخت ۱.۰۰ دلار از طریق لینک مستقیم پی‌پال (PayPal.me):' : 'Step 1: Send $1.00 USD via PayPal.me:'}
                </span>

                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={PAYPAL_ME_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-[50px] py-3.5 px-5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs sm:text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2.5 active:scale-98 text-center"
                  >
                    <span className="font-serif font-black text-sm">P</span>
                    <span>{isFa ? 'ورود به صفحه PayPal.me (مبلغ: $1.00 USD)' : 'Open PayPal.me ($1.00 USD)'}</span>
                    <ExternalLink className="w-4 h-4 text-slate-950" />
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyPaypalLink}
                    className="py-3 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    title={isFa ? 'کپی آدرس لینک پی‌پال' : 'Copy PayPal link'}
                  >
                    {copiedPaypal ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedPaypal ? (isFa ? 'کپی شد ✓' : 'Copied!') : (isFa ? 'کپی لینک' : 'Copy Link')}</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Confirm PayPal */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-200 block">
                    {isFa ? 'مرحله ۲: تأیید و بازگشایی فوری سند ممهور' : 'Step 2: Confirm & Unlock Decree'}
                  </span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {isFa
                      ? 'پس از واریز ۱ دلار در پی‌پال، روی دکمه زیر کلیک نمایید تا سند رسمی ممهور بلافاصله در سیستم تأیید و بازگشایی شود:'
                      : 'After sending $1.00 on PayPal, click below to immediately unlock the decree:'}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isVerifyingPaypal}
                  onClick={handleConfirmPayPalPayment}
                  className="w-full min-h-[46px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs sm:text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isVerifyingPaypal ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>{isFa ? 'در حال تایید و ثبت سند...' : 'Confirming PayPal...'}</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4 text-white" />
                      <span>{isFa ? 'تأیید پرداخت پی‌پال و بازگشایی سند رسمی تک‌برگی ✓' : 'Confirm PayPal & Unlock Certified Decree ✓'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Strict Privacy & Security Line */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-2xl p-3.5 text-center space-y-1.5">
            <p className="text-slate-300 text-[11px] leading-relaxed font-medium">
              {isFa
                ? 'کلیه تراکنش‌ها در بستر پروتکل رمزنگاری امن SSL پردازش شده و دیوان دادگر هیچ‌گونه دسترسی به اطلاعات بانکی شما ندارد.'
                : 'All transactions are encrypted with 256-bit SSL. Dadgar does not store or process card numbers directly.'}
            </p>
            {onOpenPrivacy && (
              <button
                type="button"
                onClick={onOpenPrivacy}
                className="text-amber-400 hover:text-amber-300 underline font-semibold text-[10.5px] cursor-pointer inline-flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t.privacyPolicyTitle}</span>
              </button>
            )}
          </div>

          {/* Legal Disclaimer */}
          <div className="text-[10px] text-slate-400 leading-relaxed text-center px-2">
            <Scale className="w-3 h-3 text-amber-500 inline me-1" />
            <span>{t.legalDisclaimerText}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
