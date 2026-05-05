import express from "express"import cors from "cors"import crypto from "crypto"import OpenAI from "openai"import fs from "fs"import path from "path"import { fileURLToPath } from "url"import puppeteer from "puppeteer-core"import chromium from "@sparticuz/chromium"

const app = express()

const paidDownloadTokens = new Map()

function createPaidDownloadToken() {const token = crypto.randomBytes(24).toString("hex")

paidDownloadTokens.set(token, {paid: true,downloadLimit: 3,downloadCount: 0,createdAt: Date.now(),expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,})

return token}

function validatePaidDownloadToken(token) {if (!token) {return { ok: false, status: 401, message: "Missing download token." }}

const record = paidDownloadTokens.get(token)

if (!record || !record.paid) {return { ok: false, status: 403, message: "Invalid payment token." }}

if (Date.now() > record.expiresAt) {return { ok: false, status: 403, message: "This download link has expired." }}

if (record.downloadCount >= record.downloadLimit) {return { ok: false, status: 403, message: "Download limit exceeded." }}

return { ok: true, record }}

const PORT = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)const __dirname = path.dirname(__filename)

app.use(express.json({ limit: "5mb" }))

app.use(cors({origin: true,methods: ["GET", "POST", "OPTIONS"],allowedHeaders: ["Content-Type", "Authorization"],}))

app.options("*", cors())

// preflight 요청 처리 (중요)app.options("*", cors())

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY,})

app.get("/", (req, res) => {res.json({ok: true,service: "GoNoGo Report Server",version: "2.2.0-multilingual-pdf",})})

app.get("/api/health", (req, res) => {res.json({ ok: true, status: "healthy" })})

app.get("/api/report-loading", (req, res) => {const lang = normalizeLanguage(req.query.lang || "ko")const reportType = req.query.reportType === "paid" ? "paid" : "free"

const params = new URLSearchParams({
    lang,
    reportType,
    brandName: req.query.brandName || "",
    productService: req.query.productService || "",
    targetCustomer: req.query.targetCustomer || "",
})

const targetUrl = `/api/debug-html?${params.toString()}`

const loadingCopy = {
    ko: {
        title: "보고서를 만들고 있어",
        desc: "시장 위험, 고객 구매 이유, 수익 구조, 실행 가능성을 분석하는 중이야.",
        steps: [
            "사업 아이디어 구조 분석 중",
            "고객 구매 가능성 계산 중",
            "시장·경쟁 리스크 확인 중",
            "수익 구조와 실행 조건 정리 중",
            "최종 Go / No-Go 판단 생성 중",
        ],
    },
    en: {
        title: "Building your decision report",
        desc: "Analyzing market risk, customer logic, profit structure, and execution signals.",
        steps: [
            "Reading your business idea",
            "Checking customer buying logic",
            "Mapping market and competition risk",
            "Calculating profit structure",
            "Generating your Go / No-Go decision",
        ],
    },
    ja: {
        title: "レポートを生成しています",
        desc: "市場リスク、顧客心理、収益構造、実行可能性を分析しています。",
        steps: [
            "事業アイデアを分析中",
            "顧客の購入理由を確認中",
            "市場と競合リスクを確認中",
            "収益構造を整理中",
            "Go / No-Go 判断を生成中",
        ],
    },
    zh: {
        title: "正在生成决策报告",
        desc: "正在分析市场风险、客户购买逻辑、盈利结构和执行条件。",
        steps: [
            "分析商业想法结构",
            "判断客户购买动机",
            "检查市场与竞争风险",
            "整理盈利结构",
            "生成 Go / No-Go 判断",
        ],
    },
    mn: {
        title: "Тайлан боловсруулж байна",
        desc: "Зах зээлийн эрсдэл, хэрэглэгчийн логик, ашигт ажиллагаа, хэрэгжүүлэх боломжийг шинжилж байна.",
        steps: [
            "Бизнес санааг шинжилж байна",
            "Хэрэглэгчийн худалдан авах шалтгааныг шалгаж байна",
            "Зах зээл ба өрсөлдөөний эрсдэлийг тооцож байна",
            "Ашгийн бүтцийг боловсруулж байна",
            "Go / No-Go шийдвэр гаргаж байна",
        ],
    },
}

const copy = loadingCopy[lang] || loadingCopy.en
const stepsJson = JSON.stringify(copy.steps)

res.setHeader("Content-Type", "text/html; charset=utf-8")
return res.send(`

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

<section class="card">
  <div class="spinner"></div>
  <h1>${esc(copy.title)}</h1>
  <p class="desc">${esc(copy.desc)}</p>

  <div class="progress">
    <div class="bar" id="bar"></div>
  </div>

  <div class="step" id="step">${esc(copy.steps[0])}</div>

  <div class="note">
    Do not close this page. Your report will open automatically.
  </div>
</section>

app.get("/api/debug-html", async (req, res) => {try {const language = normalizeLanguage(req.query.lang || req.query.language || "ko")

    const reportType = req.query.reportType === "free" ? "free" : "paid"

    const brandName = req.query.brandName || "SampleBrand"
    const productService =
        req.query.productService || "A new product or service idea"
    const targetCustomer =
        req.query.targetCustomer || "Target customers for this business"

    const locale = loadLocale(language)

    const paidReport = await generateDeepReportJson({
        brandName,
        productService,
        targetCustomer,
        language,
    })

    const finalReport =
        reportType === "free"
            ? buildFreeReportFromPaidReport(paidReport)
            : { ...paidReport, isPaid: true, reportMode: "paid" }

    const html = buildHtmlFromTemplate(finalReport, locale)

    console.log("🌍 LANG:", language)
    console.log("[DEBUG_HTML_LENGTH]", html.length)

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

app.post("/api/generate-report", async (req, res) => {try {const {brandName = "",productService = "",targetCustomer = "",language = "ko",reportType = "free",} = req.body || {}

    if (!brandName || !productService || !targetCustomer) {
        return res.status(400).json({
            ok: false,
            error: "brandName, productService, targetCustomer are required.",
        })
    }

    const normalizedLanguage = normalizeLanguage(language)
    const locale = loadLocale(normalizedLanguage)

    const normalizedReportType =
        reportType === "paid" || reportType === "deep" ? "paid" : "free"

  const paidReport = await generateDeepReportJson({
brandName,
productService,
targetCustomer,
language,

})

 app.get("/api/dev-create-paid-token", (req, res) => {
const token = createPaidDownloadToken()

const lang = normalizeLanguage(req.query.lang || "ko")

const downloadUrl = `${req.protocol}://${req.get(
    "host"
)}/api/download-paid-pdf?token=${token}&lang=${lang}`

res.setHeader("Content-Type", "text/html; charset=utf-8")
return res.send(`
    <html>
        <body style="font-family:Arial;padding:40px;">
            <h1>Paid token created</h1>
            <p>PayPal 연결 전 테스트용 다운로드 링크야.</p>
            <p>다운로드 가능 횟수: 3회</p>

            <a href="${downloadUrl}" style="
                display:inline-block;
                padding:16px 24px;
                background:#082818;
                color:white;
                border-radius:12px;
                text-decoration:none;
                font-weight:700;
            ">
                Download Paid PDF
            </a>
        </body>
    </html>
`)

})

    app.get("/api/download-paid-pdf", async (req, res) => {
try {
    const { token } = req.query
    const language = normalizeLanguage(req.query.lang || "ko")

    const validation = validatePaidDownloadToken(token)

    if (!validation.ok) {
        return res.status(validation.status).send(`
            <html>
                <body style="font-family:Arial;padding:40px;">
                    <h1>Download unavailable</h1>
                    <p>${validation.message}</p>
                </body>
            </html>
        `)
    }

    validation.record.downloadCount += 1

    const brandName = req.query.brandName || "PaidReport"
    const productService =
        req.query.productService || "A paid business report"
    const targetCustomer =
        req.query.targetCustomer || "Target customers"

    const locale = loadLocale(language)

    const paidReport = await generateDeepReportJson({
        brandName,
        productService,
        targetCustomer,
        language,
    })

    const finalReport = {
        ...paidReport,
        isPaid: true,
        reportMode: "paid",
    }

    const html = buildHtmlFromTemplate(finalReport, locale)
    const pdfBuffer = await htmlToPdf(html)

    const safeBrand = sanitizeFileName(brandName)

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

    const finalReport =
normalizedReportType === "paid"
    ? { ...paidReport, isPaid: true, reportMode: "paid" }
    : buildFreeReportFromPaidReport(paidReport)
    
    const html = buildHtmlFromTemplate(finalReport, locale)
    const pdfBuffer = await htmlToPdf(html)

    const safeBrand = sanitizeFileName(brandName)

    const fileName =
        normalizedReportType === "free"
            ? `GoNoGo_Free_Report_${safeBrand}_${normalizedLanguage}.pdf`
            : `GoNoGo_Paid_Report_${safeBrand}_${normalizedLanguage}.pdf`

    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Length", pdfBuffer.length)
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)

    return res.end(pdfBuffer)
} catch (error) {
    console.error("[GENERATE_REPORT_ERROR]", error)

    return res.status(500).json({
        ok: false,
        error: "Failed to generate report.",
        detail: String(error?.message || error),
    })
}

})

function buildPaidReportPrompt({ brandName, productService, targetCustomer, language }) {const languageName = getLanguageName(language)

return `

You are GoNoGo, a ruthless business decision engine.

You are NOT a writer.You are NOT a generic consultant.You are a paid business decision report engine.

Your job:Evaluate this business idea and generate a premium PDF-ready JSON report.

Final report language: ${languageName}

Business Input:

Brand Name: ${brandName}

Product / Service: ${productService}

Target Customer: ${targetCustomer}

Language / Market: ${language}

Critical rules:

Output VALID JSON only.

No markdown.

No explanation outside JSON.

Use the exact JSON shape provided below.

Do not use placeholders.

Every table cell must contain real content.

Use realistic assumptions when exact data is unavailable.

Clearly state assumptions in appendix.

Use country-specific market logic.

Be conservative, not optimistic.

If the business is weak, say it clearly.

All scores must be numbers from 0 to 100.

Keep table cells concise but meaningful.

Make the report directly useful for founder decision-making.

You must return every field in the exact JSON structure.

Never omit required keys.

Never rename keys.

Never add new top-level keys.

Every array must keep the required number of rows.

Every table row must keep the required number of columns.

If data is uncertain, write a conservative assumption instead of leaving it blank.

Do not use null.

Do not use undefined.

Do not use empty strings unless the field is truly impossible.

Keep all table cells short and layout-safe.

This rule applies ONLY to table cells.

Narrative fields must be deeper and more informative.

Escape all double quotes inside string values.

Do not use unescaped quotation marks inside any JSON string.

Do not use line breaks inside JSON string values.

Do not use trailing commas.

Every string value must be valid JSON-safe text.



Layout safety rules:

Table cells must be short.

Each table cell should be 8 to 18 words maximum in English.

For Japanese, Chinese, and Mongolian, keep table cells shorter than English.

Do not write full paragraphs inside table cells.

Long explanations must go only into text fields such as marketInsight, buyingTrigger, economicsJudgment, modelJudgment, operatingRule, finalRule, founderWarning.

Do not put line breaks inside table cells.

Do not use very long compound phrases inside table cells.

Avoid repeating the same sentence across multiple cells.

Numbers, ranges, and decisions should be concise.

Use clear, founder-friendly wording.

Narrative depth rules (CRITICAL):

customerSummary:

3 to 4 sentences

Summarize both positive buying signals and negative hesitation signals.

Explain what actually makes the customer buy.

Explain what blocks the customer from buying.

End with the most important validation point.

The report must not feel shallow.

Narrative fields are the core of decision quality.

structureSummary:

3 to 4 sentences

Rewrite the business diagnosis table into a connected business story.

Explain how the business actually operates in reality.

Include business type, revenue model, entry difficulty, bottleneck, and validation logic.

For the following fields, write deeper, structured explanations:

marketInsight:

3 to 4 sentences

Explain: market structure → limitation → real opportunity → strategic implication

economicsJudgment:

3 to 4 sentences

Explain: cost structure → CAC pressure → margin reality → survival condition

modelJudgment:

3 to 4 sentences

Explain: why this model works or fails → structural weakness → how to fix

modelDeepDive:

3 to 5 sentences

Explain the deeper business model mechanics.

Cover revenue logic, repeat purchase or retention logic, margin pressure, operational weakness, and the best structural improvement.

This must not repeat modelJudgment.

operatingRule:

2 to 3 sentences

Must define a clear decision rule (what to track and when to stop)

profitJudgment:

3 to 4 sentences

Explain: scaling condition → risk → realistic expectation

breakEvenPoint:

2 to 3 sentences

Explain: when business becomes viable → key threshold → constraint

Additional rules:

Each explanation must include:

Cause

Business meaning

Action implication

Avoid generic phrases such as "this is important" or "this is needed"

Avoid repeating the same logic across sections

Each section must provide a different angle of insight

Brand naming rules:

brandNaming must be generated as a paid report section.

The brand name should be created from productService and targetCustomer, not only from the user's brandName input.

If brandName is empty, generic, temporary, or unclear, recommend a stronger brand name.

Generate names that are short, memorable, easy to pronounce, and commercially usable.

Avoid generic names such as Best, Smart, Premium, Global, Shop, Store, Solution, Service.

Avoid names that are too narrow unless the business requires a niche identity.

Prefer names that can expand into future products, categories, or markets.

Naming must reflect customer desire, category signal, trust, and differentiation.

For ko, names may be Korean, English, or hybrid depending on market fit.

For en, prefer globally pronounceable English-style names.

For ja, prefer compact, trust-oriented, easy-to-read names.

For zh, prefer names that can carry meaning and social commerce appeal.

For mn, prefer simple, practical, easy-to-remember names.

Domain suggestions are strategic recommendations only.

Do not claim real-time domain availability.

availability must mean estimated likelihood only: HIGH | MEDIUM | LOW.

domainSuggestions must avoid trademark-sensitive famous brand terms.

brandNaming:

brandDirection must explain the strategic naming direction in 3 to 4 sentences.

namingStrategy must explain the naming logic, positioning angle, and why it fits the customer.

keywords must contain exactly 8 short keywords.

nameCandidates must contain exactly 5 candidates.

Each nameCandidate must include name, meaning, fit, risk, and score.

score must be a number from 0 to 100.

recommendedName must choose exactly one best candidate.

domainSuggestions must contain exactly 5 domain ideas.

Each domain suggestion must include domain, reason, and availability.

domain availability is only an estimated likelihood, not a verified registration result.

Array stability rules:

glossary must contain exactly 5 items.

decisionMatrix must contain exactly 4 rows.

marketCards must contain exactly 4 rows.

marketFunnel must contain exactly 3 items: TAM, SAM, SOM.

tamSamSom must contain exactly 3 rows.

customerTruth must contain exactly 3 rows.

customerOpportunity must contain exactly 4 rows.

competitionMap must contain exactly 4 rows.

benchmarkRows must contain exactly 3 rows.

unitEconomicsCards must contain exactly 4 rows.

unitEconomicsTable must contain exactly 4 rows.

marketingStrategy.channelFit must contain exactly 4 rows.

marketingStrategy.contentPlaybook must contain exactly 5 items.

marketingStrategy.thirtyDayMarketingTest must contain exactly 12 rows and represent a 12-week / 3-month test plan.

businessModel.revenueLayers must contain exactly 3 rows.

riskSystem must contain exactly 3 rows.

executionPlan must contain exactly 3 rows.

goThreshold must contain exactly 4 rows.

goChecklist must contain exactly 4 items.

dataConfidence.sourceQuality must contain exactly 3 rows.

dataConfidence.limits must contain exactly 3 items.

sensitivityAnalysis.cacLtvTable must contain exactly 3 rows.

profitSimulation.monthlyScenarioTable must contain exactly 3 rows.

killCriteria.rules must contain exactly 4 rows.

appendix.dataSources must contain exactly 3 rows.

appendix.assumptions must contain exactly 4 items.

referenceLinks must contain exactly 5 rows.

brandNaming.keywords must contain exactly 8 items.

brandNaming.nameCandidates must contain exactly 5 items.

brandNaming.domainSuggestions must contain exactly 5 items.

Language output rules:

All user-facing values must be written in the final report language.

Do not mix Korean into English, Japanese, Chinese, or Mongolian reports.

Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.

For Japanese, Chinese, and Mongolian, keep sentences compact to protect PDF layout.

Narrative tone rules:

Write like a strategy consultant, not a content writer

Be direct, specific, and decision-oriented

Avoid storytelling, focus on judgment

Each paragraph should help a founder decide "go / pivot / stop"

Country strategy rules:

ko: Korea-first. Consider Naver, Kakao, Coupang, SmartStore, Instagram, YouTube Shorts, local payment behavior, Korean price sensitivity.

en: Global / English market. Consider Google, Meta, Amazon, Shopify, TikTok, Reddit, creator ads, DTC funnel.

ja: Japan-first. Consider LINE, Rakuten, Yahoo Japan, Amazon JP, trust-heavy purchase behavior, conservative adoption.

zh: Chinese-speaking market. Consider WeChat, Xiaohongshu, Douyin, Tmall, group commerce, social proof, KOL/KOC.

mn: Mongolia-first. Consider Facebook commerce, bank transfer, offline trust, messenger sales, low-friction purchase behavior.

Important:Your JSON must match the current HTML template structure exactly.

Return this exact JSON shape:

{"cover": {"brandName": "${brandName}","decision": "GO | HOLD | NO GO","score": 0,"subtitle": "","oneLineVerdict": ""},

"brandNaming": {
"brandDirection": "",
"namingStrategy": "",
"keywords": ["", "", "", "", "", "", "", ""],
"nameCandidates": [
  {
    "name": "",
    "meaning": "",
    "fit": "",
    "risk": "",
    "score": 0
  },
  {
    "name": "",
    "meaning": "",
    "fit": "",
    "risk": "",
    "score": 0
  },
  {
    "name": "",
    "meaning": "",
    "fit": "",
    "risk": "",
    "score": 0
  },
  {
    "name": "",
    "meaning": "",
    "fit": "",
    "risk": "",
    "score": 0
  },
  {
    "name": "",
    "meaning": "",
    "fit": "",
    "risk": "",
    "score": 0
  }
],
"recommendedName": {
  "name": "",
  "reason": "",
  "positioning": "",
  "expansionPotential": ""
},
"domainSuggestions": [
  {
    "domain": "",
    "reason": "",
    "availability": "HIGH | MEDIUM | LOW"
  },
  {
    "domain": "",
    "reason": "",
    "availability": "HIGH | MEDIUM | LOW"
  },
  {
    "domain": "",
    "reason": "",
    "availability": "HIGH | MEDIUM | LOW"
  },
  {
    "domain": "",
    "reason": "",
    "availability": "HIGH | MEDIUM | LOW"
  },
  {
    "domain": "",
    "reason": "",
    "availability": "HIGH | MEDIUM | LOW"
  }
]

},

"glossary": [{"term": "","meaning": "","whyItMatters": ""},{"term": "","meaning": "","whyItMatters": ""},{"term": "","meaning": "","whyItMatters": ""},{"term": "","meaning": "","whyItMatters": ""},{"term": "","meaning": "","whyItMatters": ""}],

"businessDiagnosis": {"industryType": "","businessModelType": "","countryMarketBehavior": "","marketEntryDifficulty": "LOW | MEDIUM | HIGH","mainBottleneck": "","bestFirstOffer": "","validationExperiment": "","goNoGoLogic": "","structureSummary": ""},

"visualScores": {"market": 0,"profitability": 0,"execution": 0,"risk": 0},

"decisionMatrix": [["MARKET", "LOW | MEDIUM | HIGH"],["PROFITABILITY", "LOW | MEDIUM | HIGH"],["EXECUTION", "LOW | MEDIUM | HIGH"],["RISK", "LOW | MEDIUM | HIGH"]],

"executiveDecision": [["Why this works", ""],["Why this fails", ""],["What to do now", ""]],

"founderDecision": "",

"marketCards": [["TAM", ""],["SAM", ""],["SOM", ""],["GROWTH", ""]],

"marketFunnel": [{ "label": "TAM", "value": "", "score": 100 },{ "label": "SAM", "value": "", "score": 60 },{ "label": "SOM", "value": "", "score": 20 }],

"tamSamSom": [["TAM", "", "", ""],["SAM", "", "", ""],["SOM", "", "", ""]],

"marketInsight": "",

"customerTruth": [["", "", ""],["", "", ""],["", "", ""]],

"customerOpportunity": [["", "", ""],["", "", ""],["", "", ""],["", "", ""]],

"buyingTrigger": "","customerSummary": "",

"competitionMap": [["", "", "", ""],["", "", "", ""],["", "", "", ""],["", "", "", ""]],

"competitionConclusion": "",

"benchmarkRows": [["", "", ""],["", "", ""],["", "", ""]],

"unitEconomicsCards": [["CAC", ""],["LTV", ""],["AOV", ""],["REPEAT", ""]],

"unitEconomicsScore": {"ltvToCac": "","payback": "","margin": "","status": "PASS | WATCH | FAIL"},

"unitEconomicsTable": [["CAC", "", "", ""],["LTV", "", "", ""],["AOV", "", "", ""],["Repeat", "", "", ""]],

"economicsJudgment": "",

"marketingStrategy": {"channelFit": [["", "LOW | MEDIUM | HIGH | WATCH", "", ""],["", "LOW | MEDIUM | HIGH | WATCH", "", ""],["", "LOW | MEDIUM | HIGH | WATCH", "", ""],["", "LOW | MEDIUM | HIGH | WATCH", "", ""]],"contentPlaybook": ["", "", "", "", ""],"thirtyDayMarketingTest": [["Week 1", "", ""],["Week 2", "", ""],["Week 3", "", ""],["Week 4", "", ""],["Week 5", "", ""],["Week 6", "", ""],["Week 7", "", ""],["Week 8", "", ""],["Week 9", "", ""],["Week 10", "", ""],["Week 11", "", ""],["Week 12", "", ""]]},

"businessModel": {"revenueLayers": [["", "", ""],["", "", ""],["", "", ""]],"modelJudgment": "","modelDeepDive": ""},

"riskSystem": [["", "", ""],["", "", ""],["", "", ""]],

"executionPlan": [["Phase 1", "", ""],["Phase 2", "", ""],["Phase 3", "", ""]],

"operatingRule": "",

"goThreshold": [["CAC", "", ""],["Conversion", "", ""],["Repeat", "", ""],["Margin", "", ""]],

"goChecklist": [{ "label": "CAC", "status": "PASS | WATCH | FAIL" },{ "label": "Conversion", "status": "PASS | WATCH | FAIL" },{ "label": "Repeat Purchase", "status": "PASS | WATCH | FAIL" },{ "label": "Margin", "status": "PASS | WATCH | FAIL" }],

"finalRule": "",

"dataConfidence": {"overallLevel": "LOW | MEDIUM | HIGH","summary": "","sourceQuality": [["", "", ""],["", "", ""],["", "", ""]],"limits": ["", "", ""]},

"sensitivityAnalysis": {"cacLtvTable": [["Low CAC", "", "", ""],["Base CAC", "", "", ""],["High CAC", "", "", ""]],"criticalBreakPoint": "","founderWarning": ""},

"profitSimulation": {"monthlyScenarioTable": [["Conservative", "", "", "", "", ""],["Base", "", "", "", "", ""],["Aggressive", "", "", "", "", ""]],"breakEvenPoint": "","profitJudgment": "","cashRisk": ""},

"killCriteria": {"rules": [["", "", ""],["", "", ""],["", "", ""],["", "", ""]],"stopDecision": "","pivotDecision": "","scaleDecision": ""},

"appendix": {"dataSources": [["", "", ""],["", "", ""],["", "", ""]],"assumptions": ["", "", "", ""]},

"referenceLinks": [["", ""],["", ""],["", ""],["", ""],["", ""]]}Glossary rules:

Explain important business terms used in the report.

Include terms such as TAM, SAM, SOM, CAC, LTV, AOV, Margin, Retention, Conversion when relevant.

Meanings must be simple enough for a non-expert founder.

whyItMatters must explain how the term affects the business decision.

Business diagnosis rules:

Classify the business industry type.

Classify the business model type.

Explain country-specific buying behavior.

Identify the biggest bottleneck.

Recommend the best first offer.

Define the first validation experiment.

Data confidence rules:

Explain how reliable the market and unit economics assumptions are.

Separate public data, platform observations, and assumptions.

Clearly state what is uncertain.

Do not pretend exact data exists when it does not.

Reference links rules:

referenceLinks must contain relevant sources for the selected country, industry, and business model.

Each row must contain: Source name, URL.

Use official statistics, market platforms, trend tools, or industry-specific sources when relevant.

Do not use fixed pet, food, ecommerce, or Korea-only sources unless they match the user's business input.

Sensitivity analysis rules:

Show how the business changes when CAC rises or LTV falls.

cacLtvTable columns must be: Scenario, CAC, LTV, Decision.

criticalBreakPoint must explain the point where the business becomes unprofitable.

founderWarning must be direct and practical.

Profit simulation rules:

monthlyScenarioTable columns must be: Scenario, Customers, Revenue, Marketing Cost, Estimated Profit, Judgment.

Use realistic monthly customer acquisition assumptions.

Include marketing cost, gross margin, fulfillment cost if relevant.

breakEvenPoint must explain when the business starts making money.

profitJudgment must clearly say whether this business can make money.

cashRisk must explain the cashflow risk for the founder.

Kill criteria rules:

Define measurable stop conditions.

Rules columns must be: Metric, Kill Line, Action.

Include CAC, conversion rate, repeat purchase, margin, refund/churn when relevant.

stopDecision must say when to stop.

pivotDecision must say when to change offer/model.

scaleDecision must say when to increase budget.

Calculation rules:

TAM must describe the total reachable category demand.

SAM must narrow TAM to the country/channel/customer segment.

SOM must be a realistic first 12-month obtainable market.

Unit economics must include CAC, AOV, LTV, repeat purchase, margin, and payback.

LTV/CAC must be calculated logically.

Marketing channels must match the selected country.

Execution plan must be actionable within 30 days.

GO threshold must define measurable pass/fail criteria.

Appendix must include assumed data sources and assumptions.

Scoring logic:

Market score: demand size + urgency + accessibility.

Profitability score: margin + LTV/CAC + repeat purchase potential.

Execution score: founder feasibility + launch cost + operational complexity.

Risk score: higher number means higher risk pressure.

Overall cover.score should reflect weighted judgment.

Decision logic:

GO: score 75+, strong demand, viable unit economics.

HOLD: score 50-74, needs validation.

NO GO: below 50, weak economics or market access.

Now generate the JSON report.`}

function buildFreeReportFromPaidReport(fullReport) {return {cover: fullReport.cover,

    businessDiagnosis: fullReport.businessDiagnosis,

    executiveDecision: fullReport.executiveDecision,

    marketCards: fullReport.marketCards,

    customerSummary: fullReport.customerSummary,

    isPaid: false,
    reportMode: "free",

    lockedSections: {
        message:
            "Full analysis including market reality, customer behavior, profit structure, and execution strategy is available in the paid report.",
    },
}

}

async function generateDeepReportJson(input) {const { brandName, productService, targetCustomer, language } = input

const systemPrompt = buildPaidReportPrompt({
    brandName,
    productService,
    targetCustomer,
    language,
})

const userPrompt = JSON.stringify({
    brandName,
    productService,
    targetCustomer,
    language,
    reportType: "paid",
})

const completion = await openai.chat.completions.create({
model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
})

const raw = completion.choices?.[0]?.message?.content

if (!raw) throw new Error("Empty OpenAI response.")

let parsed

try {parsed = JSON.parse(raw)} catch (parseError) {console.error("[OPENAI_JSON_PARSE_ERROR]", parseError)console.error("[OPENAI_JSON_RAW_START]", raw.slice(0, 1200))console.error("[OPENAI_JSON_RAW_ERROR_AREA]", raw.slice(8800, 9800))console.error("[OPENAI_JSON_RAW_END]", raw.slice(-1200))

throw new Error(
    `OpenAI returned invalid JSON. ${String(parseError?.message || parseError)}`
)

}

return normalizeDeepReport(parsed, input)}



async function generateFreeReportJson(input) {const deep = await generateDeepReportJson(input)

return {
    ...deep,
    cover: {
        ...deep.cover,
        subtitle: `${deep.cover.subtitle} — Free Decision Sample`,
    },
}

}

function normalizeDeepReport(report, input) {return {cover: {brandName: report?.cover?.brandName || input.brandName || "",decision: report?.cover?.decision || "HOLD",score: Number.isFinite(report?.cover?.score)? report.cover.score: 50,subtitle: report?.cover?.subtitle || input.productService || "",oneLineVerdict: report?.cover?.oneLineVerdict || "",},

    brandNaming: {
        brandDirection: report?.brandNaming?.brandDirection || "",
        namingStrategy: report?.brandNaming?.namingStrategy || "",
        keywords: safeArray(report?.brandNaming?.keywords, []).slice(0, 8),
        nameCandidates: safeArray(
            report?.brandNaming?.nameCandidates,
            []
        ).slice(0, 5),
        recommendedName: {
            name: report?.brandNaming?.recommendedName?.name || "",
            reason: report?.brandNaming?.recommendedName?.reason || "",
            positioning:
                report?.brandNaming?.recommendedName?.positioning || "",
            expansionPotential:
                report?.brandNaming?.recommendedName
                    ?.expansionPotential || "",
        },
        domainSuggestions: safeArray(
            report?.brandNaming?.domainSuggestions,
            []
        ).slice(0, 5),
    },
    
    glossary: safeArray(
        report?.glossary,
        getDefaultGlossary(input.language || "en")
    ).slice(0, 5),

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
    benchmarkRows: safeArray(report?.benchmarkRows, []).slice(0, 3),

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
        channelFit: safeArray(
            report?.marketingStrategy?.channelFit,
            []
        ).slice(0, 4),
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
revenueLayers: safeArray(
    report?.businessModel?.revenueLayers,
    []
).slice(0, 3),
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
        founderWarning:
            report?.sensitivityAnalysis?.founderWarning || "",
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
}

}

function buildHtmlFromTemplate(report, locale) {const templatePath = path.join(__dirname, "templates", "deep-report.html")let html = fs.readFileSync(templatePath, "utf8")

const matrix = objectFromPairs(report.decisionMatrix)
const market = objectFromPairs(report.marketCards)
const unit = objectFromPairs(report.unitEconomicsCards)
const execMap = objectFromPairs(report.executiveDecision)

const funnel = normalizeFunnel(report.marketFunnel)

const lockedMessage = t(locale,"locked.message",report?.lockedSections?.message ||"Core data and execution strategy are available in the paid report.")

const lockedTitle = t(locale, "locked.title", "Paid report only")const lockedButton = t(locale, "locked.button", "Premium Report")

const scoreGuideRows = getLocaleTable(locale, "tables.scoreGuideRows", [["85~100", "Excellent", "Strong GO candidate. Scaling may be considered."],["70~84", "Good", "GO is possible if key conditions are met."],["50~69", "Average / Needs validation", "HOLD. Decide after a small test."],["30~49", "Risky", "High NO GO probability. Redesign the structure."],["0~29", "Very risky", "Stop immediately or fully reconsider."],])

const customerOpportunityRows = Array.isArray(report?.customerOpportunity)? report.customerOpportunity: []

const benchmarkRows = Array.isArray(report?.benchmarkRows)? report.benchmarkRows: []

const referenceLinks = Array.isArray(report?.referenceLinks)? report.referenceLinks: []

const data = {

    industryType: report.businessDiagnosis?.industryType || "",
    businessModelType: report.businessDiagnosis?.businessModelType || "",
    countryMarketBehavior: report.businessDiagnosis?.countryMarketBehavior || "",
    marketEntryDifficulty: report.businessDiagnosis?.marketEntryDifficulty || "",
    mainBottleneck: report.businessDiagnosis?.mainBottleneck || "",
    bestFirstOffer: report.businessDiagnosis?.bestFirstOffer || "",
    validationExperiment: report.businessDiagnosis?.validationExperiment || "",
    goNoGoLogic: report.businessDiagnosis?.goNoGoLogic || "",
    
    structureSummary: report.businessDiagnosis?.structureSummary || "",

    dataConfidenceLevel: report.dataConfidence?.overallLevel || "",
    dataConfidenceSummary: report.dataConfidence?.summary || "",
    criticalBreakPoint: report.sensitivityAnalysis?.criticalBreakPoint || "",
    founderWarning: report.sensitivityAnalysis?.founderWarning || "",

    breakEvenPoint: report.profitSimulation?.breakEvenPoint || "",
    profitJudgment: report.profitSimulation?.profitJudgment || "",
    cashRisk: report.profitSimulation?.cashRisk || "",

    stopDecision: report.killCriteria?.stopDecision || "",
    pivotDecision: report.killCriteria?.pivotDecision || "",
    scaleDecision: report.killCriteria?.scaleDecision || "",
    
    lang: locale.lang,
    fontFamily: locale.fontFamily,

    reportTitleSuffix: locale.reportTitleSuffix,
    scoreLabel: locale.scoreLabel,

    footerLeft: locale.footer?.left || "GoNoGo™",

    ...flattenLabels(locale.labels),
    ...flattenNotes(locale.fixedNotes),

    brandName: report.cover.brandName,
    decision: report.cover.decision,
    score: report.cover.score,

decisionClass: getStatusClass(report.cover?.decision),subtitle: report.cover.subtitle,oneLineVerdict: report.cover.oneLineVerdict,

// 🔥🔥🔥 여기부터 추가 🔥🔥🔥

brandDirection: report?.brandNaming?.brandDirection || "",namingStrategy: report?.brandNaming?.namingStrategy || "",

brandKeywordCards: Array.isArray(report?.brandNaming?.keywords)? report.brandNaming.keywords.slice(0, 8).map((keyword) =>         <div class="card">
            <div class="card-title">${locale.brand_keyword_label || "Keyword"}</div>
            <div class="card-value">${keyword}</div>
        </div>
   ).join(""): "",

brandNameCandidateRows: Array.isArray(report?.brandNaming?.nameCandidates)? report.brandNaming.nameCandidates.slice(0, 5).map((item) =>         <tr>
            <td>${item?.name || ""}</td>
            <td>${item?.meaning || ""}</td>
            <td>${item?.fit || ""}</td>
            <td>${item?.risk || ""}</td>
            <td>${item?.score || ""}</td>
        </tr>
   ).join(""): "",

recommendedBrandName: report?.brandNaming?.recommendedName?.name || "",

recommendedBrandReason: [report?.brandNaming?.recommendedName?.reason || "",report?.brandNaming?.recommendedName?.positioning || "",report?.brandNaming?.recommendedName?.expansionPotential || "",].filter(Boolean).join(" "),

brandDomainRows: Array.isArray(report?.brandNaming?.domainSuggestions)? report.brandNaming.domainSuggestions.slice(0, 5).map((item) =>         <tr>
            <td>${item?.domain || ""}</td>
            <td>${item?.reason || ""}</td>
            <td>${item?.availability || ""}</td>
        </tr>
   ).join(""): "",

// 🔥🔥🔥 여기까지 🔥🔥🔥

    marketLevel: matrix.MARKET || "",
    profitabilityLevel: matrix.PROFITABILITY || "",
    executionLevel: matrix.EXECUTION || "",
    riskLevel: matrix.RISK || "",

    marketScore: report.visualScores.market,
    profitabilityScore: report.visualScores.profitability,
    executionScore: report.visualScores.execution,
    riskScore: report.visualScores.risk,

    marketScoreClass: getScoreClass(report.visualScores.market),
    profitabilityScoreClass: getScoreClass(report.visualScores.profitability),
    executionScoreClass: getScoreClass(report.visualScores.execution),
    riskScoreClass: getRiskScoreClass(report.visualScores.risk),

    ltvToCac: report.unitEconomicsScore.ltvToCac,
    unitEconomicsStatus: report.unitEconomicsScore.status,
    paybackValue: report.unitEconomicsScore.payback,

    whyItWorks: execMap["Why this works"] || "",
    whyItFails: execMap["Why this fails"] || "",
    whatToDoNow: execMap["What to do now"] || "",
    founderDecision: report.founderDecision,

    tamValue: market.TAM || funnel.tam.value,
    samValue: market.SAM || funnel.sam.value,
    somValue: market.SOM || funnel.som.value,
    growthValue: market.GROWTH || "",

    tamScore: funnel.tam.score,
    samScore: funnel.sam.score,
    somScore: funnel.som.score,

    marketInsight: report.marketInsight,
    buyingTrigger: report.buyingTrigger,
    customerSummary: report.customerSummary || "",

    cacValue: unit.CAC || "",
    ltvValue: unit.LTV || "",
    aovValue: unit.AOV || "",
    repeatValue: unit.REPEAT || "",

    economicsJudgment: report.economicsJudgment,
    
    modelJudgment: report.businessModel.modelJudgment,
    
    operatingRule: report.operatingRule,
    finalRule: report.finalRule,
    decisionChart: buildDecisionChart(report, locale),

    competitionPositionChart: competitionPositionChart(report.competitionMap, locale),
    riskHeatmap: riskHeatmap(report.riskSystem, locale),
    executionTimeline: executionTimeline(report.executionPlan, locale),
    decisionSummaryBox: decisionSummaryBox(report, locale),
    
}

const templateData = {...locale,...data}

html = html
    
    .replace("{{modelDeepDive}}", report?.businessModel?.modelDeepDive || "")
    .replace("{{referenceLinkRows}}", rows(referenceLinks))
    
    .replace("{{glossaryRows}}", glossaryRows(report.glossary))
    .replace("{{scoreGuideRows}}", rows(scoreGuideRows))
    .replace("{{marketFunnelChart}}", marketFunnelChart(report.marketFunnel))
    .replaceAll(
"{{profitSimulationChart}}",
profitSimulationChart(report.profitSimulation?.monthlyScenarioTable, locale)

).replace("{{cacLtvRiskChart}}",cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale)).replace("{{tamSamSomRows}}",report?.lockedSections?.tamSamSom? <tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.tamSamSom)).replace("{{customerTruthRows}}", rows(report.customerTruth)).replace("{{customerOpportunityRows}}", rows(customerOpportunityRows)).replace("{{competitionRows}}",report?.lockedSections?.competition?<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.competitionMap)).replace("{{competitionPositionChart}}", competitionPositionChart(report.competitionMap, locale)).replace("{{competitionConclusion}}",report?.lockedSections?.competition? esc(lockedMessage): esc(report.competitionConclusion))

.replace("{{benchmarkRows}}", rows(benchmarkRows))

    .replace(
"{{unitEconomicsRows}}",
report?.lockedSections?.unitEconomics
    ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
    : rows(report.unitEconomicsTable)

).replace("{{marketingChannelRows}}",report?.lockedSections?.marketing? <tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.marketingStrategy.channelFit)).replace("{{contentPlaybookItems}}",report?.lockedSections?.marketing? <li>${esc(lockedMessage)}</li>: listItems(report.marketingStrategy.contentPlaybook)).replace("{{marketingTestRows}}",report?.lockedSections?.marketing? <tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.marketingStrategy.thirtyDayMarketingTest))

.replace("{{businessModelRows}}",rows(report.businessModel.revenueLayers)).replace("{{riskRows}}",report?.lockedSections?.risk? <tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.riskSystem)).replace("{{riskHeatmap}}",report?.lockedSections?.risk? "": riskHeatmap(report.riskSystem, locale)).replace("{{executionRows}}",report?.lockedSections?.execution? <tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.executionPlan)).replace("{{executionTimeline}}",report?.lockedSections?.execution? "": executionTimeline(report.executionPlan, locale)).replace("{{decisionSummaryBox}}", decisionSummaryBox(report, locale)).replace("{{goThresholdRows}}",report?.lockedSections?.goThreshold? <tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>: rows(report.goThreshold)).replace("{{goChecklistItems}}", checklistItems(report.goChecklist))

.replace("{{sourceQualityRows}}", rows(report.dataConfidence?.sourceQuality)).replace("{{dataLimitItems}}", listItems(report.dataConfidence?.limits)).replace("{{referenceLinkRows}}", rows(referenceLinks)).replace("{{cacLtvRows}}", rows(report.sensitivityAnalysis?.cacLtvTable)).replace("{{profitSimulationRows}}", rows(report.profitSimulation?.monthlyScenarioTable)).replace("{{killCriteriaRows}}", rows(report.killCriteria?.rules)).replace("{{dataSourceRows}}", rows(report.appendix.dataSources)).replace("{{assumptionItems}}", listItems(report.appendix.assumptions))

validateTemplateKeys(html, templateData, [
"modelDeepDive",
"profitSimulationChart",
"referenceLinkRows",
"glossaryRows",
"scoreGuideRows",
"marketFunnelChart",
"cacLtvRiskChart",
"tamSamSomRows",
"customerTruthRows",
"customerOpportunityRows",
"competitionRows",
"competitionConclusion",
"benchmarkRows",
"unitEconomicsRows",
"marketingChannelRows",
"contentPlaybookItems",
"marketingTestRows",
"businessModelRows",
"riskRows",
"executionRows",
"goThresholdRows",
"goChecklistItems",
"sourceQualityRows",
"dataLimitItems",
"referenceLinkRows",
"cacLtvRows",
"profitSimulationRows",
"killCriteriaRows",
"dataSourceRows",
"assumptionItems",

])

html = applyTemplateVars(html, templateData)

if (report?.reportMode === "free") {html = keepFreeReportOnly(html, locale, report)}

html = injectReportBackButton(html, locale)

html = html.replace(/{{[^}]+}}/g, "")

return html}

function keepFreeReportOnly(html, locale = {}, report = {}) {const splitPoint = ""const index = html.indexOf(splitPoint)

if (index === -1) {
    console.log("[FREE_SPLIT_POINT_NOT_FOUND]")
    return html
}

const freePart = html.slice(0, index)

const footerLeft = t(locale, "footer.left", "GoNoGo™ Business Decision Report")
const premiumFooter = t(locale, "premium.footer", "Premium Locked")

const recommendedName =
    report?.brandNaming?.recommendedName?.name ||
    report?.brandNaming?.nameCandidates?.[0]?.name ||
    report?.cover?.brandName ||
    "Your Brand Name"

const nameReason =
    report?.brandNaming?.recommendedName?.reason ||
    "This name direction is connected to the business idea, target customer, and market positioning."

const score = Number.isFinite(report?.cover?.score) ? report.cover.score : 0
const decision = report?.cover?.decision || "HOLD"

const checkoutUrl =process.env.PAYWALL_CHECKOUT_URL ||"/api/dev-create-paid-token"

return `

${freePart}

<div style="
  height:12px;
  background:#e1ebe5;
  border-radius:999px;
  overflow:hidden;
  margin-bottom:10px;
">
  <div style="
    height:100%;
    width:65%;
    background:#2f7d57;
    border-radius:999px;
  "></div>
</div>

<div style="
  display:flex;
  justify-content:space-between;
  gap:12px;
  font-size:12px;
  font-weight:800;
  color:#4b5d53;
  margin-bottom:22px;
">
  <span>${esc(t(locale, "premium.freeUnlocked", "Free judgment unlocked"))}</span>
  <span>65%</span>
</div>

<div style="
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:14px;
  margin-bottom:18px;
">
  <div style="
    border:1px solid #d8e7dc;
    background:#f6faf7;
    padding:16px;
  ">
    <div style="
      font-size:10px;
      font-weight:900;
      color:#5b7065;
      text-transform:uppercase;
      letter-spacing:0.04em;
      margin-bottom:8px;
    ">
      ${esc(t(locale, "premium.currentDecision", "Current Decision Signal"))}
    </div>
    <div style="
      font-size:34px;
      line-height:1;
      font-weight:900;
      color:#163c2b;
      letter-spacing:-0.06em;
    ">
      ${esc(decision)}
    </div>
    <div style="
      margin-top:8px;
      font-size:13px;
      font-weight:800;
      color:#4b5d53;
    ">
      ${esc(t(locale, "premium.scoreText", "Score"))}: ${esc(String(score))} / 100

    </div>
  </div>

  <div style="
    border:1px solid #163c2b;
    background:#163c2b;
    color:#fff;
    padding:16px;
  ">
    <div style="
      font-size:10px;
      font-weight:900;
      opacity:0.82;
      text-transform:uppercase;
      letter-spacing:0.04em;
      margin-bottom:8px;
    ">
      ${esc(t(locale, "premium.brandHookLabel", "Recommended Brand Preview"))}
    </div>
    <div style="
      font-size:30px;
      line-height:1.05;
      font-weight:900;
      letter-spacing:-0.05em;
    ">
      ${esc(recommendedName)}
    </div>
    <div style="
      margin-top:10px;
      font-size:12px;
      line-height:1.5;
      opacity:0.86;
    ">
      ${esc(nameReason)}

    </div>
  </div>
</div>

<div style="
  position:relative;
  border:1px solid #d8e7dc;
  background:#fbfdfb;
  padding:16px;
  margin-bottom:18px;
  overflow:hidden;
">
  <div style="
    filter:blur(4px);
    opacity:0.55;
    font-size:13px;
    line-height:1.8;
    font-weight:700;
  ">
    <div>✓ Why this name works for the target customer</div>
    <div>✓ Domain suggestions and availability logic</div>
    <div>✓ Customer buying trigger and hesitation signals</div>
    <div>✓ Market size, competition map, revenue structure</div>
    <div>✓ 12-week execution plan, risk system, kill criteria</div>
  </div>

  <div style="
    position:absolute;
    inset:0;
    display:flex;
    align-items:center;
    justify-content:center;
    background:linear-gradient(90deg, rgba(251,253,251,0.72), rgba(251,253,251,0.92));
  ">
    <div style="
      background:#fff;
      border:1px solid #d8e7dc;
      padding:10px 14px;
      font-size:12px;
      font-weight:900;
      color:#163c2b;
      box-shadow:0 8px 22px rgba(16,32,24,0.10);
    ">
      ${esc(t(locale, "premium.lockedLabel", "Locked decision layer"))}
    </div>
  </div>
</div>

<div style="
  display:grid;
  grid-template-columns:1fr 1fr 1fr;
  gap:10px;
  margin-bottom:18px;
">
  <div style="border:1px solid #d8e7dc; padding:12px; background:#f6faf7;">
    <div style="font-size:11px;font-weight:900;color:#2f7d57;margin-bottom:6px;">
      ${esc(t(locale, "premium.unlock01Title", "Brand + Domain"))}
    </div>
    <div style="font-size:12px;line-height:1.45;">
      ${esc(t(locale, "premium.unlock01Desc", "Get the name, strategy, and domain direction."))}
    </div>
  </div>

  <div style="border:1px solid #d8e7dc; padding:12px; background:#f6faf7;">
    <div style="font-size:11px;font-weight:900;color:#2f7d57;margin-bottom:6px;">
      ${esc(t(locale, "premium.unlock02Title", "Customer Truth"))}
    </div>
    <div style="font-size:12px;line-height:1.45;">
      ${esc(t(locale, "premium.unlock02Desc", "See why customers buy and why they hesitate."))}
    </div>
  </div>

  <div style="border:1px solid #d8e7dc; padding:12px; background:#f6faf7;">
    <div style="font-size:11px;font-weight:900;color:#2f7d57;margin-bottom:6px;">
      ${esc(t(locale, "premium.unlock03Title", "Execution Plan"))}
    </div>
    <div style="font-size:12px;line-height:1.45;">
      ${esc(t(locale, "premium.unlock03Desc", "Know what to test, when to stop, and when to scale."))}
    </div>
  </div>
</div>

<div style="
  background:#f3f8f5;
  border-left:5px solid #2f7d57;
  padding:16px;
  margin-bottom:18px;
">
  <div style="
    font-size:16px;
    line-height:1.45;
    font-weight:900;
    color:#102018;
    margin-bottom:6px;
  ">
    ${esc(t(locale, "premium.ctaTitle", "Do not spend months building the wrong business."))}
  </div>
  <div style="
    font-size:13px;
    line-height:1.65;
    color:#33443b;
  ">
    ${esc(t(locale, "premium.ctaDesc", "Unlock the full decision report before you spend money on branding, product development, ads, inventory, or a website."))}
  </div>
</div>

<a href="${esc(checkoutUrl)}" style="
  display:block;
  text-align:center;
  background:#102018;
  color:#fff;
  text-decoration:none;
  font-weight:900;
  font-size:16px;
  padding:16px 18px;
  border-radius:10px;
  letter-spacing:-0.02em;
">
  ${esc(t(locale, "premium.ctaButton", "Check if this business is worth continuing"))} — $49
</a>

<div style="
  margin-top:12px;
  font-size:11px;
  line-height:1.5;
  color:#6a7a71;
  text-align:center;
">
  ${esc(t(locale, "premium.ctaSub", "Brand name, customer reaction, and revenue structure — validate them now."))}
</div>
