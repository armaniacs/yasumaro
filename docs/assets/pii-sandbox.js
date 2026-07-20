"use strict";
var PiiSandbox = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // docs-src/pii-sandbox.ts
  var pii_sandbox_exports = {};
  __export(pii_sandbox_exports, {
    MAX_INPUT_SIZE: () => MAX_INPUT_SIZE,
    sanitize: () => sanitize
  });

  // src/utils/luhn.ts
  function validateLuhn(number) {
    const str = String(number).replace(/\D/g, "");
    if (str.length < 13 || str.length > 19) {
      return false;
    }
    let sum = 0;
    let isEven = false;
    for (let i = str.length - 1; i >= 0; i--) {
      let digit = parseInt(str[i], 10);
      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      isEven = !isEven;
    }
    return sum % 10 === 0;
  }

  // src/utils/errorUtils.ts
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  // src/utils/piiSanitizer.ts
  var MAX_INPUT_SIZE = 64 * 1024;
  var MAX_SKIP_SIZE = 512 * 1024;
  var MAX_OUTPUT_SIZE = 128 * 1024;
  var DEFAULT_TIMEOUT = 5e3;
  var MAX_MATCH_COUNT = 1e3;
  var TIMEOUT_CHECK_INTERVAL = 5;
  var PII_PATTERNS = [
    // メールアドレス（最も具体的）
    {
      type: "email",
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
    },
    // クレジットカード: 16桁または15桁のカード番号（Luhn検証あるので先に検出）
    // 区切り文字を必須にして、数値列との誤検知を抑制
    {
      type: "creditCard",
      pattern: /\b\d{4}(?:[-\s]\d{4}){3}\b/
      // 16桁（4-4-4-4）
    },
    {
      type: "creditCard",
      pattern: /\b\d{4}[-\s]\d{6}[-\s]\d{5}\b/
      // 15桁（区切り2つ）
    },
    // マイナンバー: 12桁（4桁-4桁-4桁、区切り必須）- 連続12桁はdriverLicenseに委譲
    {
      type: "myNumber",
      pattern: /\b\d{4}[-\s]\d{4}[-\s]\d{4}\b/
    },
    // 電話番号: 0 + 1-4桁 + 1-4桁 + 4桁
    {
      type: "phoneJp",
      pattern: /\b0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/
    },
    // 銀行口座: 7桁数字（注: 7桁のみ。driverLicenseの12桁と重複しない）
    {
      type: "bankAccount",
      pattern: /\b\d{7}\b/
    },
    // 運転免許番号（日本）: 連続12桁（myNumberはハイフン区切り必須なので衝突しない）
    {
      type: "driverLicense",
      pattern: /\b\d{12}\b/
    },
    // パスポート番号（日本）: 2文字 + 7桁
    {
      type: "jpPassport",
      pattern: /\b[A-Z]{2}\d{7}\b/
    },
    // IPv4アドレス（プライベートレンジのみ: 10.x.x.x / 172.16-31.x.x / 192.168.x.x）
    // プレフィックス長が異なるため3パターンに分割しバックトラッキングを排除
    {
      type: "ipv4",
      pattern: /\b(?:10\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|172\.(?:1[6-9]|2\d|3[01])\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|192\.168\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?))\b/
    },
    // IPv6アドレス（簡易版）
    {
      type: "ipv6",
      pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/
    },
    // US Social Security Number (SSN): 9桁（3-2-4形式）
    {
      type: "ssn",
      pattern: /\b\d{3}-\d{2}-\d{4}\b/
    },
    // US phone number: (XXX) XXX-XXXX or +1-XXX-XXX-XXXX
    // 桁グループ間の区切りを必須にして、11桁数字列との誤検知を抑制
    {
      type: "phoneUs",
      pattern: /(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/
    },
    // Chinese phone number: +86 or 1[3-9]XXXXXXXXX
    {
      type: "phoneCn",
      pattern: /(?:\+?86[-.\s]?)?1[3-9]\d{9}\b/
    },
    // Chinese ID number: 18 digits (last may be X)
    {
      type: "idCn",
      pattern: /\b\d{17}[\dXx]\b/
    },
    // Korean Resident Registration Number: 6-7 digits (YYMMDD-NGNNNN)
    {
      type: "rrnKr",
      pattern: /\b\d{6}[-.\s]?[1-4]\d{6}\b/
    },
    // Korean phone number: +82 or 01X-XXXX-XXXX
    {
      type: "phoneKr",
      pattern: /(?:\+?82[-.\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/
    },
    // EU IBAN (major countries: DE, FR, IT, ES, NL)
    {
      type: "iban",
      pattern: /\b(?:DE\d{20}|FR\d{2}[A-Z0-9]{23}|IT\d{2}[A-Z0-9]{23}|ES\d{2}[A-Z0-9]{20}|NL\d{2}[A-Z0-9]{14})\b/
    },
    // German tax ID (Steuerliche Identifikationsnummer): 11 digits, first non-zero
    {
      type: "deTaxId",
      pattern: /\b[1-9]\d{10}\b/
    },
    // French INSEE number: 15 digits
    {
      type: "frInsee",
      pattern: /\b\d{15}\b/
    },
    // Italian Codice Fiscale: 16 chars (LLL LLN NN NNN N)
    {
      type: "itCodiceFiscale",
      pattern: /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/
    },
    // Spanish DNI: 8 digits + 1 letter
    {
      type: "esDni",
      pattern: /\b\d{8}[A-Z]\b/
    },
    // Spanish NIE: X/Y/Z + 7 digits + 1 letter
    {
      type: "esNie",
      pattern: /\b[XYZ]\d{7}[A-Z]\b/
    }
  ];
  function validateInputSize(text) {
    if (!text || typeof text !== "string") {
      return { valid: true };
    }
    if (text.length > MAX_INPUT_SIZE) {
      return {
        valid: false,
        error: `Input size exceeds maximum limit of ${MAX_INPUT_SIZE} characters (actual: ${text.length})`
      };
    }
    return { valid: true };
  }
  async function sanitizeRegex(text, options = {}) {
    const { timeout = DEFAULT_TIMEOUT, skipSizeLimit = false, includeIndices = false } = options;
    if (!text || typeof text !== "string") {
      return { text: "", maskedItems: [] };
    }
    if (!skipSizeLimit) {
      const sizeValidation = validateInputSize(text);
      if (!sizeValidation.valid) {
        return {
          text,
          maskedItems: [],
          error: sizeValidation.error
        };
      }
    } else {
      if (text.length > MAX_SKIP_SIZE) {
        return {
          text,
          maskedItems: [],
          error: `Input size exceeds maximum limit of ${MAX_SKIP_SIZE} characters even with skipSizeLimit (actual: ${text.length})`
        };
      }
    }
    const startTime = Date.now();
    try {
      const _maskedItems = [];
      const replacements = [];
      const typeGroups = [];
      const seenTypes = /* @__PURE__ */ new Set();
      for (const { type } of PII_PATTERNS) {
        if (seenTypes.has(type)) continue;
        seenTypes.add(type);
        const patternsForType = PII_PATTERNS.filter((p) => p.type === type).map((p) => `(?:${p.pattern.source})`);
        typeGroups.push(`(?<${type}>${patternsForType.join("|")})`);
      }
      const combinedRegex = new RegExp(typeGroups.join("|"), "g");
      let match;
      let matchCount = 0;
      while ((match = combinedRegex.exec(text)) !== null) {
        matchCount++;
        if (matchCount % TIMEOUT_CHECK_INTERVAL === 0 && Date.now() - startTime > timeout) {
          throw new Error(`Operation timed out after ${timeout}ms`);
        }
        if (matchCount > MAX_MATCH_COUNT) {
          throw new Error(`Operation exceeded maximum match count of ${MAX_MATCH_COUNT}`);
        }
        const matchedValue = match[0];
        const startIndex = match.index;
        let matchedType = "unknown";
        if (match.groups) {
          for (const type of Object.keys(match.groups)) {
            if (match.groups[type]) {
              matchedType = type;
              break;
            }
          }
        }
        if (matchedType === "creditCard" && !validateLuhn(matchedValue)) {
          continue;
        }
        replacements.push({
          index: startIndex,
          length: matchedValue.length,
          mask: `[MASKED:${matchedType}]`,
          type: matchedType,
          original: matchedValue
        });
      }
      replacements.sort((a, b) => b.length - a.length);
      const resolvedReplacements = [];
      const usedRanges = [];
      for (const r of replacements) {
        const rStart = r.index;
        const rEnd = r.index + r.length;
        const overlaps = usedRanges.some((range) => !(rEnd <= range.start || rStart >= range.end));
        if (!overlaps) {
          resolvedReplacements.push(r);
          usedRanges.push({ start: rStart, end: rEnd });
        }
      }
      resolvedReplacements.sort((a, b) => b.index - a.index);
      let processedText = text;
      const finalMaskedItems = [];
      const textParts = processedText.split("");
      for (const r of resolvedReplacements) {
        for (let i = 0; i < r.length; i++) {
          if (i === 0) {
            textParts[r.index] = r.mask;
          } else {
            textParts[r.index + i] = "";
          }
        }
        finalMaskedItems.push({ type: r.type, original: r.original, index: r.index });
      }
      processedText = textParts.join("");
      finalMaskedItems.sort((a, b) => (a.index || 0) - (b.index || 0));
      const resultItems = finalMaskedItems.map(
        (item) => includeIndices ? { type: item.type, original: item.original, index: item.index } : { type: item.type, original: item.original }
      );
      const outputSize = processedText.length;
      if (outputSize > MAX_OUTPUT_SIZE) {
        processedText = processedText.substring(0, MAX_OUTPUT_SIZE);
        const trimmedMaskedItems = finalMaskedItems.filter(
          (item) => (item.index || 0) < MAX_OUTPUT_SIZE
        );
        return {
          text: processedText,
          maskedItems: trimmedMaskedItems.map(
            (item) => includeIndices ? { type: item.type, original: item.original, index: item.index } : { type: item.type, original: item.original }
          ),
          error: `Output truncated to ${MAX_OUTPUT_SIZE} characters`
        };
      }
      return { text: processedText, maskedItems: resultItems };
    } catch (error) {
      return {
        text: "[SANITIZATION_FAILED]",
        maskedItems: [],
        error: errorMessage(error)
      };
    }
  }

  // docs-src/pii-sandbox.ts
  async function sanitize(text) {
    const start = performance.now();
    const result = await sanitizeRegex(text, { includeIndices: true });
    const durationMs = Math.round(performance.now() - start);
    return { ...result, durationMs };
  }
  return __toCommonJS(pii_sandbox_exports);
})();
