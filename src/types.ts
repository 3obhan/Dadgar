export type Language = 'fa' | 'en';

export interface EvidenceItem {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
  extractedText?: string;
}

export interface PartyClaim {
  name: string;
  claimText: string;
  audioBase64?: string;
  audioMimeType?: string;
  evidenceNotes?: string;
  evidenceFiles?: EvidenceItem[];
}

export interface CourtVerdict {
  courtDecreeCode: string;
  timestamp: number;
  winner: 'partyA' | 'partyB' | 'split' | 'equal';
  partyAScore: number;
  partyBScore: number;
  verdictTitle: string;
  moreRightfulPartyName?: string;
  moreRightfulPartyScore?: number;
  executiveSummary: string;
  pureReasoning: string;
  factualAnalysis: string;
  realityCheck: string;
  keyFactors: string[];
  suggestedSettlement: string;
  judicialMaxims: string[];
  meta?: {
    model?: string;
    verifiedFactsCount?: number;
    deliberationDurationMs?: number;
    tokensUsed?: number;
  };
  disclaimer?: string;
}

export interface SavedCase {
  id: string;
  date: string;
  partyA: PartyClaim;
  partyB: PartyClaim;
  verdict: CourtVerdict;
  lang: Language;
}

export interface CaseSample {
  id: string;
  titleFa: string;
  titleEn: string;
  categoryFa: string;
  categoryEn: string;
  partyANameFa: string;
  partyANameEn: string;
  partyAClaimFa: string;
  partyAClaimEn: string;
  partyBNameFa: string;
  partyBNameEn: string;
  partyBClaimFa: string;
  partyBClaimEn: string;
}
