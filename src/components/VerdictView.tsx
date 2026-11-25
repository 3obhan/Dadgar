import React, { useState } from 'react';
import {
  Scale,
  Award,
  FileText,
  Copy,
  Check,
  RotateCcw,
  ShieldCheck,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { Language, CourtVerdict, PartyClaim } from '../types.ts';
import { getTranslation } from '../translations.ts';
import { formatNum } from '../utils/numberHelper.ts';
import { getDecreeDateTime } from '../utils/dateHelper.ts';
import { downloadStampedDecreePdf } from '../utils/pdfDecreeGenerator.ts';

interface VerdictViewProps {
  lang: Language;
  partyA: PartyClaim;
  partyB: PartyClaim;
  verdict: CourtVerdict;
  onNewCase: () => void;
  onOpenPrivacy?: () => void;
}

export const VerdictView: React.FC<VerdictViewProps> = ({
  lang,
  partyA,
  partyB,
  verdict,
  onNewCase,
  onOpenPrivacy,
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  const [activeTab, setActiveTab] = useState<
    'executive' | 'reasoning' | 'reality' | 'analysis' | 'factors' | 'settlement' | 'maxims'
  >('executive');
  const [isCopied, setIsCopied] = useState(false);
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const isPartyAWinner = verdict.winner === 'partyA';
  const isPartyBWinner = verdict.winner === 'partyB';
  const isSplit = verdict.winner === 'split' || verdict.winner === 'equal';

  const dateTime = getDecreeDateTime(verdict.timestamp, lang);
  const aiModelName = verdict.meta?.model || 'gemini-4-hydrogen';

  const handleCopyCertificate = () => {
    const text = `
--------------------------------------------------
⚖️ ${t.verdictHeader} - DADGAR / MR JUDGE
--------------------------------------------------
${t.verdictCode} ${formatNum(verdict.courtDecreeCode, lang)}
${isFa ? 'مدل هوش مصنوعی:' : 'AI Model:'} ${aiModelName}
${isFa ? 'تاریخ و ساعت:' : 'Date & Time:'} ${dateTime.fullStamp}

${partyA.name}: ${formatNum(verdict.partyAScore, lang)} / ${formatNum(100, lang)}
${partyB.name}: ${formatNum(verdict.partyBScore, lang)} / ${formatNum(100, lang)}

📌 ${t.winnerLabel}: ${verdict.verdictTitle}
👑 ${t.moreRightfulParty}: ${verdict.moreRightfulPartyName || (isPartyAWinner ? partyA.name : partyB.name)} (${formatNum(verdict.moreRightfulPartyScore ?? Math.max(verdict.partyAScore, verdict.partyBScore), lang)}/100)

📜 ${t.tabExecutive}:
${verdict.executiveSummary}

🧠 ${t.tabReasoning}:
${verdict.pureReasoning}

💡 ${t.tabSettlement}:
${verdict.suggestedSettlement}

--------------------------------------------------
${t.legalDisclaimerText}
--------------------------------------------------
`;
    navigator.clipboard.writeText(text.trim());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const handleDownloadPdf = async () => {
    setPdfError(null);
    setIsLoadingPdf(true);
    try {
      await downloadStampedDecreePdf(partyA, partyB, verdict, lang);
    } catch (err) {
      console.warn('Failed generating stamped PDF:', err);
      setPdfError(
        isFa
          ? 'خطا در تولید فایل PDF روی سربرگ رسمی. لطفاً دوباره تلاش کنید.'
          : 'Failed to generate stamped PDF decree. Please try again.'
      );
    } finally {
      setIsLoadingPdf(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Verdict Summary Dossier */}
      <div className="bg-white border-2 border-[#111111] rounded-[4px] p-5 sm:p-7 shadow-[5px_5px_0px_#111111]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[3px] bg-[#FFC400] border border-[#111111] flex items-center justify-center text-[#111111] shrink-0">
              <Scale className="w-5 h-5 text-[#111111]" />
            </div>
            <div>
              <span className="text-xs font-bold text-neutral-500 block">
                {t.verdictHeader}
              </span>
              <h2 className="text-lg sm:text-2xl font-black text-[#111111] leading-snug mt-0.5 text-balance">
                {verdict.verdictTitle}
              </h2>
            </div>
          </div>

          <div className="text-right sm:text-left font-mono text-xs text-neutral-600 tabular-nums space-y-0.5 shrink-0">
            <div>
              <span className="text-neutral-500">{t.verdictCode} </span>
              <span className="text-[#111111] font-bold bg-[#FFC400] px-1.5 py-0.5 rounded-[2px]">
                {formatNum(verdict.courtDecreeCode, lang)}
              </span>
            </div>
            <div className="text-[11px] text-neutral-500">
              {dateTime.shamsiDate} · {dateTime.timeString}
            </div>
          </div>
        </div>

        {/* Score Comparison Bars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5">
          {/* Party A Score */}
          <div
            className={`p-4 rounded-[3px] border transition-colors ${
              isPartyAWinner
                ? 'bg-[#FFFDF2] border-2 border-[#111111]'
                : 'bg-[#FAFAFA] border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2.5 gap-2">
              <span className="text-xs font-extrabold text-[#111111] flex items-center gap-1.5">
                {isPartyAWinner && <Award className="w-4 h-4 text-[#111111] shrink-0" />}
                <span>{partyA.name}</span>
              </span>
              <span className="font-mono tabular-nums text-base font-black text-[#111111]">
                {formatNum(verdict.partyAScore, lang)}%
              </span>
            </div>
            <div className="w-full h-3 bg-white border border-[#111111] rounded-[2px] overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  isPartyAWinner ? 'bg-[#FFC400]' : 'bg-[#111111]'
                }`}
                style={{ width: `${verdict.partyAScore}%` }}
              />
            </div>
          </div>

          {/* Party B Score */}
          <div
            className={`p-4 rounded-[3px] border transition-colors ${
              isPartyBWinner
                ? 'bg-[#FFFDF2] border-2 border-[#111111]'
                : 'bg-[#FAFAFA] border-neutral-300'
            }`}
          >
            <div className="flex items-center justify-between mb-2.5 gap-2">
              <span className="text-xs font-extrabold text-[#111111] flex items-center gap-1.5">
                {isPartyBWinner && <Award className="w-4 h-4 text-[#111111] shrink-0" />}
                <span>{partyB.name}</span>
              </span>
              <span className="font-mono tabular-nums text-base font-black text-[#111111]">
                {formatNum(verdict.partyBScore, lang)}%
              </span>
            </div>
            <div className="w-full h-3 bg-white border border-[#111111] rounded-[2px] overflow-hidden">
              <div
                className={`h-full transition-all duration-700 ${
                  isPartyBWinner ? 'bg-[#FFC400]' : 'bg-[#111111]'
                }`}
                style={{ width: `${verdict.partyBScore}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { key: 'executive', label: t.tabExecutive },
          { key: 'reasoning', label: t.tabReasoning },
          { key: 'reality', label: t.tabReality },
          { key: 'analysis', label: t.tabAnalysis },
          { key: 'factors', label: t.tabFactors },
          { key: 'settlement', label: t.tabSettlement },
          { key: 'maxims', label: t.tabMaxims },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as any)}
            className={`min-h-[42px] px-4 py-2 rounded-[3px] text-xs font-bold shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === tab.key
                ? 'bg-[#FFC400] text-[#111111] border-2 border-[#111111] font-black'
                : 'bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content Panel */}
      <div className="bg-white border-2 border-[#111111] rounded-[4px] p-5 sm:p-7 leading-relaxed text-sm text-[#111111]">
        {activeTab === 'executive' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base flex items-center gap-2 border-b border-neutral-200 pb-2.5">
              <FileText className="w-4 h-4 text-[#111111]" />
              <span>{t.tabExecutive}</span>
            </h4>
            <p className="whitespace-pre-line text-neutral-800 leading-loose text-xs sm:text-sm">
              {verdict.executiveSummary}
            </p>
          </div>
        )}

        {activeTab === 'reasoning' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base flex items-center gap-2 border-b border-neutral-200 pb-2.5">
              <Scale className="w-4 h-4 text-[#111111]" />
              <span>{t.tabReasoning}</span>
            </h4>
            <p className="whitespace-pre-line text-neutral-800 leading-loose text-xs sm:text-sm">
              {verdict.pureReasoning}
            </p>
          </div>
        )}

        {activeTab === 'reality' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base flex items-center gap-2 border-b border-neutral-200 pb-2.5">
              <ShieldCheck className="w-4 h-4 text-[#111111]" />
              <span>{t.tabReality}</span>
            </h4>
            <p className="whitespace-pre-line text-neutral-800 leading-loose text-xs sm:text-sm">
              {verdict.realityCheck || verdict.factualAnalysis}
            </p>
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base flex items-center gap-2 border-b border-neutral-200 pb-2.5">
              <FileText className="w-4 h-4 text-[#111111]" />
              <span>{t.tabAnalysis}</span>
            </h4>
            <p className="whitespace-pre-line text-neutral-800 leading-loose text-xs sm:text-sm">
              {verdict.factualAnalysis}
            </p>
          </div>
        )}

        {activeTab === 'factors' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base border-b border-neutral-200 pb-2.5">
              <span>{t.tabFactors}</span>
            </h4>
            <ul className="space-y-2.5">
              {(verdict.keyFactors || []).map((f, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-3 bg-[#FAFAFA] p-3.5 rounded-[3px] border border-neutral-300 text-xs sm:text-sm"
                >
                  <span className="w-6 h-6 rounded-[2px] bg-[#FFC400] border border-[#111111] text-[#111111] flex items-center justify-center shrink-0 text-xs font-black tabular-nums">
                    {formatNum(idx + 1, lang)}
                  </span>
                  <span className="text-neutral-800 leading-relaxed">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {activeTab === 'settlement' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base flex items-center gap-2 border-b border-neutral-200 pb-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#111111]" />
              <span>{t.tabSettlement}</span>
            </h4>
            <p className="whitespace-pre-line text-[#111111] leading-loose text-xs sm:text-sm bg-[#FFFDF2] border border-[#111111] p-4 rounded-[3px]">
              {verdict.suggestedSettlement}
            </p>
          </div>
        )}

        {activeTab === 'maxims' && (
          <div className="space-y-3 max-w-3xl">
            <h4 className="font-black text-[#111111] text-base border-b border-neutral-200 pb-2.5">
              <span>{t.tabMaxims}</span>
            </h4>
            <ul className="space-y-2.5">
              {(verdict.judicialMaxims || []).map((m, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 bg-[#FAFAFA] p-3.5 rounded-[3px] border border-neutral-300 text-xs sm:text-sm"
                >
                  <Scale className="w-4 h-4 text-[#111111] shrink-0 mt-0.5" />
                  <span className="text-neutral-800 leading-relaxed font-semibold">{m}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action Buttons Bar */}
      <div className="bg-white border-2 border-[#111111] rounded-[4px] p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Direct Stamped PDF Download Button */}
            <button
              type="button"
              disabled={isLoadingPdf}
              onClick={handleDownloadPdf}
              className="min-h-[46px] py-2.5 px-5 bg-[#FFC400] hover:bg-[#FFD000] border-2 border-[#111111] text-[#111111] font-black rounded-[3px] text-xs sm:text-sm flex items-center gap-2 transition-all shadow-[3px_3px_0px_#111111] active:translate-x-[1px] active:translate-y-[1px] active:shadow-[1px_1px_0px_#111111] cursor-pointer disabled:opacity-60"
            >
              {isLoadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#111111]" />
              ) : (
                <Download className="w-4 h-4 text-[#111111]" />
              )}
              <span>{t.officialDecreePdf}</span>
            </button>

            {/* Copy Decree Text */}
            <button
              type="button"
              onClick={handleCopyCertificate}
              className="min-h-[46px] py-2.5 px-4 bg-white hover:bg-neutral-100 border border-[#111111] text-[#111111] rounded-[3px] font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer"
            >
              {isCopied ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
              <span>{isCopied ? t.copiedCertificate : t.copyCertificate}</span>
            </button>
          </div>

          {/* New Case Button */}
          <button
            type="button"
            onClick={onNewCase}
            className="min-h-[46px] py-2.5 px-5 bg-[#111111] hover:bg-neutral-800 text-white rounded-[3px] font-bold text-xs sm:text-sm flex items-center gap-2 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4 text-[#FFC400]" />
            <span>{t.newTrial}</span>
          </button>
        </div>

        {pdfError && (
          <div className="p-3 bg-rose-50 border border-rose-700 rounded-[3px] text-rose-900 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{pdfError}</span>
          </div>
        )}
      </div>
    </div>
  );
};
