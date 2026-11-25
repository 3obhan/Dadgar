/**
 * Official 1-Page Certified A4 Decree HTML Renderer
 * Self-contained (zero relative runtime imports) so both Vite, tsx, node server.ts,
 * and Vercel native ESM Node functions render identically.
 */

function formatNum(input: string | number | undefined | null, lang: string): string {
  if (input === null || input === undefined) return '';
  if (lang === 'fa') {
    const d = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(input).replace(/[0-9]/g, (w) => d[parseInt(w, 10)] ?? w);
  }
  return String(input);
}

function getSolarHijriDate(date: Date) {
  try {
    const formatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    let year = 1403;
    let month = 7;
    let day = 4;
    for (const part of parts) {
      if (part.type === 'year') year = parseInt(part.value, 10) || year;
      if (part.type === 'month') month = parseInt(part.value, 10) || month;
      if (part.type === 'day') day = parseInt(part.value, 10) || day;
    }
    const monthNames = [
      'فروردین',
      'اردیبهشت',
      'خرداد',
      'تیر',
      'مرداد',
      'شهریور',
      'مهر',
      'آبان',
      'آذر',
      'دی',
      'بهمن',
      'اسفند',
    ];
    return {
      year,
      month,
      day,
      monthName: monthNames[(month - 1) % 12] || 'مهر',
    };
  } catch {
    return { year: 1403, month: 7, day: 4, monthName: 'مهر' };
  }
}

function getDecreeDateTime(dateInput?: string | number, lang = 'fa') {
  const date = dateInput ? new Date(dateInput) : new Date();
  const gYear = date.getFullYear();
  const gMonth = String(date.getMonth() + 1).padStart(2, '0');
  const gDay = String(date.getDate()).padStart(2, '0');
  const gregorianDate = `${gYear}-${gMonth}-${gDay}`;

  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const timeRaw = `${hours}:${minutes}:${seconds}`;

  const shamsi = getSolarHijriDate(date);
  const shamsiDateRaw = `${shamsi.year}/${String(shamsi.month).padStart(2, '0')}/${String(shamsi.day).padStart(2, '0')}`;
  const shamsiDateWord = `${shamsi.day} ${shamsi.monthName} ${shamsi.year}`;
  const isFa = lang === 'fa';
  const shamsiDate = isFa ? formatNum(shamsiDateWord, 'fa') : `${shamsiDateRaw} (Solar Hijri)`;
  const timeString = isFa ? formatNum(timeRaw, 'fa') : timeRaw;

  return { shamsiDate, gregorianDate, timeString };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderDecreeOptions {
  lang: string;
  decreeCode: string;
  partyA: {
    name?: string;
    claimText?: string;
  };
  partyB: {
    name?: string;
    claimText?: string;
  };
  verdict: {
    timestamp?: string | number;
    winner?: string;
    verdictTitle?: string;
    moreRightfulPartyName?: string;
    moreRightfulPartyScore?: number;
    partyAScore?: number;
    partyBScore?: number;
    executiveSummary?: string;
    pureReasoning?: string;
    suggestedSettlement?: string;
    judicialMaxims?: string[];
    legalMaxims?: string[];
    meta?: {
      model?: string;
    };
  };
}

export function renderCertifiedDecreeHtml(opts: RenderDecreeOptions): string {
  const { lang, decreeCode, partyA, partyB, verdict } = opts;
  const isFa = lang === 'fa';
  const dir = isFa ? 'rtl' : 'ltr';
  const dateTime = getDecreeDateTime(verdict.timestamp || new Date().toISOString(), lang);

  const isPartyAWinner = verdict.winner === 'partyA';
  const isPartyBWinner = verdict.winner === 'partyB';

  const partyAName = escapeHtml(partyA?.name || (isFa ? 'طرف اول (خواهان)' : 'Party A'));
  const partyBName = escapeHtml(partyB?.name || (isFa ? 'طرف دوم (خوانده)' : 'Party B'));

  const winnerTitle = isPartyAWinner
    ? isFa
      ? 'احراز حقانیت طرف اول'
      : 'Party A Prevails'
    : isPartyBWinner
    ? isFa
      ? 'احراز حقانیت طرف دوم'
      : 'Party B Prevails'
    : isFa
    ? 'تساوی و توافق متقابل'
    : 'Equal Shared Merit';

  const truncate = (text: string | undefined, maxLen = 180) => {
    if (!text) return '—';
    const clean = text.trim().replace(/\s+/g, ' ');
    const sliced = clean.length > maxLen ? `${clean.slice(0, maxLen)}...` : clean;
    return escapeHtml(sliced);
  };

  const claimAExcerpt = truncate(partyA?.claimText, 145);
  const claimBExcerpt = truncate(partyB?.claimText, 145);
  const executiveExcerpt = truncate(verdict.executiveSummary, 270);
  const reasoningExcerpt = truncate(verdict.pureReasoning, 280);
  const settlementExcerpt = truncate(verdict.suggestedSettlement, 175);

  const rawMaxim =
    verdict.judicialMaxims?.[0] ||
    verdict.legalMaxims?.[0] ||
    (isFa ? 'اصل عقلانیت، شفافیت ادله و توازن تعهدات' : 'Principle of Pure Reason and Evidentiary Accountability');
  const primaryMaxim = escapeHtml(rawMaxim);

  const partyAScore = Number.isFinite(verdict.partyAScore) ? Number(verdict.partyAScore) : 50;
  const partyBScore = Number.isFinite(verdict.partyBScore) ? Number(verdict.partyBScore) : 50;
  const rightfulName = escapeHtml(
    verdict.moreRightfulPartyName ||
      (isPartyAWinner ? partyA?.name || 'Party A' : isPartyBWinner ? partyB?.name || 'Party B' : isFa ? 'تساوی کامل استحقاق' : 'Shared Equal Merit')
  );
  const rightfulScore =
    verdict.moreRightfulPartyScore ?? Math.max(partyAScore, partyBScore);

  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 326" width="24" height="31" style="display:block;flex-shrink:0;">
    <polygon points="2,92 54,116 54,198 2,174" fill="#FFC400" />
    <polygon points="62,116 114,92 114,174 62,198" fill="#111111" />
    <polygon points="122,4 180,30 180,112 122,86" fill="#111111" />
    <polygon points="122,182 180,208 180,290 122,264" fill="#111111" />
    <polygon points="188,33 246,59 246,141 188,115" fill="#111111" />
    <polygon points="188,125 246,151 246,233 188,207" fill="#111111" />
    <polygon points="188,217 246,243 246,325 188,299" fill="#111111" />
  </svg>`;

  return `<!DOCTYPE html>
<html dir="${dir}" lang="${lang}">
<head>
  <meta charset="utf-8">
  <title>${isFa ? 'دادنامه رسمی آقای قاضی' : 'Mr. Judger Official Decree'} - ${escapeHtml(decreeCode)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;700&family=Vazirmatn:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 9mm 11mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 100%;
      font-family: 'Vazirmatn', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #111111;
      background: #ffffff;
      direction: ${dir};
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      line-height: 1.55;
    }
    .sheet-outer {
      width: 100%;
      min-height: 274mm;
      max-height: 277mm;
      border: 1.5px solid #111111;
      padding: 4px;
      background: #ffffff;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
    }
    .sheet-inner {
      flex: 1;
      border: 0.75px solid #b08d32;
      padding: 16px 20px 14px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      background: #ffffff;
    }
    .main-stack {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .masthead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1.5px solid #111111;
      padding-bottom: 8px;
      gap: 12px;
    }
    .masthead-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .court-kicker {
      font-size: 9px;
      font-weight: 800;
      color: #8a6914;
      letter-spacing: 0.04em;
    }
    .court-heading {
      font-size: 13px;
      font-weight: 900;
      color: #111111;
      line-height: 1.25;
    }
    .registry-block {
      text-align: ${isFa ? 'left' : 'right'};
      font-size: 8.5px;
      color: #404040;
      line-height: 1.55;
      font-variant-numeric: tabular-nums;
    }
    .registry-code {
      font-family: 'IBM Plex Mono', 'Vazirmatn', monospace;
      font-weight: 700;
      color: #111111;
      font-size: 9.5px;
    }
    .decree-banner {
      padding: 7px 0;
      border-bottom: 1px solid #d4d4d4;
      text-align: center;
    }
    .decree-label {
      font-size: 8.5px;
      font-weight: 700;
      color: #525252;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .decree-title {
      font-size: 14px;
      font-weight: 900;
      color: #111111;
      line-height: 1.35;
    }
    .verdict-summary-band {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      border: 1px solid #111111;
      background: #fffdf5;
      padding: 8px 12px;
    }
    .rightful-label {
      font-size: 8px;
      color: #525252;
      font-weight: 700;
      display: block;
    }
    .rightful-name {
      font-size: 11.5px;
      font-weight: 900;
      color: #111111;
    }
    .score-pair {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 9px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #262626;
    }
    .score-divider {
      color: #b08d32;
      font-weight: 900;
    }
    .verdict-pill {
      background: #ffc400;
      color: #111111;
      border: 1px solid #111111;
      padding: 2px 8px;
      font-size: 8.5px;
      font-weight: 900;
    }
    .claims-table {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border: 1px solid #d4d4d4;
      background: #fafafa;
    }
    .claim-col {
      padding: 7px 10px;
      font-size: 8.8px;
      line-height: 1.5;
      color: #262626;
    }
    .claim-col:first-child {
      border-${isFa ? 'left' : 'right'}: 1px solid #d4d4d4;
    }
    .claim-col-head {
      font-size: 9px;
      font-weight: 800;
      color: #111111;
      margin-bottom: 3px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .clause {
      padding: 5px 0;
      border-bottom: 1px solid #e5e5e5;
    }
    .clause-title {
      font-size: 9.5px;
      font-weight: 900;
      color: #111111;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .clause-marker {
      display: inline-block;
      width: 6px;
      height: 6px;
      background: #ffc400;
      border: 1px solid #111111;
      flex-shrink: 0;
    }
    .clause-body {
      font-size: 8.9px;
      color: #262626;
      line-height: 1.58;
      text-align: justify;
    }
    .maxim-row {
      padding: 6px 10px;
      border: 1px solid #d4d4d4;
      background: #fafafa;
      font-size: 8.6px;
      color: #262626;
      line-height: 1.45;
    }
    .maxim-row strong {
      color: #111111;
      font-weight: 800;
    }
    .legal-disclaimer {
      font-size: 7.7px;
      color: #525252;
      line-height: 1.45;
      text-align: justify;
      padding-top: 4px;
    }
    .footer-seal-band {
      border-top: 1.5px solid #111111;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
    }
    .footer-provenance {
      font-size: 8px;
      color: #404040;
      line-height: 1.55;
      font-variant-numeric: tabular-nums;
    }
    .footer-provenance strong {
      color: #111111;
      font-weight: 800;
    }
    .seal-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .seal-caption {
      text-align: ${isFa ? 'left' : 'right'};
      line-height: 1.4;
    }
    .seal-caption-top {
      font-size: 8px;
      font-weight: 900;
      color: #8a6914;
      letter-spacing: 0.03em;
    }
    .seal-caption-sub {
      font-size: 7.5px;
      font-weight: 700;
      color: #111111;
    }
    .wax-seal-img {
      width: 78px;
      height: 78px;
      object-fit: contain;
      display: block;
      filter: drop-shadow(0 2px 4px rgba(138, 105, 20, 0.28));
    }
  </style>
</head>
<body>
  <div class="sheet-outer">
    <div class="sheet-inner">
      <div class="main-stack">
        <!-- Minimalist Judiciary Stationery Header -->
        <div class="masthead">
          <div class="masthead-brand">
            ${logoSvg}
            <div>
              <div class="court-kicker">${isFa ? 'دیوان داوری هوشمند بر مدار منطق محض' : 'RATIONAL ARBITRATION TRIBUNAL'}</div>
              <div class="court-heading">${isFa ? 'دادنامه رسمی سامانه آقای قاضی' : 'MR. JUDGER · OFFICIAL DECREE'}</div>
            </div>
          </div>
          <div class="registry-block">
            <div>${isFa ? 'شماره پرونده:' : 'Dossier ID:'} <span class="registry-code">${formatNum(escapeHtml(decreeCode), lang)}</span></div>
            <div>${isFa ? 'تاریخ و زمان:' : 'Issued:'} <strong>${dateTime.shamsiDate}</strong> · ${dateTime.timeString}</div>
            <div>${isFa ? 'برگ رسمی یکم از یک' : 'Page 1 of 1 · Original Copy'}</div>
          </div>
        </div>

        <!-- Formal Verdict Title -->
        <div class="decree-banner">
          <div class="decree-label">${isFa ? 'موضوع داوری و رأی نهایی' : 'SUBJECT & FINAL ADJUDICATION'}</div>
          <h1 class="decree-title">${escapeHtml(verdict.verdictTitle || (isFa ? 'دادنامه داوری قطعی' : 'Arbitration Decree'))}</h1>
        </div>

        <!-- Rightful Party & Precision Score Band -->
        <div class="verdict-summary-band">
          <div>
            <span class="rightful-label">${isFa ? 'طرف دارای حقانیت غالب:' : 'Prevailing Party:'}</span>
            <span class="rightful-name">${rightfulName} (${formatNum(rightfulScore, lang)} / ${formatNum(100, lang)})</span>
          </div>
          <div class="score-pair">
            <span>${partyAName}: <strong>${formatNum(partyAScore, lang)}٪</strong></span>
            <span class="score-divider">|</span>
            <span>${partyBName}: <strong>${formatNum(partyBScore, lang)}٪</strong></span>
          </div>
          <div class="verdict-pill">${winnerTitle}</div>
        </div>

        <!-- Statements of Parties -->
        <div class="claims-table">
          <div class="claim-col">
            <div class="claim-col-head">
              <span>${isFa ? 'اظهارات طرف اول (خواهان)' : 'Party A Statement'} — ${partyAName}</span>
            </div>
            <div>${claimAExcerpt}</div>
          </div>
          <div class="claim-col">
            <div class="claim-col-head">
              <span>${isFa ? 'اظهارات طرف دوم (خوانده)' : 'Party B Statement'} — ${partyBName}</span>
            </div>
            <div>${claimBExcerpt}</div>
          </div>
        </div>

        <!-- Structured Judicial Clauses -->
        <div class="clause">
          <div class="clause-title"><span class="clause-marker"></span><span>${isFa ? 'ماده ۱ — خلاصه اجرایی حکم' : 'Article I — Executive Ruling'}</span></div>
          <p class="clause-body">${executiveExcerpt}</p>
        </div>

        <div class="clause">
          <div class="clause-title"><span class="clause-marker"></span><span>${isFa ? 'ماده ۲ — استدلال منطقی و مبانی عقلی رأی' : 'Article II — Pure Rational & Logical Basis'}</span></div>
          <p class="clause-body">${reasoningExcerpt}</p>
        </div>

        <div class="clause" style="border-bottom:none;padding-bottom:2px;">
          <div class="clause-title"><span class="clause-marker"></span><span>${isFa ? 'ماده ۳ — راهکار عملی و تسویه' : 'Article III — Practical Settlement Plan'}</span></div>
          <p class="clause-body">${settlementExcerpt}</p>
        </div>

        <div class="maxim-row">
          <strong>${isFa ? 'قاعده حاکم:' : 'Governing Principle:'}</strong> ${primaryMaxim}
        </div>

        <p class="legal-disclaimer">
          ${isFa
            ? 'سلب مسئولیت قانونی: این دادنامه نتیجه تحلیل هوشمند بر مدار منطق و واقع‌بینی بوده، فاقد اعتبار اجرایی محاکم دولتی است و مشاوره حقوقی رسمی محسوب نمی‌شود.'
            : 'Legal Disclaimer: This decree represents AI-assisted rational arbitration based on formal logic and common sense. It carries no statutory court enforcement authority and is not formal legal counsel.'}
        </p>
      </div>

      <!-- Bottom Official Seal & Signature Block -->
      <div class="footer-seal-band">
        <div class="footer-provenance">
          <div>${isFa ? 'صادرکننده:' : 'Tribunal:'} <strong>${isFa ? 'دیوان داوری هوشمند آقای قاضی (رایگان)' : 'Mr. Judger AI Tribunal'}</strong></div>
          <div>${isFa ? 'موتور تحلیل منطقی:' : 'AI Engine:'} <strong>${escapeHtml(verdict.meta?.model || 'gemini-4-hydrogen')}</strong> · ${isFa ? 'تاریخ میلادی:' : 'Gregorian:'} ${dateTime.gregorianDate}</div>
          <div>${isFa ? 'شماره تصدیق:' : 'Verification Code:'} <strong>${formatNum(escapeHtml(decreeCode), lang)}</strong></div>
        </div>

        <div class="seal-group">
          <div class="seal-caption">
            <div class="seal-caption-top">${isFa ? 'ممهور به مهر طلایی دیوان' : 'OFFICIAL GOLDEN SEAL'}</div>
            <div class="seal-caption-sub">${isFa ? 'آقای قاضی · سند تک‌برگی دادگستری' : 'MR. JUDGER · CERTIFIED COPY'}</div>
          </div>
          <img src="/seal.png" class="wax-seal-img" alt="${isFa ? 'مهر طلایی آقای قاضی' : 'Golden Seal of Mr. Judger'}" />
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}