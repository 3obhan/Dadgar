import { PDFDocument } from 'pdf-lib';
import { CourtVerdict, Language, PartyClaim } from '../types.ts';
import { getTranslation } from '../translations.ts';
import { formatNum } from './numberHelper.ts';
import { getDecreeDateTime } from './dateHelper.ts';

interface PdfBlock {
  height: number;
  draw: (ctx: CanvasRenderingContext2D, topY: number) => void;
}

const TEMPLATE_URL = '/STAMPED_letterhead.pdf';

// Safe printable area inside /public/STAMPED_letterhead.pdf (736 x 1074 pt)
// Clear of top yellow ribbon + isometric logo (~195 pt) and bottom black wave + golden seal (~195 pt)
const PAGE_WIDTH = 736;
const PAGE_HEIGHT = 1074;
const SAFE_MARGIN_X = 48;
const SAFE_TOP_Y = 204;
const SAFE_BOTTOM_Y = 868;
const SAFE_WIDTH = PAGE_WIDTH - SAFE_MARGIN_X * 2; // 640 pt
const SAFE_HEIGHT = SAFE_BOTTOM_Y - SAFE_TOP_Y; // 664 pt
const RENDER_SCALE = 2.5; // High-DPI crisp output (1840 x 2685 px full canvas)

function truncateText(text: string, maxChars: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars).trimEnd() + '…';
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string
): string[] {
  const prevFont = ctx.font;
  ctx.font = font;
  const lines: string[] = [];
  const paragraphs = (text || '').split(/\r?\n/);

  for (const rawPara of paragraphs) {
    const para = rawPara.trim();
    if (!para) {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      continue;
    }

    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        // Handle single oversized token without spaces
        if (ctx.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            const testChunk = chunk + ch;
            if (ctx.measureText(testChunk).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk = testChunk;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  ctx.font = prevFont;
  return lines;
}

function createMeasureContext(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available');
  }
  return ctx;
}

async function ensureFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.ready,
      document.fonts.load('400 16px Vazirmatn').catch(() => undefined),
      document.fonts.load('600 16px Vazirmatn').catch(() => undefined),
      document.fonts.load('700 16px Vazirmatn').catch(() => undefined),
      document.fonts.load('900 16px Vazirmatn').catch(() => undefined),
      document.fonts.load('700 14px "IBM Plex Mono"').catch(() => undefined),
    ]);
  } catch {
    // Proceed cleanly with system fallback if network font loading fails
  }
}

function buildDocumentBlocks(
  ctx: CanvasRenderingContext2D,
  partyA: PartyClaim,
  partyB: PartyClaim,
  verdict: CourtVerdict,
  lang: Language,
  bodyFontSize: number
): PdfBlock[] {
  const t = getTranslation(lang);
  const isFa = lang === 'fa';
  const fontFamily = isFa
    ? 'Vazirmatn, Tahoma, Arial, sans-serif'
    : 'Vazirmatn, "Segoe UI", Arial, sans-serif';
  const monoFamily = '"IBM Plex Mono", Vazirmatn, monospace';

  const dateTime = getDecreeDateTime(verdict.timestamp, lang);
  const isPartyAWinner = verdict.winner === 'partyA';
  const isPartyBWinner = verdict.winner === 'partyB';
  const isSplit = verdict.winner === 'split' || verdict.winner === 'equal';

  const winnerDisplay = isSplit
    ? isFa
      ? 'تساوی / تقسیم مسئولیت'
      : 'Shared / Balanced Liability'
    : verdict.moreRightfulPartyName || (isPartyAWinner ? partyA.name : partyB.name);

  const winnerScore = formatNum(
    verdict.moreRightfulPartyScore ?? Math.max(verdict.partyAScore, verdict.partyBScore),
    lang
  );

  const aiModelName = verdict.meta?.model || 'gemini';

  const bodyFont = `400 ${bodyFontSize}px ${fontFamily}`;
  const bodyBoldFont = `700 ${bodyFontSize}px ${fontFamily}`;
  const headingFontSize = bodyFontSize + 1.25;
  const headingFont = `800 ${headingFontSize}px ${fontFamily}`;
  const lineHeight = Math.round(bodyFontSize * 1.65 * 10) / 10;
  const smallFontSize = Math.max(7.5, bodyFontSize - 1.5);

  const blocks: PdfBlock[] = [];

  const setDir = (c: CanvasRenderingContext2D, alignStart = true) => {
    c.direction = isFa ? 'rtl' : 'ltr';
    if (alignStart) {
      c.textAlign = isFa ? 'right' : 'left';
    } else {
      c.textAlign = isFa ? 'left' : 'right';
    }
    c.textBaseline = 'top';
  };

  // 1. Header Masthead Block
  {
    const mastheadHeight = 52;
    blocks.push({
      height: mastheadHeight,
      draw: (c, topY) => {
        const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;
        const endX = isFa ? SAFE_MARGIN_X : SAFE_MARGIN_X + SAFE_WIDTH;

        // Eyebrow
        setDir(c, true);
        c.font = `700 8.5px ${fontFamily}`;
        c.fillStyle = '#525252';
        c.fillText(
          isFa ? 'دیوان داوری هوشمند جناب قاضی' : 'MR. J RATIONAL ARBITRATION TRIBUNAL',
          startX,
          topY
        );

        // Main Title
        c.font = `900 15px ${fontFamily}`;
        c.fillStyle = '#111111';
        c.fillText(
          isFa ? 'دادنامه رسمی رأی و داوری نهایی' : 'OFFICIAL ARBITRATION DECREE',
          startX,
          topY + 13
        );

        // Code Badge on opposite side
        const codeText = `${isFa ? 'کد پرونده:' : 'CASE ID:'} ${formatNum(verdict.courtDecreeCode, lang)}`;
        c.font = `700 8.5px ${monoFamily}`;
        const badgeTextW = c.measureText(codeText).width;
        const badgeW = badgeTextW + 16;
        const badgeH = 19;
        const badgeX = isFa ? endX : endX - badgeW;

        c.fillStyle = '#FFC400';
        c.fillRect(badgeX, topY, badgeW, badgeH);
        c.lineWidth = 1.25;
        c.strokeStyle = '#111111';
        c.strokeRect(badgeX, topY, badgeW, badgeH);

        c.direction = 'ltr';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#111111';
        c.fillText(codeText, badgeX + badgeW / 2, topY + badgeH / 2 + 0.5);

        // Date & Time under badge
        setDir(c, false);
        c.font = `600 8.5px ${fontFamily}`;
        c.fillStyle = '#525252';
        const stampText = isFa
          ? `${dateTime.shamsiDate} · ساعت ${dateTime.timeString}`
          : `${dateTime.gregorianDate} · ${dateTime.timeString}`;
        c.fillText(stampText, endX, topY + 24);

        // Bottom black divider rule
        c.beginPath();
        c.moveTo(SAFE_MARGIN_X, topY + 42);
        c.lineTo(SAFE_MARGIN_X + SAFE_WIDTH, topY + 42);
        c.lineWidth = 2;
        c.strokeStyle = '#111111';
        c.stroke();
      },
    });
  }

  // 2. Verdict Headline Banner
  {
    const titleFontSize = Math.min(13, bodyFontSize + 2.5);
    const titleFont = `900 ${titleFontSize}px ${fontFamily}`;
    const titleLineH = Math.round(titleFontSize * 1.48 * 10) / 10;
    const innerPadX = 14;
    const accentW = 5;
    const textMaxW = SAFE_WIDTH - innerPadX * 2 - accentW - 4;
    const titleLines = wrapText(ctx, verdict.verdictTitle || '', textMaxW, titleFont);
    const boxH = 26 + titleLines.length * titleLineH + 10;

    blocks.push({
      height: boxH + 10,
      draw: (c, topY) => {
        // Fill cream background + sharp border
        c.fillStyle = '#FFFDF2';
        c.fillRect(SAFE_MARGIN_X, topY, SAFE_WIDTH, boxH);
        c.lineWidth = 1.5;
        c.strokeStyle = '#111111';
        c.strokeRect(SAFE_MARGIN_X, topY, SAFE_WIDTH, boxH);

        // Thick yellow architectural accent strip on start side
        const accentX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH - accentW : SAFE_MARGIN_X;
        c.fillStyle = '#FFC400';
        c.fillRect(accentX, topY, accentW, boxH);

        const textStartX = isFa
          ? SAFE_MARGIN_X + SAFE_WIDTH - accentW - innerPadX
          : SAFE_MARGIN_X + accentW + innerPadX;
        const textEndX = isFa ? SAFE_MARGIN_X + innerPadX : SAFE_MARGIN_X + SAFE_WIDTH - innerPadX;

        // Top eyebrow row inside box
        setDir(c, true);
        c.font = `800 8.5px ${fontFamily}`;
        c.fillStyle = '#525252';
        c.fillText(t.winnerLabel, textStartX, topY + 8);

        setDir(c, false);
        c.font = `800 8.5px ${fontFamily}`;
        c.fillStyle = '#111111';
        const winnerBadgeText = isSplit
          ? winnerDisplay
          : `${t.moreRightfulParty} ${winnerDisplay} (${winnerScore}%)`;
        c.fillText(winnerBadgeText, textEndX, topY + 8);

        // Verdict Title lines
        setDir(c, true);
        c.font = titleFont;
        c.fillStyle = '#111111';
        titleLines.forEach((line, idx) => {
          c.fillText(line, textStartX, topY + 24 + idx * titleLineH);
        });
      },
    });
  }

  // 3. Party Comparison Score Cards (2 columns)
  {
    const colGap = 12;
    const colW = (SAFE_WIDTH - colGap) / 2; // 314 pt
    const cardPad = 10;
    const claimFont = `400 ${smallFontSize}px ${fontFamily}`;
    const claimLineH = Math.round(smallFontSize * 1.45 * 10) / 10;

    const partyASnippet = partyA.claimText
      ? wrapText(ctx, truncateText(partyA.claimText, 125), colW - cardPad * 2, claimFont).slice(0, 2)
      : [];
    const partyBSnippet = partyB.claimText
      ? wrapText(ctx, truncateText(partyB.claimText, 125), colW - cardPad * 2, claimFont).slice(0, 2)
      : [];
    const snippetLinesCount = Math.max(partyASnippet.length, partyBSnippet.length);
    const cardH = 42 + (snippetLinesCount > 0 ? snippetLinesCount * claimLineH + 6 : 0);

    blocks.push({
      height: cardH + 12,
      draw: (c, topY) => {
        const drawPartyCard = (
          x: number,
          roleLabel: string,
          party: PartyClaim,
          score: number,
          isWinner: boolean,
          snippetLines: string[]
        ) => {
          c.fillStyle = isWinner ? '#FFFDF2' : '#FAFAFA';
          c.fillRect(x, topY, colW, cardH);
          c.lineWidth = isWinner ? 1.75 : 1;
          c.strokeStyle = isWinner ? '#111111' : '#D4D4D4';
          c.strokeRect(x, topY, colW, cardH);

          const startX = isFa ? x + colW - cardPad : x + cardPad;
          const endX = isFa ? x + cardPad : x + colW - cardPad;

          // Party Name + Role
          setDir(c, true);
          c.font = `800 ${smallFontSize + 0.5}px ${fontFamily}`;
          c.fillStyle = '#111111';
          const nameLabel = truncateText(`${roleLabel}: ${party.name}`, 34);
          c.fillText(nameLabel, startX, topY + 9);

          // Score Percentage
          setDir(c, false);
          c.font = `900 ${smallFontSize + 2.5}px ${monoFamily}`;
          c.fillStyle = '#111111';
          c.fillText(`${formatNum(score, lang)}%`, endX, topY + 7);

          // Progress Bar
          const barX = x + cardPad;
          const barY = topY + 26;
          const barW = colW - cardPad * 2;
          const barH = 7;

          c.fillStyle = '#FFFFFF';
          c.fillRect(barX, barY, barW, barH);
          const clampedScore = Math.max(0, Math.min(100, Number(score) || 0));
          const fillW = (barW * clampedScore) / 100;
          if (fillW > 0) {
            c.fillStyle = isWinner ? '#FFC400' : '#111111';
            const fillX = isFa ? barX + barW - fillW : barX;
            c.fillRect(fillX, barY, fillW, barH);
          }
          c.lineWidth = 1;
          c.strokeStyle = '#111111';
          c.strokeRect(barX, barY, barW, barH);

          // Claim summary snippet
          if (snippetLines.length > 0) {
            setDir(c, true);
            c.font = claimFont;
            c.fillStyle = '#525252';
            snippetLines.forEach((line, i) => {
              c.fillText(line, startX, barY + barH + 7 + i * claimLineH);
            });
          }
        };

        const cardAX = isFa ? SAFE_MARGIN_X + colW + colGap : SAFE_MARGIN_X;
        const cardBX = isFa ? SAFE_MARGIN_X : SAFE_MARGIN_X + colW + colGap;

        drawPartyCard(
          cardAX,
          isFa ? 'خواهان' : 'Plaintiff',
          partyA,
          verdict.partyAScore,
          isPartyAWinner,
          partyASnippet
        );
        drawPartyCard(
          cardBX,
          isFa ? 'خوانده' : 'Defendant',
          partyB,
          verdict.partyBScore,
          isPartyBWinner,
          partyBSnippet
        );
      },
    });
  }

  // Helper to push a section heading + body lines split into manageable paragraph chunks
  const addSection = (title: string, content: string, highlightBox = false) => {
    const clean = (content || '').trim();
    if (!clean) return;

    const innerPad = highlightBox ? 11 : 0;
    const textW = SAFE_WIDTH - innerPad * 2 - (highlightBox ? 4 : 0);
    const lines = wrapText(ctx, clean, textW, bodyFont);

    if (highlightBox) {
      const boxH = 22 + lines.length * lineHeight + 10;
      blocks.push({
        height: boxH + 10,
        draw: (c, topY) => {
          c.fillStyle = '#FAFAFA';
          c.fillRect(SAFE_MARGIN_X, topY, SAFE_WIDTH, boxH);
          c.lineWidth = 1;
          c.strokeStyle = '#D4D4D4';
          c.strokeRect(SAFE_MARGIN_X, topY, SAFE_WIDTH, boxH);

          // Strong black accent bar on start edge
          const barX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH - 4 : SAFE_MARGIN_X;
          c.fillStyle = '#111111';
          c.fillRect(barX, topY, 4, boxH);

          const startX = isFa
            ? SAFE_MARGIN_X + SAFE_WIDTH - 4 - innerPad
            : SAFE_MARGIN_X + 4 + innerPad;

          setDir(c, true);
          c.font = headingFont;
          c.fillStyle = '#111111';
          c.fillText(title, startX, topY + 8);

          c.font = bodyFont;
          c.fillStyle = '#1F2937';
          lines.forEach((line, idx) => {
            if (line) {
              c.fillText(line, startX, topY + 25 + idx * lineHeight);
            }
          });
        },
      });
      return;
    }

    // Section heading block (kept together with at least first 2 lines)
    const headCount = Math.min(2, lines.length);
    const headH = 20 + headCount * lineHeight + (headCount === lines.length ? 8 : 0);

    blocks.push({
      height: headH,
      draw: (c, topY) => {
        const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;

        // Square architectural marker
        const sqSize = 7;
        const sqX = isFa ? startX - sqSize : startX;
        c.fillStyle = '#FFC400';
        c.fillRect(sqX, topY + 4, sqSize, sqSize);
        c.lineWidth = 1;
        c.strokeStyle = '#111111';
        c.strokeRect(sqX, topY + 4, sqSize, sqSize);

        const titleX = isFa ? startX - sqSize - 7 : startX + sqSize + 7;
        setDir(c, true);
        c.font = headingFont;
        c.fillStyle = '#111111';
        c.fillText(title, titleX, topY);

        c.font = bodyFont;
        c.fillStyle = '#262626';
        for (let i = 0; i < headCount; i++) {
          const line = lines[i];
          if (line) {
            c.fillText(line, startX, topY + 19 + i * lineHeight);
          }
        }
      },
    });

    // Remaining lines as individual flowable line blocks
    for (let i = headCount; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      const h = (line ? lineHeight : lineHeight * 0.55) + (isLast ? 8 : 0);
      blocks.push({
        height: h,
        draw: (c, topY) => {
          if (!line) return;
          const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;
          setDir(c, true);
          c.font = bodyFont;
          c.fillStyle = '#262626';
          c.fillText(line, startX, topY);
        },
      });
    }
  };

  // Helper to push bulleted list section
  const addBulletSection = (title: string, items: string[], indexed = false) => {
    const cleanItems = (items || []).map((x) => (x || '').trim()).filter(Boolean);
    if (cleanItems.length === 0) return;

    const bulletPrefixW = 18;
    const itemTextW = SAFE_WIDTH - bulletPrefixW;

    const wrappedItems = cleanItems.map((item) => wrapText(ctx, item, itemTextW, bodyFont));

    // Title + first item together
    const firstLines = wrappedItems[0];
    const firstItemH = 20 + firstLines.length * lineHeight + 4;
    blocks.push({
      height: firstItemH,
      draw: (c, topY) => {
        const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;
        const sqSize = 7;
        const sqX = isFa ? startX - sqSize : startX;
        c.fillStyle = '#111111';
        c.fillRect(sqX, topY + 4, sqSize, sqSize);

        const titleX = isFa ? startX - sqSize - 7 : startX + sqSize + 7;
        setDir(c, true);
        c.font = headingFont;
        c.fillStyle = '#111111';
        c.fillText(title, titleX, topY);

        const marker = indexed ? `${formatNum(1, lang)}.` : '▪';
        c.font = bodyBoldFont;
        c.fillStyle = '#111111';
        c.fillText(marker, startX, topY + 19);

        const textX = isFa ? startX - bulletPrefixW : startX + bulletPrefixW;
        c.font = bodyFont;
        c.fillStyle = '#262626';
        firstLines.forEach((line, idx) => {
          if (line) c.fillText(line, textX, topY + 19 + idx * lineHeight);
        });
      },
    });

    for (let itemIdx = 1; itemIdx < wrappedItems.length; itemIdx++) {
      const lines = wrappedItems[itemIdx];
      const isLast = itemIdx === wrappedItems.length - 1;
      const h = lines.length * lineHeight + (isLast ? 9 : 4);
      blocks.push({
        height: h,
        draw: (c, topY) => {
          const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;
          setDir(c, true);
          const marker = indexed ? `${formatNum(itemIdx + 1, lang)}.` : '▪';
          c.font = bodyBoldFont;
          c.fillStyle = '#111111';
          c.fillText(marker, startX, topY);

          const textX = isFa ? startX - bulletPrefixW : startX + bulletPrefixW;
          c.font = bodyFont;
          c.fillStyle = '#262626';
          lines.forEach((line, idx) => {
            if (line) c.fillText(line, textX, topY + idx * lineHeight);
          });
        },
      });
    }
  };

  // Add Verdict Results Sections
  addSection(t.tabExecutive, verdict.executiveSummary);
  addSection(t.tabReasoning, verdict.pureReasoning);

  if (
    verdict.realityCheck &&
    verdict.realityCheck.trim() &&
    verdict.realityCheck.trim() !== verdict.factualAnalysis?.trim()
  ) {
    addSection(t.tabReality, verdict.realityCheck);
  } else if (verdict.factualAnalysis && verdict.factualAnalysis.trim()) {
    addSection(t.tabAnalysis, verdict.factualAnalysis);
  }

  addBulletSection(t.tabFactors, verdict.keyFactors || [], true);
  addSection(t.tabSettlement, verdict.suggestedSettlement, true);
  addBulletSection(t.tabMaxims, verdict.judicialMaxims || [], false);

  // Legal Disclaimer Footer Block
  {
    const discFontSize = 7.5;
    const discFont = `400 ${discFontSize}px ${fontFamily}`;
    const discLineH = 11.5;
    const discText = `${t.legalDisclaimerText} (${t.aiModelBadge} ${aiModelName})`;
    const discLines = wrapText(ctx, discText, SAFE_WIDTH, discFont);
    const totalH = 10 + discLines.length * discLineH;

    blocks.push({
      height: totalH,
      draw: (c, topY) => {
        c.beginPath();
        c.moveTo(SAFE_MARGIN_X, topY + 2);
        c.lineTo(SAFE_MARGIN_X + SAFE_WIDTH, topY + 2);
        c.lineWidth = 0.75;
        c.strokeStyle = '#D4D4D4';
        c.stroke();

        const startX = isFa ? SAFE_MARGIN_X + SAFE_WIDTH : SAFE_MARGIN_X;
        setDir(c, true);
        c.font = discFont;
        c.fillStyle = '#666666';
        discLines.forEach((line, idx) => {
          c.fillText(line, startX, topY + 8 + idx * discLineH);
        });
      },
    });
  }

  return blocks;
}

function paginateBlocks(blocks: PdfBlock[]): PdfBlock[][] {
  const pages: PdfBlock[][] = [[]];
  let usedHeight = 0;

  for (const block of blocks) {
    if (usedHeight + block.height > SAFE_HEIGHT && pages[pages.length - 1].length > 0) {
      pages.push([block]);
      usedHeight = block.height;
    } else {
      pages[pages.length - 1].push(block);
      usedHeight += block.height;
    }
  }

  return pages;
}

async function renderOverlayPagePng(
  blocks: PdfBlock[],
  pageIndex: number,
  totalPages: number,
  lang: Language
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_WIDTH * RENDER_SCALE);
  canvas.height = Math.round(PAGE_HEIGHT * RENDER_SCALE);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create PDF rendering canvas');
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  let y = SAFE_TOP_Y;
  for (const block of blocks) {
    block.draw(ctx, y);
    y += block.height;
  }

  // Subtle page numbering only when document spans multiple pages
  if (totalPages > 1) {
    const isFa = lang === 'fa';
    ctx.direction = isFa ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 8px ${isFa ? 'Vazirmatn, Tahoma, sans-serif' : 'Vazirmatn, Arial, sans-serif'}`;
    ctx.fillStyle = '#525252';
    const pageLabel = isFa
      ? `صفحه ${formatNum(pageIndex + 1, lang)} از ${formatNum(totalPages, lang)}`
      : `Page ${pageIndex + 1} of ${totalPages}`;
    ctx.fillText(pageLabel, PAGE_WIDTH / 2, SAFE_BOTTOM_Y + 2);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Failed to export overlay image');
  }
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function generateStampedDecreePdf(
  partyA: PartyClaim,
  partyB: PartyClaim,
  verdict: CourtVerdict,
  lang: Language
): Promise<{ pdfBytes: Uint8Array; fileName: string }> {
  await ensureFontsReady();

  const response = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Could not load letterhead template (${response.status})`);
  }
  const templateBytes = await response.arrayBuffer();

  const pdfDoc = await PDFDocument.load(templateBytes);
  const templateCopyDoc = await PDFDocument.load(templateBytes);

  const measureCtx = createMeasureContext();

  // Try font sizes from 10pt down to 8.75pt to fit cleanly on 1 stamped page when possible
  const candidateSizes = [10, 9.5, 9, 8.75];
  let chosenBlocks: PdfBlock[] = [];
  let chosenPages: PdfBlock[][] = [];

  for (const size of candidateSizes) {
    const blocks = buildDocumentBlocks(measureCtx, partyA, partyB, verdict, lang, size);
    const pages = paginateBlocks(blocks);
    chosenBlocks = blocks;
    chosenPages = pages;
    if (pages.length === 1) break;
  }

  // If still multi-page (unusually detailed verdict), re-render at readable 9.75pt across cloned letterhead pages
  if (chosenPages.length > 1) {
    chosenBlocks = buildDocumentBlocks(measureCtx, partyA, partyB, verdict, lang, 9.75);
    chosenPages = paginateBlocks(chosenBlocks);
  }

  const totalPages = chosenPages.length;

  for (let i = 0; i < totalPages; i++) {
    let targetPage = pdfDoc.getPage(0);
    if (i > 0) {
      const [clonedTemplatePage] = await pdfDoc.copyPages(templateCopyDoc, [0]);
      targetPage = pdfDoc.addPage(clonedTemplatePage);
    }

    const { width, height } = targetPage.getSize();
    const overlayPngBytes = await renderOverlayPagePng(chosenPages[i], i, totalPages, lang);
    const pngImage = await pdfDoc.embedPng(overlayPngBytes);

    targetPage.drawImage(pngImage, {
      x: 0,
      y: 0,
      width,
      height,
    });
  }

  const safeCode = (verdict.courtDecreeCode || 'DECREE').replace(/[^a-zA-Z0-9_-]/g, '');
  pdfDoc.setTitle(lang === 'fa' ? `دادنامه رسمی جناب قاضی - ${safeCode}` : `Official Decree - ${safeCode}`);
  pdfDoc.setCreator('Jenab Ghazi Arbitration Platform');

  const pdfBytes = await pdfDoc.save();
  const fileName = `JenabGhazi_Decree_${safeCode}.pdf`;

  return { pdfBytes, fileName };
}

export async function downloadStampedDecreePdf(
  partyA: PartyClaim,
  partyB: PartyClaim,
  verdict: CourtVerdict,
  lang: Language
): Promise<void> {
  const { pdfBytes, fileName } = await generateStampedDecreePdf(partyA, partyB, verdict, lang);
  const blob = new Blob([pdfBytes.slice().buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
