import React, { useState } from 'react';
import {
  Share2,
  Copy,
  Check,
  X,
  MessageCircle,
  Send,
  Smartphone,
  ExternalLink,
  Shield,
  Users,
  FileText,
} from 'lucide-react';
import { Language, PartyClaim } from '../types.ts';
import { getTranslation } from '../translations.ts';
import { encodeCasePayload, copyTextToClipboard } from '../utils/shareLinkHelper.ts';

interface ShareCaseModalProps {
  lang: Language;
  caseId: string;
  partyA: PartyClaim;
  partyB: PartyClaim;
  onClose: () => void;
}

export const ShareCaseModal: React.FC<ShareCaseModalProps> = ({
  lang,
  caseId,
  partyA,
  partyB,
  onClose,
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

  // Encode the case state so that even on serverless, Cloudflare Pages, or offline, the link always works!
  const encodedPayload = encodeCasePayload({
    caseId,
    partyA,
    partyB,
    lang,
  });

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = `${origin}/?caseId=${encodeURIComponent(caseId)}&d=${encodedPayload}`;

  const partyAName = partyA.name.trim() || (isFa ? 'طرف اول (خواهان)' : 'Party A');
  const partyBName = partyB.name.trim() || (isFa ? 'طرف دوم (خوانده)' : 'Party B');

  const shareText = isFa
    ? `سلام ${partyBName}،\nمن اختلاف‌مان را در سامانه داوری هوشمند «آقای قاضی» ثبت کردم تا بر اساس عقل و واقعیات بی‌طرفانه بررسی شود.\nلطفاً از طریق لینک زیر ادعا و پاسخ خود را ثبت کنید تا رأی صادر شود:\n${shareUrl}`
    : `Hello ${partyBName},\nI have submitted our dispute to the "Mr. Judger" AI Arbitration Tribunal for an impartial rational verdict.\nPlease open the link below to submit your statement:\n${shareUrl}`;

  const handleCopyLink = async () => {
    const ok = await copyTextToClipboard(shareUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  const handleCopyFullText = async () => {
    const ok = await copyTextToClipboard(shareText);
    if (ok) {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 3000);
    }
  };

  const whatsAppUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(
    isFa
      ? `سلام ${partyBName}، لطفاً پاسخ خود به این دعوا را در سامانه آقای قاضی ثبت فرمایید.`
      : `Dispute statement submitted by ${partyAName}. Please submit your defense.`
  )}`;
  const smsUrl = `sms:?body=${encodeURIComponent(shareText)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-fade-in"
    >
      <div className="bg-white border-2 border-[#111111] rounded-[4px] max-w-lg w-full shadow-[8px_8px_0px_#111111] overflow-hidden text-[#111111] flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-4 bg-[#111111] text-white flex items-center justify-between border-b-2 border-[#FFC400] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[3px] bg-[#FFC400] flex items-center justify-center text-[#111111]">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-white">
                {isFa ? 'ارسال لینک پرونده به طرف دوم' : 'Share Case with Defendant'}
              </h3>
              <p className="text-[11px] font-mono text-[#FFC400]">
                {isFa ? 'پرونده مشارکتی دو طرفه' : 'Two-Party Collaborative Trial'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-neutral-300 hover:text-[#FFC400] rounded-[3px] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* Explanation Box */}
          <div className="bg-[#FFFDF2] border border-[#111111] rounded-[3px] p-4 space-y-1.5">
            <span className="font-bold text-[#111111] block text-xs">
              {isFa
                ? 'طرف دوم چطور دفاعیه خود را ثبت می‌کند؟'
                : 'How does the opposing party respond?'}
            </span>
            <p className="text-neutral-700 text-xs leading-relaxed">
              {isFa
                ? 'با کلیک روی لینک، طرف دوم بلافاصله شرح ادعای شما را مشاهده کرده و می‌تواند دفاعیه خود را تایپ کند یا به صورت صوتی ضبط نماید. نیازی به ورود به حساب کاربری ندارد و روی هر دستگاهی کار می‌کند.'
                : 'When they open this link, they will see your claim and can submit their defense via text or voice. Works automatically on any device.'}
            </p>
          </div>

          {/* Share Link Display & Copy Button */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#111111]">
              {isFa ? 'لینک مستقیم و امن پرونده:' : 'Direct Dossier Link:'}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="w-full bg-[#FAFAFA] border border-neutral-300 rounded-[3px] px-3 py-2.5 text-xs text-[#111111] font-mono select-all focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-4 py-2.5 bg-[#FFC400] hover:bg-[#FFD000] border border-[#111111] text-[#111111] font-black rounded-[3px] text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
              >
                {copiedLink ? <Check className="w-4 h-4 text-[#111111]" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? (isFa ? 'کپی شد' : 'Copied!') : (isFa ? 'کپی لینک' : 'Copy')}</span>
              </button>
            </div>
          </div>

          {/* Instant Share Native Links */}
          <div className="space-y-2 pt-1">
            <span className="text-xs font-bold text-[#111111] block">
              {isFa ? 'ارسال سریع از طریق پیام‌رسان‌ها:' : 'Instant Share via Messaging:'}
            </span>
            <div className="grid grid-cols-3 gap-2">
              <a
                href={whatsAppUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 bg-white hover:bg-[#FFC400] text-[#111111] border border-[#111111] font-bold rounded-[3px] text-xs flex items-center justify-center gap-1.5 transition-colors text-center"
              >
                <MessageCircle className="w-4 h-4" />
                <span>{isFa ? 'واتساپ' : 'WhatsApp'}</span>
              </a>

              <a
                href={telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="py-2.5 px-3 bg-white hover:bg-[#FFC400] text-[#111111] border border-[#111111] font-bold rounded-[3px] text-xs flex items-center justify-center gap-1.5 transition-colors text-center"
              >
                <Send className="w-4 h-4" />
                <span>{isFa ? 'تلگرام' : 'Telegram'}</span>
              </a>

              <a
                href={smsUrl}
                className="py-2.5 px-3 bg-white hover:bg-[#FFC400] text-[#111111] border border-[#111111] font-bold rounded-[3px] text-xs flex items-center justify-center gap-1.5 transition-colors text-center"
              >
                <Smartphone className="w-4 h-4" />
                <span>{isFa ? 'پیامک' : 'SMS'}</span>
              </a>
            </div>
          </div>

          {/* Message Preview and Copy Full Invitation */}
          <div className="bg-[#FAFAFA] border border-neutral-300 rounded-[3px] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-neutral-600 font-semibold">
                {isFa ? 'متن آماده ارسال در پیام‌رسان‌ها:' : 'Invitation Message Text:'}
              </span>
              <button
                type="button"
                onClick={handleCopyFullText}
                className="text-xs font-bold text-[#111111] hover:bg-[#FFC400] px-1.5 py-0.5 rounded-[2px] flex items-center gap-1 cursor-pointer transition-colors"
              >
                {copiedText ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedText ? (isFa ? 'متن کپی شد' : 'Copied!') : (isFa ? 'کپی کل متن' : 'Copy Text')}</span>
              </button>
            </div>
            <p className="text-xs text-neutral-800 leading-relaxed whitespace-pre-line bg-white p-2.5 rounded-[2px] border border-neutral-200 max-h-32 overflow-y-auto">
              {shareText}
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#FAFAFA] border-t border-neutral-200 flex items-center justify-between shrink-0">
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#111111] hover:underline font-bold flex items-center gap-1"
          >
            <span>{isFa ? 'تست و باز کردن لینک' : 'Test link'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#111111] hover:bg-neutral-800 text-white font-bold rounded-[3px] text-xs transition-colors cursor-pointer"
          >
            {isFa ? 'بستن' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShareCaseModal;
