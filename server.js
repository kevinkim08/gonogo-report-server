import express from "express"
import cors from "cors"
import crypto from "crypto"
import OpenAI from "openai"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json({ limit: "5mb" }))
app.use(express.urlencoded({ extended: true }))

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
)

app.options("*", cors())

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const paidDownloadTokens = new Map()

function createPaidDownloadToken(payload = {}) {
  const token = crypto.randomBytes(24).toString("hex")

  paidDownloadTokens.set(token, {
    paid: true,
    downloadLimit: 3,
    downloadCount: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    payload,
  })

  return token
}

function validatePaidDownloadToken(token) {
  if (!token) {
    return { ok: false, status: 401, message: "Missing download token." }
  }

  const record = paidDownloadTokens.get(token)

  if (!record || !record.paid) {
    return { ok: false, status: 403, message: "Invalid payment token." }
  }

  if (Date.now() > record.expiresAt) {
    return { ok: false, status: 403, message: "This download link has expired." }
  }

  if (record.downloadCount >= record.downloadLimit) {
    return { ok: false, status: 403, message: "Download limit exceeded." }
  }

  return { ok: true, record }
}

function normalizeLanguage(lang) {
  const supported = ["ko", "en", "ja", "zh", "mn"]
  return supported.includes(lang) ? lang : "en"
}

function getLanguageName(lang) {
  const map = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
    mn: "Mongolian",
  }

  return map[normalizeLanguage(lang)] || "English"
}

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function safeArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback
}

function toScore(value, fallback = 50) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(100, Math.round(n)))
}

function sanitizeFileName(value = "Report") {
  return String(value || "Report")
    .replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ一-龥ぁ-んァ-ン.\-]+/g, "_")
    .slice(0, 80)
}

function getCopy(lang) {
  const copy = {
    ko: {
      loadingTitle: "보고서를 만들고 있어",
      loadingDesc: "시장 위험, 고객 구매 이유, 수익 구조, 실행 가능성을 분석하는 중이야.",
      loadingSteps: [
        "사업 아이디어 구조 분석 중",
        "고객 구매 가능성 계산 중",
        "시장·경쟁 리스크 확인 중",
        "수익 구조와 실행 조건 정리 중",
        "최종 Go / No-Go 판단 생성 중",
      ],
      back: "GoNoGo로 돌아가기",
      premiumKicker: "PREMIUM REPORT",
      premiumTitle: "65%까지만 열렸어. 진짜 판단은 아직 잠겨있어.",
      premiumDesc: "무료 보고서는 첫 판단 신호만 보여줘. 유료 보고서는 고객 구매 논리, 수익 구조, 리스크, 실행 전략까지 열어줘.",
      cta: "이 사업 계속 진행해도 되는지 확인하기",
      ctaSub: "돈 쓰기 전에 고객, 시장, 수익 구조를 먼저 검증해.",
      locked: "잠긴 판단 레이어",
      urgency: "지금 검증하지 않으면 잘못된 방향으로 몇 달을 쓸 수 있어.",
      score: "점수",
      currentDecision: "현재 판단",
      freeUnlocked: "무료 판단 열림",
      completion: "보고서 완성도",
      download: "유료 PDF 다운로드",
      tokenCreated: "테스트 결제 토큰 생성 완료",
      tokenDesc: "PayPal 연결 전 테스트용 다운로드 링크야.",
    },
    en: {
      loadingTitle: "Building your decision report",
      loadingDesc: "Analyzing market risk, customer logic, profit structure, and execution signals.",
      loadingSteps: [
        "Reading your business idea",
        "Checking customer buying logic",
        "Mapping market and competition risk",
        "Calculating profit structure",
        "Generating your Go / No-Go decision",
      ],
      back: "Back to GoNoGo",
      premiumKicker: "PREMIUM REPORT",
      premiumTitle: "You are 65% done. The real decision is locked.",
      premiumDesc: "The free report shows the first decision signal. The full report unlocks customer logic, profit structure, risk judgment, and execution strategy.",
      cta: "Check if this business is worth continuing",
      ctaSub: "Validate customer, market, and profit logic before spending money.",
      locked: "Locked decision layer",
      urgency: "If you validate this too late, you may spend months building the wrong business.",
      score: "Score",
      currentDecision: "Current Decision",
      freeUnlocked: "Free decision unlocked",
      completion: "Report Completion",
      download: "Download Paid PDF",
      tokenCreated: "Paid token created",
      tokenDesc: "Temporary test link before PayPal integration.",
    },
    ja: {
      loadingTitle: "レポートを生成しています",
      loadingDesc: "市場リスク、顧客心理、収益構造、実行可能性を分析しています。",
      loadingSteps: ["事業アイデアを分析中", "顧客の購入理由を確認中", "市場と競合リスクを確認中", "収益構造を整理中", "Go / No-Go 判断を生成中"],
      back: "GoNoGoに戻る",
      premiumKicker: "PREMIUM REPORT",
      premiumTitle: "65%まで完了。重要な判断はまだロックされています。",
      premiumDesc: "無料版は最初の判断だけを表示します。有料版では顧客、収益、リスク、実行計画を確認できます。",
      cta: "この事業を続けるべきか確認する",
      ctaSub: "費用を使う前に、顧客・市場・収益構造を検証してください。",
      locked: "ロックされた判断レイヤー",
      urgency: "検証が遅れると、間違った方向に数か月使う可能性があります。",
      score: "スコア",
      currentDecision: "現在の判断",
      freeUnlocked: "無料判断を表示",
      completion: "レポート完成度",
      download: "有料PDFをダウンロード",
      tokenCreated: "有料トークン作成完了",
      tokenDesc: "PayPal連携前のテストリンクです。",
    },
    zh: {
      loadingTitle: "正在生成决策报告",
      loadingDesc: "正在分析市场风险、客户逻辑、盈利结构和执行条件。",
      loadingSteps: [
        "分析商业想法结构",
        "判断客户购买动机",
        "检查市场与竞争风险",
        "整理盈利结构",
        "生成 Go / No-Go 判断",
      ],
      back: "返回 GoNoGo",
      premiumKicker: "高级报告",
      premiumTitle: "已完成 65%，关键判断仍被锁定。",
      premiumDesc: "免费报告只显示初步判断，完整报告包含客户逻辑、利润结构、风险与执行策略。",
      cta: "查看这个业务是否值得继续",
      ctaSub: "在花钱之前，先验证客户、市场和盈利逻辑。",
      locked: "已锁定的决策层",
      urgency: "如果现在不验证，可能会浪费数月时间在错误方向上。",
      score: "评分",
      currentDecision: "当前判断",
      freeUnlocked: "免费判断已解锁",
      completion: "报告完成度",
      download: "下载付费PDF",
      tokenCreated: "已创建付费令牌",
      tokenDesc: "PayPal接入前的测试下载链接。",
    },
    mn: {
      loadingTitle: "Тайлан боловсруулж байна",
      loadingDesc: "Зах зээл, хэрэглэгч, ашиг, эрсдэлийг шинжилж байна.",
      loadingSteps: [
        "Бизнес санааг шинжилж байна",
        "Хэрэглэгчийн логик шалгаж байна",
        "Зах зээл ба өрсөлдөөн шалгаж байна",
        "Ашгийн бүтэц тооцоолж байна",
        "Go / No-Go шийдвэр гаргаж байна",
      ],
      back: "GoNoGo руу буцах",
      premiumKicker: "ПРЕМИУМ ТАЙЛАН",
      premiumTitle: "65% дууссан. Гол шийдвэр түгжээтэй байна.",
      premiumDesc: "Үнэгүй тайлан эхний дохиог харуулна. Бүрэн тайлан нь хэрэглэгч, ашиг, эрсдэл, гүйцэтгэлийг нээнэ.",
      cta: "Энэ бизнесийг үргэлжлүүлэх эсэхийг шалгах",
      ctaSub: "Мөнгө зарцуулахаас өмнө зах зээл, хэрэглэгч, ашгийг шалга.",
      locked: "Түгжээтэй хэсэг",
      urgency: "Хэрэв одоо шалгахгүй бол буруу чиглэлд саруудыг алдах магадлалтай.",
      score: "Оноо",
      currentDecision: "Одоогийн шийдвэр",
      freeUnlocked: "Үнэгүй хэсэг нээгдсэн",
      completion: "Тайлангийн гүйцэтгэл",
      download: "Төлбөртэй PDF татах",
      tokenCreated: "Токен үүссэн",
      tokenDesc: "PayPal холбохоос өмнөх тест линк.",
    },
  }

  return copy[normalizeLanguage(lang)] || copy.en
}
function buildFreeReportPrompt({ brandName, productService, targetCustomer, language }) {
  const languageName = getLanguageName(language)

  return `
You are GoNoGo, a business decision engine.

Generate a SHORT free business decision preview.

Final language: ${languageName}

Business Input:
- Business Idea Title: ${brandName}
- Product / Service: ${productService}
- Target Customer: ${targetCustomer}

Rules:
- Output VALID JSON only.
- No markdown.
- No explanation outside JSON.
- Keep all fields short.
- Max 2 sentences per text field.
- Do not use line breaks inside JSON string values.
- Do not use trailing commas.
- Escape all double quotes inside string values.
- Every string value must be JSON-safe.
- Be direct, conservative, and decision-oriented.
- This is a FREE preview, not a full report.
- All user-facing values must be written in ${languageName}.
- Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.

Return ONLY this JSON structure:

{
  "cover": {
    "brandName": "${brandName}",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },
  "businessDiagnosis": {
    "industryType": "",
    "businessModelType": "",
    "countryMarketBehavior": "",
    "marketEntryDifficulty": "LOW | MEDIUM | HIGH",
    "mainBottleneck": "",
    "bestFirstOffer": "",
    "validationExperiment": "",
    "goNoGoLogic": "",
    "structureSummary": ""
  },
  "visualScores": {
    "market": 0,
    "profitability": 0,
    "execution": 0,
    "risk": 0
  },
  "decisionMatrix": [
    ["MARKET", "LOW | MEDIUM | HIGH"],
    ["PROFITABILITY", "LOW | MEDIUM | HIGH"],
    ["EXECUTION", "LOW | MEDIUM | HIGH"],
    ["RISK", "LOW | MEDIUM | HIGH"]
  ],
  "executiveDecision": [
    ["Why this works", ""],
    ["Why this fails", ""],
    ["What to do now", ""]
  ],
  "marketCards": [
    ["TAM", ""],
    ["SAM", ""],
    ["SOM", ""],
    ["GROWTH", ""]
  ],
  "marketFunnel": [
    { "label": "TAM", "value": "", "score": 100 },
    { "label": "SAM", "value": "", "score": 60 },
    { "label": "SOM", "value": "", "score": 20 }
  ],
  "customerSummary": ""
}
`
}

function buildPaidReportPrompt({ brandName, productService, targetCustomer, language }) {
  const languageName = getLanguageName(language)

  return `
You are GoNoGo, a ruthless business decision engine.

Evaluate this business idea and generate a premium PDF-ready JSON report.

Final report language: ${languageName}

Business Input:
- Business Idea Title: ${brandName}
- Product / Service: ${productService}
- Target Customer: ${targetCustomer}
- Language / Market: ${language}

Critical rules:
1. Output VALID JSON only.
2. No markdown.
3. No explanation outside JSON.
4. Do not use placeholders.
5. Use realistic conservative assumptions when exact data is unavailable.
6. All scores must be numbers from 0 to 100.
7. Keep table cells concise.
8. Narrative fields must be useful for founder decision-making.
9. Escape all double quotes inside string values.
10. Do not use unescaped quotation marks inside any JSON string.
11. Do not use line breaks inside JSON string values.
12. Do not use trailing commas.
13. Every string value must be valid JSON-safe text.
14. All user-facing values must be written in ${languageName}.
15. Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.

Country strategy:
- ko: Korea-first. Consider Naver, Kakao, Coupang, SmartStore, Instagram, YouTube Shorts, Korean price sensitivity.
- en: Global English market. Consider Google, Meta, Amazon, Shopify, TikTok, Reddit, DTC funnel.
- ja: Japan-first. Consider LINE, Rakuten, Yahoo Japan, Amazon JP, trust-heavy purchase behavior.
- zh: Chinese-speaking market. Consider WeChat, Xiaohongshu, Douyin, Tmall, KOL/KOC.
- mn: Mongolia-first. Consider Facebook commerce, bank transfer, offline trust, messenger sales.

Return ONLY this JSON structure:

{
  "cover": {
    "brandName": "${brandName}",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },
  "brandNaming": {
    "brandDirection": "",
    "namingStrategy": "",
    "keywords": ["", "", "", "", "", "", "", ""],
    "nameCandidates": [
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 }
    ],
    "recommendedName": {
      "name": "",
      "reason": "",
      "positioning": "",
      "expansionPotential": ""
    },
    "domainSuggestions": [
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" }
    ]
  },
  "businessDiagnosis": {
    "industryType": "",
    "businessModelType": "",
    "countryMarketBehavior": "",
    "marketEntryDifficulty": "LOW | MEDIUM | HIGH",
    "mainBottleneck": "",
    "bestFirstOffer": "",
    "validationExperiment": "",
    "goNoGoLogic": "",
    "structureSummary": ""
  },
  "visualScores": {
    "market": 0,
    "profitability": 0,
    "execution": 0,
    "risk": 0
  },
  "decisionMatrix": [
    ["MARKET", "LOW | MEDIUM | HIGH"],
    ["PROFITABILITY", "LOW | MEDIUM | HIGH"],
    ["EXECUTION", "LOW | MEDIUM | HIGH"],
    ["RISK", "LOW | MEDIUM | HIGH"]
  ],
  "executiveDecision": [
    ["Why this works", ""],
    ["Why this fails", ""],
    ["What to do now", ""]
  ],
  "founderDecision": "",
  "marketCards": [
    ["TAM", ""],
    ["SAM", ""],
    ["SOM", ""],
    ["GROWTH", ""]
  ],
  "marketFunnel": [
    { "label": "TAM", "value": "", "score": 100 },
    { "label": "SAM", "value": "", "score": 60 },
    { "label": "SOM", "value": "", "score": 20 }
  ],
  "tamSamSom": [
    ["TAM", "", "", ""],
    ["SAM", "", "", ""],
    ["SOM", "", "", ""]
  ],
  "marketInsight": "",
  "customerTruth": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "customerOpportunity": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "buyingTrigger": "",
  "customerSummary": "",
  "competitionMap": [
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""]
  ],
  "competitionConclusion": "",
  "unitEconomicsCards": [
    ["CAC", ""],
    ["LTV", ""],
    ["AOV", ""],
    ["REPEAT", ""]
  ],
  "unitEconomicsScore": {
    "ltvToCac": "",
    "payback": "",
    "margin": "",
    "status": "PASS | WATCH | FAIL"
  },
  "unitEconomicsTable": [
    ["CAC", "", "", ""],
    ["LTV", "", "", ""],
    ["AOV", "", "", ""],
    ["Repeat", "", "", ""]
  ],
  "economicsJudgment": "",
  "marketingStrategy": {
    "channelFit": [
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""]
    ],
    "contentPlaybook": ["", "", "", "", ""],
    "thirtyDayMarketingTest": [
      ["Week 1", "", ""],
      ["Week 2", "", ""],
      ["Week 3", "", ""],
      ["Week 4", "", ""],
      ["Week 5", "", ""],
      ["Week 6", "", ""],
      ["Week 7", "", ""],
      ["Week 8", "", ""],
      ["Week 9", "", ""],
      ["Week 10", "", ""],
      ["Week 11", "", ""],
      ["Week 12", "", ""]
    ]
  },
  "businessModel": {
    "revenueLayers": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "modelJudgment": "",
    "modelDeepDive": ""
  },
  "riskSystem": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "executionPlan": [
    ["Phase 1", "", ""],
    ["Phase 2", "", ""],
    ["Phase 3", "", ""]
  ],
  "operatingRule": "",
  "goThreshold": [
    ["CAC", "", ""],
    ["Conversion", "", ""],
    ["Repeat", "", ""],
    ["Margin", "", ""]
  ],
  "goChecklist": [
    { "label": "CAC", "status": "PASS | WATCH | FAIL" },
    { "label": "Conversion", "status": "PASS | WATCH | FAIL" },
    { "label": "Repeat Purchase", "status": "PASS | WATCH | FAIL" },
    { "label": "Margin", "status": "PASS | WATCH | FAIL" }
  ],
  "finalRule": "",
  "dataConfidence": {
    "overallLevel": "LOW | MEDIUM | HIGH",
    "summary": "",
    "sourceQuality": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "limits": ["", "", ""]
  },
  "sensitivityAnalysis": {
    "cacLtvTable": [
      ["Low CAC", "", "", ""],
      ["Base CAC", "", "", ""],
      ["High CAC", "", "", ""]
    ],
    "criticalBreakPoint": "",
    "founderWarning": ""
  },
  "profitSimulation": {
    "monthlyScenarioTable": [
      ["Conservative", "", "", "", "", ""],
      ["Base", "", "", "", "", ""],
      ["Aggressive", "", "", "", "", ""]
    ],
    "breakEvenPoint": "",
    "profitJudgment": "",
    "cashRisk": ""
  },
  "killCriteria": {
    "rules": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "stopDecision": "",
    "pivotDecision": "",
    "scaleDecision": ""
  },
  "appendix": {
    "dataSources": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "assumptions": ["", "", "", ""]
  },
  "referenceLinks": [
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""]
  ]
}
`
}
async function generateDeepReportJson(input) {
  const { brandName, productService, targetCustomer, language } = input
  const reportType = input.reportType === "paid" ? "paid" : "free"

  const systemPrompt =
    reportType === "free"
      ? buildFreeReportPrompt(input)
      : buildPaidReportPrompt(input)

  const userPrompt = JSON.stringify({
    brandName,
    productService,
    targetCustomer,
    language,
    reportType,
  })

  const model =
    reportType === "paid"
      ? process.env.OPENAI_PAID_MODEL || "gpt-4.1"
      : process.env.OPENAI_FREE_MODEL || "gpt-4.1-mini"

  console.log("[REPORT_TYPE]", reportType)
  console.log("[OPENAI_MODEL]", model)

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
  })

  const raw = completion.choices?.[0]?.message?.content
  if (!raw) throw new Error("Empty OpenAI response.")

  let parsed

  try {
    parsed = JSON.parse(raw)
  } catch (parseError) {
    console.error("[OPENAI_JSON_PARSE_ERROR]", parseError)
    console.error("[OPENAI_JSON_RAW_START]", raw.slice(0, 1200))
    console.error("[OPENAI_JSON_RAW_ERROR_AREA]", raw.slice(8000, 9800))
    console.error("[OPENAI_JSON_RAW_END]", raw.slice(-1200))

    throw new Error(
      `OpenAI returned invalid JSON. ${String(parseError?.message || parseError)}`
    )
  }

  return normalizeDeepReport(parsed, {
    brandName,
    productService,
    targetCustomer,
    language,
    reportType,
  })
}

function normalizeDeepReport(report, input) {
  const isPaid = input.reportType === "paid"

  return {
    cover: {
      brandName: report?.cover?.brandName || input.brandName || "",
      decision: report?.cover?.decision || "HOLD",
      score: toScore(report?.cover?.score, 50),
      subtitle: report?.cover?.subtitle || input.productService || "",
      oneLineVerdict: report?.cover?.oneLineVerdict || "",
    },

    brandNaming: {
      brandDirection: report?.brandNaming?.brandDirection || "",
      namingStrategy: report?.brandNaming?.namingStrategy || "",
      keywords: safeArray(report?.brandNaming?.keywords, []).slice(0, 8),
      nameCandidates: safeArray(report?.brandNaming?.nameCandidates, []).slice(0, 5),
      recommendedName: {
        name: report?.brandNaming?.recommendedName?.name || "",
        reason: report?.brandNaming?.recommendedName?.reason || "",
        positioning: report?.brandNaming?.recommendedName?.positioning || "",
        expansionPotential:
          report?.brandNaming?.recommendedName?.expansionPotential || "",
      },
      domainSuggestions: safeArray(
        report?.brandNaming?.domainSuggestions,
        []
      ).slice(0, 5),
    },

    businessDiagnosis: {
      industryType: report?.businessDiagnosis?.industryType || "",
      businessModelType: report?.businessDiagnosis?.businessModelType || "",
      countryMarketBehavior:
        report?.businessDiagnosis?.countryMarketBehavior || "",
      marketEntryDifficulty:
        report?.businessDiagnosis?.marketEntryDifficulty || "MEDIUM",
      mainBottleneck: report?.businessDiagnosis?.mainBottleneck || "",
      bestFirstOffer: report?.businessDiagnosis?.bestFirstOffer || "",
      validationExperiment:
        report?.businessDiagnosis?.validationExperiment || "",
      goNoGoLogic: report?.businessDiagnosis?.goNoGoLogic || "",
      structureSummary: report?.businessDiagnosis?.structureSummary || "",
    },

    visualScores: {
      market: toScore(report?.visualScores?.market, 50),
      profitability: toScore(report?.visualScores?.profitability, 50),
      execution: toScore(report?.visualScores?.execution, 50),
      risk: toScore(report?.visualScores?.risk, 50),
    },

    decisionMatrix: safeArray(report?.decisionMatrix, [
      ["MARKET", "MEDIUM"],
      ["PROFITABILITY", "MEDIUM"],
      ["EXECUTION", "MEDIUM"],
      ["RISK", "MEDIUM"],
    ]).slice(0, 4),

    executiveDecision: safeArray(report?.executiveDecision, [
      ["Why this works", ""],
      ["Why this fails", ""],
      ["What to do now", ""],
    ]).slice(0, 3),

    founderDecision: report?.founderDecision || "",

    marketCards: safeArray(report?.marketCards, [
      ["TAM", ""],
      ["SAM", ""],
      ["SOM", ""],
      ["GROWTH", ""],
    ]).slice(0, 4),

    marketFunnel: safeArray(report?.marketFunnel, [
      { label: "TAM", value: "", score: 100 },
      { label: "SAM", value: "", score: 60 },
      { label: "SOM", value: "", score: 20 },
    ]).slice(0, 3),

    tamSamSom: safeArray(report?.tamSamSom, [
      ["TAM", "", "", ""],
      ["SAM", "", "", ""],
      ["SOM", "", "", ""],
    ]).slice(0, 3),

    marketInsight: report?.marketInsight || "",
    customerTruth: safeArray(report?.customerTruth, []).slice(0, 3),
    customerOpportunity: safeArray(report?.customerOpportunity, []).slice(0, 4),
    buyingTrigger: report?.buyingTrigger || "",
    customerSummary: report?.customerSummary || "",

    competitionMap: safeArray(report?.competitionMap, []).slice(0, 4),
    competitionConclusion: report?.competitionConclusion || "",

    unitEconomicsCards: safeArray(report?.unitEconomicsCards, [
      ["CAC", ""],
      ["LTV", ""],
      ["AOV", ""],
      ["REPEAT", ""],
    ]).slice(0, 4),

    unitEconomicsScore: {
      ltvToCac: report?.unitEconomicsScore?.ltvToCac || "",
      payback: report?.unitEconomicsScore?.payback || "",
      margin: report?.unitEconomicsScore?.margin || "",
      status: report?.unitEconomicsScore?.status || "WATCH",
    },
        unitEconomicsTable: safeArray(report?.unitEconomicsTable, []).slice(0, 4),
    economicsJudgment: report?.economicsJudgment || "",

    marketingStrategy: {
      channelFit: safeArray(report?.marketingStrategy?.channelFit, []).slice(0, 4),
      contentPlaybook: safeArray(
        report?.marketingStrategy?.contentPlaybook,
        []
      ).slice(0, 5),
      thirtyDayMarketingTest: safeArray(
        report?.marketingStrategy?.thirtyDayMarketingTest,
        []
      ).slice(0, 12),
    },

    businessModel: {
      revenueLayers: safeArray(report?.businessModel?.revenueLayers, []).slice(0, 3),
      modelJudgment: report?.businessModel?.modelJudgment || "",
      modelDeepDive: report?.businessModel?.modelDeepDive || "",
    },

    riskSystem: safeArray(report?.riskSystem, []).slice(0, 3),
    executionPlan: safeArray(report?.executionPlan, []).slice(0, 3),
    operatingRule: report?.operatingRule || "",

    goThreshold: safeArray(report?.goThreshold, []).slice(0, 4),
    goChecklist: safeArray(report?.goChecklist, [
      { label: "CAC", status: "WATCH" },
      { label: "Conversion", status: "WATCH" },
      { label: "Repeat Purchase", status: "WATCH" },
      { label: "Margin", status: "WATCH" },
    ]).slice(0, 4),

    finalRule: report?.finalRule || "",

    dataConfidence: {
      overallLevel: report?.dataConfidence?.overallLevel || "MEDIUM",
      summary: report?.dataConfidence?.summary || "",
      sourceQuality: safeArray(
        report?.dataConfidence?.sourceQuality,
        []
      ).slice(0, 3),
      limits: safeArray(report?.dataConfidence?.limits, []).slice(0, 3),
    },

    sensitivityAnalysis: {
      cacLtvTable: safeArray(
        report?.sensitivityAnalysis?.cacLtvTable,
        []
      ).slice(0, 3),
      criticalBreakPoint:
        report?.sensitivityAnalysis?.criticalBreakPoint || "",
      founderWarning: report?.sensitivityAnalysis?.founderWarning || "",
    },

    profitSimulation: {
      monthlyScenarioTable: safeArray(
        report?.profitSimulation?.monthlyScenarioTable,
        []
      ).slice(0, 3),
      breakEvenPoint: report?.profitSimulation?.breakEvenPoint || "",
      profitJudgment: report?.profitSimulation?.profitJudgment || "",
      cashRisk: report?.profitSimulation?.cashRisk || "",
    },

    killCriteria: {
      rules: safeArray(report?.killCriteria?.rules, []).slice(0, 4),
      stopDecision: report?.killCriteria?.stopDecision || "",
      pivotDecision: report?.killCriteria?.pivotDecision || "",
      scaleDecision: report?.killCriteria?.scaleDecision || "",
    },

    appendix: {
      dataSources: safeArray(report?.appendix?.dataSources, []).slice(0, 3),
      assumptions: safeArray(report?.appendix?.assumptions, []).slice(0, 4),
    },

    referenceLinks: safeArray(report?.referenceLinks, []).slice(0, 5),

    isPaid,
    reportMode: isPaid ? "paid" : "free",
  }
}

function buildFreeReportFromPaidReport(report) {
  return {
    ...report,
    isPaid: false,
    reportMode: "free",
    lockedSections: {
      tamSamSom: true,
      competition: true,
      unitEconomics: true,
      marketing: true,
      risk: true,
      execution: true,
      goThreshold: true,
      message:
        "The free report shows the first decision signal. Full customer logic, market reality, profit structure, risk system, and execution plan are available in the paid report.",
    },
  }
}

function objectFromPairs(rows = []) {
  const out = {}
  for (const row of safeArray(rows, [])) {
    if (Array.isArray(row) && row.length >= 2) {
      out[String(row[0]).toUpperCase()] = row[1]
    }
  }
  return out
}

function rows(table = []) {
  return safeArray(table, [])
    .map((row) => {
      const cells = safeArray(row, [])
        .map((cell) => `<td>${esc(cell)}</td>`)
        .join("")
      return `<tr>${cells}</tr>`
    })
    .join("")
}

function listItems(items = []) {
  return safeArray(items, [])
    .map((item) => `<li>${esc(item)}</li>`)
    .join("")
}

function statusClass(value = "") {
  const v = String(value).toUpperCase()
  if (v.includes("GO") && !v.includes("NO")) return "go"
  if (v.includes("NO")) return "nogo"
  return "hold"
}

function scoreClass(score = 0) {
  const n = toScore(score, 50)
  if (n >= 75) return "good"
  if (n >= 50) return "watch"
  return "bad"
}

function levelClass(value = "") {
  const v = String(value).toUpperCase()
  if (v.includes("LOW")) return "good"
  if (v.includes("HIGH")) return "bad"
  return "watch"
}
function buildDecisionChart(report) {
  const scores = report.visualScores || {}
  const items = [
    ["Market", toScore(scores.market, 50)],
    ["Profit", toScore(scores.profitability, 50)],
    ["Execution", toScore(scores.execution, 50)],
    ["Risk", toScore(scores.risk, 50)],
  ]

  return `
<div class="score-grid">
  ${items
    .map(
      ([label, value]) => `
    <div class="score-card">
      <div class="score-card-label">${esc(label)}</div>
      <div class="score-card-value">${esc(value)}</div>
      <div class="score-bar">
        <div class="score-bar-fill ${scoreClass(value)}" style="width:${value}%"></div>
      </div>
    </div>
  `
    )
    .join("")}
</div>
`
}

function buildReportHtml(report, lang = "en") {
  const c = getCopy(lang)

  const matrix = objectFromPairs(report.decisionMatrix)
  const market = objectFromPairs(report.marketCards)
  const unit = objectFromPairs(report.unitEconomicsCards)

  const execRows = safeArray(report.executiveDecision, [])
  const whyWorks = execRows?.[0]?.[1] || ""
  const whyFails = execRows?.[1]?.[1] || ""
  const whatNow = execRows?.[2]?.[1] || ""

  const isFree = report.reportMode === "free"

  const premiumSection = isFree ? buildPremiumSection(report, lang) : ""
  const backButton = injectReportBackButton(lang)

  return `
<!doctype html>
<html lang="${esc(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>GoNoGo Report</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: #f7faf8;
      color: #0D2418;
      font-family: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      line-height: 1.45;
    }

    .page {
      width: 100%;
      max-width: 980px;
      margin: 0 auto;
      padding: 42px 22px;
    }

    .cover {
      min-height: 92vh;
      display: flex;
      align-items: center;
    }

    .cover-card {
      width: 100%;
      border: 1px solid rgba(13,36,24,0.12);
      background: rgba(255,255,255,0.9);
      border-radius: 34px;
      padding: 34px;
      box-shadow: 0 32px 90px rgba(13,36,24,0.10);
    }

    .kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 950;
      letter-spacing: -0.02em;
      background: #0D2418;
      color: #B6FF5A;
      padding: 9px 13px;
      border-radius: 999px;
      margin-bottom: 22px;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #B6FF5A;
      box-shadow: 0 0 16px rgba(182,255,90,0.9);
    }

    h1 {
      font-size: 64px;
      line-height: 0.94;
      letter-spacing: -0.075em;
      margin: 0 0 18px;
      font-weight: 950;
    }

    .subtitle {
      font-size: 18px;
      line-height: 1.6;
      color: #53645A;
      margin: 0 0 26px;
      max-width: 700px;
      font-weight: 650;
    }

    .verdict {
      font-size: 22px;
      line-height: 1.4;
      font-weight: 900;
      margin: 22px 0 0;
      max-width: 760px;
    }

    .decision-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 26px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 48px;
      border-radius: 999px;
      padding: 0 20px;
      font-size: 14px;
      font-weight: 950;
      border: 1px solid rgba(13,36,24,0.12);
      background: #fff;
    }

    .pill.go {
      background: #0D2418;
      color: #B6FF5A;
    }

    .pill.hold {
      background: #fff8db;
      color: #624900;
    }

    .pill.nogo {
      background: #fff0f0;
      color: #8a1f1f;
    }

    .section {
      background: #fff;
      border: 1px solid rgba(13,36,24,0.10);
      border-radius: 28px;
      padding: 28px;
      margin-bottom: 22px;
      box-shadow: 0 16px 48px rgba(13,36,24,0.05);
    }

    .section-title {
      font-size: 30px;
      line-height: 1.05;
      letter-spacing: -0.055em;
      font-weight: 950;
      margin: 0 0 16px;
    }

    .section-desc {
      font-size: 14px;
      line-height: 1.65;
      color: #53645A;
      font-weight: 650;
      margin: 0 0 18px;
    }
        .card-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .mini-card {
      background: #f7faf8;
      border: 1px solid rgba(13,36,24,0.10);
      border-radius: 18px;
      padding: 16px;
      min-height: 110px;
    }

    .mini-label {
      font-size: 11px;
      font-weight: 950;
      color: #53645A;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .mini-value {
      font-size: 18px;
      line-height: 1.25;
      font-weight: 950;
      letter-spacing: -0.04em;
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .score-card {
      background: #f7faf8;
      border: 1px solid rgba(13,36,24,0.10);
      border-radius: 18px;
      padding: 16px;
    }

    .score-card-label {
      font-size: 11px;
      font-weight: 950;
      color: #53645A;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .score-card-value {
      font-size: 32px;
      line-height: 1;
      font-weight: 950;
      letter-spacing: -0.06em;
      margin-bottom: 12px;
    }

    .score-bar {
      height: 9px;
      background: #e4ece7;
      border-radius: 999px;
      overflow: hidden;
    }

    .score-bar-fill {
      height: 100%;
      border-radius: 999px;
      background: #0D2418;
    }

    .score-bar-fill.good {
      background: #2f7d57;
    }

    .score-bar-fill.watch {
      background: #c68b00;
    }

    .score-bar-fill.bad {
      background: #b42318;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      overflow: hidden;
      border-radius: 18px;
      font-size: 13px;
      background: #fff;
    }

    td, th {
      border: 1px solid rgba(13,36,24,0.10);
      padding: 12px;
      vertical-align: top;
    }

    th {
      background: #0D2418;
      color: #fff;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .callout {
      background: #f3f8f5;
      border-left: 5px solid #2f7d57;
      border-radius: 18px;
      padding: 18px;
      font-size: 15px;
      line-height: 1.65;
      font-weight: 750;
    }

    .warning {
      background: #fff3f3;
      border-left: 5px solid #b42318;
      color: #7a1c1c;
    }

    .premium {
      background: #fff;
      border: 1px solid rgba(13,36,24,0.12);
      border-radius: 30px;
      padding: 26px;
      box-shadow: 0 26px 80px rgba(13,36,24,0.10);
    }

    .progress {
      height: 12px;
      background: #e1ebe5;
      border-radius: 999px;
      overflow: hidden;
      margin: 12px 0;
    }

    .progress-fill {
      width: 65%;
      height: 100%;
      background: #2f7d57;
      border-radius: 999px;
    }

    .locked-preview {
      position: relative;
      border: 1px solid #d8e7dc;
      background: #fbfdfb;
      padding: 16px;
      margin: 18px 0;
      overflow: hidden;
      border-radius: 18px;
    }

    .blur-lines {
      filter: blur(4px);
      opacity: 0.55;
      font-size: 13px;
      line-height: 1.8;
      font-weight: 700;
    }

    .locked-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(90deg, rgba(251,253,251,0.72), rgba(251,253,251,0.92));
    }

    .locked-badge {
      background: #fff;
      border: 1px solid #d8e7dc;
      padding: 10px 14px;
      font-size: 12px;
      font-weight: 950;
      color: #163c2b;
      box-shadow: 0 8px 22px rgba(16,32,24,0.10);
      border-radius: 999px;
    }

    .cta {
      display: block;
      text-align: center;
      background: #102018;
      color: #fff;
      text-decoration: none;
      font-weight: 950;
      font-size: 16px;
      padding: 17px 18px;
      border-radius: 14px;
      letter-spacing: -0.02em;
      margin-top: 14px;
    }

    .back-button {
      position: fixed;
      left: 14px;
      bottom: 14px;
      z-index: 99999;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 16px;
      border-radius: 999px;
      background: #0D2418;
      color: #fff;
      font-size: 13px;
      font-weight: 950;
      text-decoration: none;
      box-shadow: 0 12px 32px rgba(13,36,24,0.22);
    }

    @media print {
      .back-button {
        display: none;
      }

      body {
        background: #fff;
      }

      .page {
        max-width: none;
        padding: 28px;
      }

      .cover {
        min-height: auto;
      }

      .section {
        break-inside: avoid;
        box-shadow: none;
      }
    }

    @media (max-width: 760px) {
      .page {
        padding: 24px 14px;
      }

      .cover {
        min-height: auto;
        padding-top: 22px;
      }

      .cover-card {
        padding: 24px 20px;
        border-radius: 26px;
      }

      h1 {
        font-size: 44px;
      }

      .subtitle {
        font-size: 15px;
      }

      .verdict {
        font-size: 18px;
      }

      .section {
        border-radius: 24px;
        padding: 22px 18px;
      }

      .section-title {
        font-size: 25px;
      }

      .card-grid,
      .score-grid {
        grid-template-columns: 1fr;
      }

      table {
        font-size: 12px;
      }

      td, th {
        padding: 10px;
      }

      .back-button {
        left: 12px;
        bottom: 12px;
        font-size: 12px;
        padding: 11px 14px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="page cover">
      <div class="cover-card">
        <div class="kicker"><span class="dot"></span>GONOGO™ DECISION ENGINE</div>
        <h1>${esc(report.cover.brandName || "Business Report")}</h1>
        <p class="subtitle">${esc(report.cover.subtitle || "")}</p>

        <div class="decision-row">
          <div class="pill ${statusClass(report.cover.decision)}">${esc(report.cover.decision)}</div>
          <div class="pill">${esc(c.score)}: ${esc(report.cover.score)} / 100</div>
          <div class="pill">${esc(report.reportMode === "paid" ? "PAID REPORT" : "FREE PREVIEW")}</div>
        </div>

        <div class="verdict">${esc(report.cover.oneLineVerdict || "")}</div>
      </div>
    </section>

    <section class="page">
      <div class="section">
        <h2 class="section-title">1. Business Diagnosis</h2>
        <p class="section-desc">${esc(report.businessDiagnosis.structureSummary || "")}</p>
        <table>
          <tr><th>Item</th><th>Diagnosis</th></tr>
          <tr><td>Industry</td><td>${esc(report.businessDiagnosis.industryType)}</td></tr>
          <tr><td>Model</td><td>${esc(report.businessDiagnosis.businessModelType)}</td></tr>
          <tr><td>Customer Behavior</td><td>${esc(report.businessDiagnosis.countryMarketBehavior)}</td></tr>
          <tr><td>Entry Difficulty</td><td>${esc(report.businessDiagnosis.marketEntryDifficulty)}</td></tr>
          <tr><td>Main Bottleneck</td><td>${esc(report.businessDiagnosis.mainBottleneck)}</td></tr>
          <tr><td>Best First Offer</td><td>${esc(report.businessDiagnosis.bestFirstOffer)}</td></tr>
          <tr><td>Validation Test</td><td>${esc(report.businessDiagnosis.validationExperiment)}</td></tr>
        </table>
      </div>
            <div class="section">
        <h2 class="section-title">2. Decision Matrix</h2>
        ${buildDecisionChart(report)}
        <table>
          <tr><th>Dimension</th><th>Level</th></tr>
          <tr><td>Market</td><td>${esc(matrix.MARKET || "")}</td></tr>
          <tr><td>Profitability</td><td>${esc(matrix.PROFITABILITY || "")}</td></tr>
          <tr><td>Execution</td><td>${esc(matrix.EXECUTION || "")}</td></tr>
          <tr><td>Risk</td><td>${esc(matrix.RISK || "")}</td></tr>
        </table>
      </div>

      <div class="section">
        <h2 class="section-title">3. Executive Decision</h2>
        <table>
          <tr><th>Why it works</th><td>${esc(whyWorks)}</td></tr>
          <tr><th>Why it fails</th><td>${esc(whyFails)}</td></tr>
          <tr><th>What to do now</th><td>${esc(whatNow)}</td></tr>
        </table>
      </div>

      <div class="section">
        <h2 class="section-title">4. Market Overview</h2>
        <div class="card-grid">
          <div class="mini-card">
            <div class="mini-label">TAM</div>
            <div class="mini-value">${esc(market.TAM || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">SAM</div>
            <div class="mini-value">${esc(market.SAM || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">SOM</div>
            <div class="mini-value">${esc(market.SOM || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">Growth</div>
            <div class="mini-value">${esc(market.GROWTH || "")}</div>
          </div>
        </div>
        <p class="section-desc">${esc(report.marketInsight || "")}</p>
      </div>

      <div class="section">
        <h2 class="section-title">5. Customer Insight</h2>
        <p class="section-desc">${esc(report.customerSummary || "")}</p>
        <ul>
          ${listItems(report.customerOpportunity.map(r => r[1] || ""))}
        </ul>
      </div>

      ${
        report.reportMode === "paid"
          ? `
      <div class="section">
        <h2 class="section-title">6. Unit Economics</h2>
        <div class="card-grid">
          <div class="mini-card">
            <div class="mini-label">CAC</div>
            <div class="mini-value">${esc(unit.CAC || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">LTV</div>
            <div class="mini-value">${esc(unit.LTV || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">AOV</div>
            <div class="mini-value">${esc(unit.AOV || "")}</div>
          </div>
          <div class="mini-card">
            <div class="mini-label">Repeat</div>
            <div class="mini-value">${esc(unit.REPEAT || "")}</div>
          </div>
        </div>
        <p class="section-desc">${esc(report.economicsJudgment || "")}</p>
      </div>
      `
          : premiumSection
      }

    </section>
  </main>

  ${backButton}
</body>
</html>
`
}
function buildPremiumSection(report, lang = "en") {
  const c = getCopy(lang)

  const score = Number.isFinite(report?.cover?.score)
    ? report.cover.score
    : 0

  const decision = report?.cover?.decision || "HOLD"

 const checkoutParams = new URLSearchParams({
  lang,
  brandName: report?.cover?.brandName || "PaidReport",
  productService: report?.cover?.subtitle || "A paid business report",
  targetCustomer: "Target customers",
})

const checkoutUrl =
  process.env.PAYWALL_CHECKOUT_URL ||
  `/api/dev-create-paid-token?${checkoutParams.toString()}`

  return `
<div class="premium">
  <div class="kicker">
    <span class="dot"></span>${esc(c.premiumKicker)}
  </div>

  <h2 class="section-title">${esc(c.premiumTitle)}</h2>
  <p class="section-desc">${esc(c.premiumDesc)}</p>

  <div class="progress">
    <div class="progress-fill"></div>
  </div>

  <div style="
    display:flex;
    justify-content:space-between;
    gap:12px;
    font-size:12px;
    font-weight:900;
    color:#53645A;
    margin-bottom:18px;
  ">
    <span>${esc(c.freeUnlocked)}</span>
    <span>65%</span>
  </div>

  <div class="card-grid" style="grid-template-columns:1fr 1fr;margin-bottom:18px;">
    <div class="mini-card">
      <div class="mini-label">${esc(c.currentDecision)}</div>
      <div class="mini-value">${esc(decision)}</div>
      <div style="margin-top:8px;font-size:13px;font-weight:850;color:#53645A;">
        ${esc(c.score)}: ${esc(String(score))} / 100
      </div>
    </div>

    <div class="mini-card" style="background:#0D2418;color:#fff;">
      <div class="mini-label" style="color:rgba(255,255,255,0.72);">
        ${esc(c.locked)}
      </div>
      <div class="mini-value" style="font-size:20px;">
        ${esc("Customer, profit, risk, and execution logic")}
      </div>
    </div>
  </div>

  <div class="locked-preview">
    <div class="blur-lines">
      <div>✓ Customer buying trigger and hesitation signals</div>
      <div>✓ Market size and competition reality</div>
      <div>✓ CAC, LTV, payback, and profit structure</div>
      <div>✓ Risk system and kill criteria</div>
      <div>✓ 12-week execution plan</div>
    </div>

    <div class="locked-overlay">
      <div class="locked-badge">${esc(c.locked)}</div>
    </div>
  </div>

  <div class="callout warning">
    ${esc(c.urgency)}
  </div>

  <a href="${esc(checkoutUrl)}" class="cta">
    ${esc(c.cta)} — $49
  </a>

  <p style="
    margin:12px 0 0;
    font-size:11px;
    line-height:1.5;
    color:#6a7a71;
    text-align:center;
    font-weight:750;
  ">
    ${esc(c.ctaSub)}
  </p>
</div>
`
}

function injectReportBackButton(lang = "en") {
  const c = getCopy(lang)

  return `
<a href="https://gonogo.so/report" class="back-button">
  ← ${esc(c.back)}
</a>
`
}

function buildLoadingHtml(req) {
  const lang = normalizeLanguage(req.query.lang || "ko")
  const c = getCopy(lang)

  const reportType = req.query.reportType === "paid" ? "paid" : "free"

  const params = new URLSearchParams({
    lang,
    reportType,
    brandName: req.query.brandName || "",
    productService: req.query.productService || "",
    targetCustomer: req.query.targetCustomer || "",
  })

  const targetUrl = `/api/debug-html?${params.toString()}`
  const stepsJson = JSON.stringify(c.loadingSteps)

  return `
<!doctype html>
<html lang="${esc(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>GoNoGo™ Report Loading</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 20% 18%, rgba(182,255,90,0.18), transparent 28%),
        radial-gradient(circle at 80% 82%, rgba(13,36,24,0.08), transparent 32%),
        #ffffff;
      color: #0D2418;
      font-family: Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
      overflow: hidden;
    }

    .wrap {
      width: 100%;
      max-width: 430px;
      text-align: center;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 13px;
      border: 1px solid rgba(13,36,24,0.12);
      border-radius: 999px;
      background: rgba(255,255,255,0.74);
      backdrop-filter: blur(12px);
      font-size: 12px;
      font-weight: 950;
      margin-bottom: 30px;
      box-shadow: 0 12px 32px rgba(13,36,24,0.05);
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #B6FF5A;
      box-shadow: 0 0 18px rgba(182,255,90,0.9);
    }

    .card {
      background: rgba(255,255,255,0.84);
      border: 1px solid rgba(13,36,24,0.12);
      border-radius: 30px;
      padding: 34px 24px 28px;
      box-shadow:
        0 30px 90px rgba(13,36,24,0.10),
        inset 0 1px 0 rgba(255,255,255,0.9);
      backdrop-filter: blur(18px);
    }

    .spinner {
      width: 52px;
      height: 52px;
      border: 4px solid rgba(13,36,24,0.12);
      border-top-color: #0D2418;
      border-radius: 50%;
      margin: 0 auto 24px;
      animation: spin 0.85s linear infinite;
    }
        h1 {
      margin: 0 0 12px;
      font-size: 31px;
      line-height: 1.04;
      letter-spacing: -0.065em;
      font-weight: 950;
    }

    .desc {
      margin: 0 auto 26px;
      max-width: 340px;
      color: #53645A;
      font-size: 14px;
      line-height: 1.65;
      font-weight: 650;
    }

    .progress {
      height: 10px;
      width: 100%;
      background: #E5EDE8;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 14px;
    }

    .bar {
      height: 100%;
      width: 8%;
      background: #0D2418;
      border-radius: 999px;
      transition: width 0.45s ease;
    }

    .step {
      min-height: 22px;
      color: #0D2418;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: -0.02em;
    }

    .note {
      margin-top: 22px;
      font-size: 11px;
      line-height: 1.5;
      color: #7B8B82;
      font-weight: 700;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @media (max-width: 480px) {
      body {
        padding: 18px;
        align-items: flex-start;
        padding-top: 78px;
      }

      .card {
        border-radius: 26px;
        padding: 32px 20px 26px;
      }

      h1 {
        font-size: 28px;
      }

      .desc {
        font-size: 13px;
      }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="badge">
      <span class="dot"></span>
      GONOGO™ DECISION ENGINE
    </div>

    <section class="card">
      <div class="spinner"></div>
      <h1>${esc(c.loadingTitle)}</h1>
      <p class="desc">${esc(c.loadingDesc)}</p>

      <div class="progress">
        <div class="bar" id="bar"></div>
      </div>

      <div class="step" id="step">${esc(c.loadingSteps[0])}</div>

      <div class="note">
        Do not close this page. Your report will open automatically.
      </div>
    </section>
  </main>

  <script>
    const steps = ${stepsJson};
    const stepEl = document.getElementById("step");
    const barEl = document.getElementById("bar");

    let index = 0;
    const widths = [18, 34, 52, 74, 92];

    const timer = setInterval(function () {
      index = Math.min(index + 1, steps.length - 1);
      stepEl.textContent = steps[index];
      barEl.style.width = widths[index] + "%";

      if (index >= steps.length - 1) {
        clearInterval(timer);
      }
    }, 1100);

    setTimeout(function () {
      window.location.replace(${JSON.stringify(targetUrl)});
    }, 5200);
  </script>
</body>
</html>
`
}

async function htmlToPdf(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "networkidle0" })

    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },
    })
  } finally {
    await browser.close()
  }
}

app.get("/", (req, res) => {
  return res.json({
    ok: true,
    service: "GoNoGo Report Server",
    version: "3.0.0-standalone",
  })
})

app.get("/api/health", (req, res) => {
  return res.json({ ok: true, status: "healthy" })
})

app.get("/api/report-loading", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  return res.send(buildLoadingHtml(req))
})

app.get("/api/debug-html", async (req, res) => {
  try {
    const language = normalizeLanguage(req.query.lang || req.query.language || "ko")
    const reportType = req.query.reportType === "paid" ? "paid" : "free"

    const brandName = req.query.brandName || "SampleBrand"
    const productService = req.query.productService || "A new product or service idea"
    const targetCustomer = req.query.targetCustomer || "Target customers for this business"

    const report = await generateDeepReportJson({
      brandName,
      productService,
      targetCustomer,
      language,
      reportType,
    })

    const finalReport =
      reportType === "free"
        ? buildFreeReportFromPaidReport(report)
        : { ...report, isPaid: true, reportMode: "paid" }

    const html = buildReportHtml(finalReport, language)

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    return res.send(html)
  } catch (error) {
    console.error("[DEBUG_HTML_ERROR]", error)
    return res.status(500).json({
      ok: false,
      error: "DEBUG_HTML_FAILED",
      detail: String(error?.message || error),
    })
  }
})

app.post("/api/generate-report", async (req, res) => {
  try {
    const {
      brandName = "",
      productService = "",
      targetCustomer = "",
      language = "ko",
      reportType = "free",
    } = req.body || {}

    if (!brandName || !productService || !targetCustomer) {
      return res.status(400).json({
        ok: false,
        error: "brandName, productService, targetCustomer are required.",
      })
    }

    const normalizedLanguage = normalizeLanguage(language)
    const normalizedReportType = reportType === "paid" ? "paid" : "free"

    const report = await generateDeepReportJson({
      brandName,
      productService,
      targetCustomer,
      language: normalizedLanguage,
      reportType: normalizedReportType,
    })

    const finalReport =
      normalizedReportType === "free"
        ? buildFreeReportFromPaidReport(report)
        : { ...report, isPaid: true, reportMode: "paid" }

    return res.json({
      ok: true,
      report: finalReport,
    })
  } catch (error) {
    console.error("[GENERATE_REPORT_ERROR]", error)
    return res.status(500).json({
      ok: false,
      error: "REPORT_FAILED",
      detail: String(error?.message || error),
    })
  }
})

app.get("/api/dev-create-paid-token", (req, res) => {
  const language = normalizeLanguage(req.query.lang || "ko")

  const token = createPaidDownloadToken({
    language,
    brandName: req.query.brandName || "PaidReport",
    productService: req.query.productService || "A paid business report",
    targetCustomer: req.query.targetCustomer || "Target customers",
  })

  const c = getCopy(language)

  const downloadUrl = `/api/download-paid-pdf?token=${encodeURIComponent(token)}`

  res.setHeader("Content-Type", "text/html; charset=utf-8")
  return res.send(`
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin:0;
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:Inter,system-ui,sans-serif;
      background:#f7faf8;
      color:#0D2418;
      padding:24px;
    }
    .box {
      max-width:420px;
      background:#fff;
      border:1px solid rgba(13,36,24,0.12);
      border-radius:28px;
      padding:28px;
      box-shadow:0 28px 80px rgba(13,36,24,0.10);
      text-align:center;
    }
    h1 {
      margin:0 0 12px;
      font-size:30px;
      line-height:1.05;
      letter-spacing:-0.05em;
    }
    p {
      margin:0 0 20px;
      color:#53645A;
      line-height:1.6;
      font-weight:650;
    }
    a {
      display:block;
      text-decoration:none;
      color:#fff;
      background:#0D2418;
      padding:16px 18px;
      border-radius:14px;
      font-weight:950;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>${esc(c.tokenCreated)}</h1>
    <p>${esc(c.tokenDesc)}</p>
    <a href="${esc(downloadUrl)}">${esc(c.download)}</a>
  </div>
</body>
</html>
`)
})

app.get("/api/download-paid-pdf", async (req, res) => {
  try {
    const token = req.query.token
    const validation = validatePaidDownloadToken(token)

    if (!validation.ok) {
      return res.status(validation.status).send(`
        <html>
          <body style="font-family:Arial;padding:40px;">
            <h1>Download unavailable</h1>
            <p>${esc(validation.message)}</p>
          </body>
        </html>
      `)
    }

    validation.record.downloadCount += 1

    const payload = validation.record.payload || {}
    const language = normalizeLanguage(payload.language || "ko")

    const report = await generateDeepReportJson({
      brandName: payload.brandName || "PaidReport",
      productService: payload.productService || "A paid business report",
      targetCustomer: payload.targetCustomer || "Target customers",
      language,
      reportType: "paid",
    })

    const html = buildReportHtml(
      { ...report, isPaid: true, reportMode: "paid" },
      language
    )

    const pdfBuffer = await htmlToPdf(html)
    const safeBrand = sanitizeFileName(report?.cover?.brandName || "PaidReport")

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Length", pdfBuffer.length)
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="GoNoGo_Paid_Report_${safeBrand}_${language}.pdf"`
    )

    return res.end(pdfBuffer)
  } catch (error) {
    console.error("[DOWNLOAD_PAID_PDF_ERROR]", error)
    return res.status(500).send("Failed to download paid PDF.")
  }
})

app.listen(PORT, () => {
  console.log(`GoNoGo server running on port ${PORT}`)
})
    

      
