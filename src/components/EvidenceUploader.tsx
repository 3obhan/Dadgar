import React from 'react';
import { Paperclip, FileCheck } from 'lucide-react';
import { Language, PartyClaim } from '../types.ts';
import { getTranslation } from '../translations.ts';

interface EvidenceUploaderProps {
  lang: Language;
  partyA: PartyClaim;
  partyB: PartyClaim;
  onUpdatePartyA: (party: PartyClaim) => void;
  onUpdatePartyB: (party: PartyClaim) => void;
}

export const EvidenceUploader: React.FC<EvidenceUploaderProps> = ({
  lang,
  partyA,
  partyB,
  onUpdatePartyA,
  onUpdatePartyB,
}) => {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';

  return (
    <div className="bg-white border-2 border-[#111111] rounded-[4px] p-5 sm:p-6 space-y-4 shadow-[4px_4px_0px_#111111]">
      <div className="flex items-center gap-3 border-b border-neutral-200 pb-3">
        <div className="w-8 h-8 rounded-[3px] bg-[#FFC400] border border-[#111111] flex items-center justify-center text-[#111111]">
          <Paperclip className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-black text-sm sm:text-base text-[#111111]">{t.step3Title}</h3>
          <p className="text-xs text-neutral-600">
            {isFa
              ? 'مستندات کتبی، متن پیامک‌ها، مفاد فاکتور یا شروط شفاهی مؤثر در پرونده'
              : 'Summaries of written agreements, receipts, text logs, or factual exhibits'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Party A Evidence */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
            <FileCheck className="w-3.5 h-3.5 text-[#111111]" />
            <span>
              {isFa ? `مدارک و توضیحات ${partyA.name}` : `Exhibits of ${partyA.name}`}
            </span>
          </label>
          <textarea
            rows={3}
            value={partyA.evidenceNotes || ''}
            onChange={(e) => onUpdatePartyA({ ...partyA, evidenceNotes: e.target.value })}
            placeholder={t.evidencePlaceholder}
            className="w-full bg-[#FAFAFA] border border-neutral-300 focus:bg-white focus:border-[#111111] focus:ring-2 focus:ring-[#FFC400] rounded-[3px] p-3 text-xs text-[#111111] placeholder-neutral-400 outline-none transition-colors resize-y leading-relaxed"
          />
        </div>

        {/* Party B Evidence */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
            <FileCheck className="w-3.5 h-3.5 text-[#111111]" />
            <span>
              {isFa ? `مدارک و توضیحات ${partyB.name}` : `Exhibits of ${partyB.name}`}
            </span>
          </label>
          <textarea
            rows={3}
            value={partyB.evidenceNotes || ''}
            onChange={(e) => onUpdatePartyB({ ...partyB, evidenceNotes: e.target.value })}
            placeholder={t.evidencePlaceholder}
            className="w-full bg-[#FAFAFA] border border-neutral-300 focus:bg-white focus:border-[#111111] focus:ring-2 focus:ring-[#FFC400] rounded-[3px] p-3 text-xs text-[#111111] placeholder-neutral-400 outline-none transition-colors resize-y leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
};
