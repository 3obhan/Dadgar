export interface SymbolicVerificationResult {
  matched: boolean;
  domain: string;
  facts: string[];
  summary: string;
  computedValues: Array<{ expression: string; value: number }>;
  arbitrationVerdict?: {
    winner: "partyA" | "partyB" | "equal";
    partyAScore: number;
    partyBScore: number;
  };
}

const PERSIAN_DIGIT_MAP: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

const PERSIAN_DOT_COUNTS: Record<string, number> = {
  ب: 1, پ: 3, ت: 2, ث: 3, ج: 1, چ: 3, خ: 1, ذ: 1, ز: 1, ژ: 3,
  ش: 3, ض: 1, ظ: 1, غ: 1, ف: 1, ق: 2, ن: 1, ی: 2, ي: 2,
};

export function normalizeBilingualText(text: string): string {
  return (text || "")
    .replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_DIGIT_MAP[ch] ?? ch)
    .replace(/ك/g, "ک")
    .replace(/ي/g, "ی")
    .replace(/ة/g, "ه")
    .replace(/\u200c/g, " ")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Safe recursive-descent arithmetic evaluator (+, -, *, /, ^, %, parentheses).
 * Never uses eval() or dynamic code execution.
 */
export function evaluateArithmeticExpression(rawExpr: string): number | null {
  const normalized = normalizeBilingualText(rawExpr)
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\s+/g, "");

  if (!normalized || !/^[0-9.+\-*/^()%]+$/.test(normalized)) {
    return null;
  }

  let pos = 0;

  const peek = () => normalized[pos] || "";
  const consume = () => normalized[pos++] || "";

  function parseExpression(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parsePower();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parsePower();
      if (right === null) return null;
      if (op === "/") {
        if (Math.abs(right) < 1e-12) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parsePower(): number | null {
    const base = parseUnary();
    if (base === null) return null;
    if (peek() === "^") {
      consume();
      const exp = parsePower();
      if (exp === null) return null;
      const res = Math.pow(base, exp);
      return Number.isFinite(res) ? res : null;
    }
    return base;
  }

  function parseUnary(): number | null {
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    if (peek() === "-") {
      consume();
      const v = parseUnary();
      return v === null ? null : -v;
    }
    return parsePrimary();
  }

  function parsePrimary(): number | null {
    let val: number | null = null;
    if (peek() === "(") {
      consume();
      val = parseExpression();
      if (val === null || peek() !== ")") return null;
      consume();
    } else {
      const start = pos;
      let sawDot = false;
      while (/[0-9.]/.test(peek())) {
        if (peek() === ".") {
          if (sawDot) return null;
          sawDot = true;
        }
        consume();
      }
      if (pos === start) return null;
      val = Number(normalized.slice(start, pos));
      if (!Number.isFinite(val)) return null;
    }

    while (peek() === "%") {
      consume();
      val = val / 100;
    }
    return val;
  }

  const result = parseExpression();
  if (result === null || pos !== normalized.length || !Number.isFinite(result)) {
    return null;
  }
  return Math.round(result * 1e9) / 1e9;
}

function extractInlineMathExpressions(text: string): Array<{ expression: string; value: number }> {
  const norm = normalizeBilingualText(text);
  const pattern = /(?:\(?\s*-?\d+(?:\.\d+)?%?\s*\)?\s*[+\-*×/÷^]\s*)+(?:\(?\s*-?\d+(?:\.\d+)?%?\s*\)?)/g;
  const matches = norm.match(pattern) || [];
  const results: Array<{ expression: string; value: number }> = [];
  const seen = new Set<string>();

  for (const m of matches.slice(0, 8)) {
    const expr = m.trim();
    if (!expr || seen.has(expr)) continue;
    const val = evaluateArithmeticExpression(expr);
    if (val !== null) {
      seen.add(expr);
      results.push({ expression: expr, value: val });
    }
  }
  return results;
}

function extractNumbers(text: string): number[] {
  const matches = normalizeBilingualText(text).match(/-?\d+(?:\.\d+)?/g) || [];
  return matches.map(Number).filter((n) => Number.isFinite(n));
}

export function verifySymbolicFacts(
  primaryText: string,
  secondaryText?: string
): SymbolicVerificationResult | null {
  const normA = normalizeBilingualText(primaryText);
  const normB = normalizeBilingualText(secondaryText || "");
  const combined = `${normA} ${normB}`.trim();

  const computedValues = extractInlineMathExpressions(combined);
  const facts: string[] = [];

  for (const item of computedValues) {
    facts.push(`Exact math evaluation: ${item.expression} = ${item.value}`);
  }

  // Check if comparing two claims A vs B with equations (e.g., "2 + 2 = 5" vs "2 + 2 = 4")
  if (normB) {
    const eqRegex = /((?:\(?\s*-?\d+(?:\.\d+)?%?\s*\)?\s*[+\-*×/÷^]\s*)+\(?\s*-?\d+(?:\.\d+)?%?\s*\)?)\s*(?:=|مساوی(?:\s*است\s*با)?|برابر(?:\s*است\s*با)?|is|equals?)\s*(-?\d+(?:\.\d+)?)/i;
    const mA = normA.match(eqRegex);
    const mB = normB.match(eqRegex);
    if (mA && mB) {
      const actualA = evaluateArithmeticExpression(mA[1]);
      const actualB = evaluateArithmeticExpression(mB[1]);
      const claimedA = Number(mA[2]);
      const claimedB = Number(mB[2]);
      if (actualA !== null && actualB !== null) {
        const aOk = Math.abs(actualA - claimedA) < 1e-6;
        const bOk = Math.abs(actualB - claimedB) < 1e-6;
        if (aOk !== bOk) {
          const winner = aOk ? "partyA" : "partyB";
          return {
            matched: true,
            domain: "arithmetic_verification",
            facts: [
              ...facts,
              `Claim A (${mA[1].trim()} = ${claimedA}) is ${aOk ? "TRUE" : "FALSE (actual: " + actualA + ")"}`,
              `Claim B (${mB[1].trim()} = ${claimedB}) is ${bOk ? "TRUE" : "FALSE (actual: " + actualB + ")"}`,
            ],
            summary: `Deterministic arithmetic check verified exact result (${aOk ? actualA : actualB}).`,
            computedValues,
            arbitrationVerdict: {
              winner,
              partyAScore: winner === "partyA" ? 100 : 0,
              partyBScore: winner === "partyB" ? 100 : 0,
            },
          };
        }
      }
    }

    // Universal scientific & chronological constants
    const constants: Array<{
      domain: string;
      keywords: string[];
      truth: number;
      fact: string;
    }> = [
      {
        domain: "physics_water_boiling",
        keywords: ["جوش", "آب"],
        truth: 100,
        fact: "At standard 1 atm sea-level pressure, pure water boils at 100°C.",
      },
      {
        domain: "physics_water_boiling_en",
        keywords: ["water", "boil"],
        truth: 100,
        fact: "At standard 1 atm sea-level pressure, pure water boils at 100°C (212°F).",
      },
      {
        domain: "geometry_triangle_angles",
        keywords: ["مثلث", "زاویه"],
        truth: 180,
        fact: "In Euclidean geometry, interior angles of a triangle always sum to 180°.",
      },
      {
        domain: "chronology_day_hours",
        keywords: ["ساعت", "شبانه‌روز"],
        truth: 24,
        fact: "A standard solar day contains 24 hours.",
      },
    ];

    for (const c of constants) {
      if (c.keywords.every((kw) => combined.includes(kw))) {
        const numsA = extractNumbers(normA);
        const numsB = extractNumbers(normB);
        const aOk = numsA.includes(c.truth);
        const bOk = numsB.includes(c.truth);
        if (aOk !== bOk) {
          const winner = aOk ? "partyA" : "partyB";
          return {
            matched: true,
            domain: c.domain,
            facts: [...facts, c.fact],
            summary: c.fact,
            computedValues,
            arbitrationVerdict: {
              winner,
              partyAScore: winner === "partyA" ? 100 : 0,
              partyBScore: winner === "partyB" ? 100 : 0,
            },
          };
        }
      }
    }

    // Persian orthography (exact letter/dot count)
    if (combined.includes("نقطه") || combined.includes("حرف")) {
      const wordMatch = combined.match(/(?:واژه|کلمه)\s*[«"']?([آ-ی]+)[»"']?/);
      if (wordMatch) {
        const word = wordMatch[1];
        const dots = [...word].reduce((acc, ch) => acc + (PERSIAN_DOT_COUNTS[ch] || 0), 0);
        const letters = word.length;
        facts.push(`Persian word '${word}' has ${letters} letters and ${dots} dots.`);
        const numsA = extractNumbers(normA);
        const numsB = extractNumbers(normB);
        const target = combined.includes("نقطه") ? dots : letters;
        if (numsA.length && numsB.length) {
          const aOk = numsA.includes(target);
          const bOk = numsB.includes(target);
          if (aOk !== bOk) {
            const winner = aOk ? "partyA" : "partyB";
            return {
              matched: true,
              domain: "persian_orthography",
              facts,
              summary: `Verified exact orthographic count (${target}) for '${word}'.`,
              computedValues,
              arbitrationVerdict: {
                winner,
                partyAScore: winner === "partyA" ? 100 : 0,
                partyBScore: winner === "partyB" ? 100 : 0,
              },
            };
          }
        }
      }
    }
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    matched: true,
    domain: "symbolic_math_grounding",
    facts,
    summary: facts.join(" | "),
    computedValues,
  };
}
