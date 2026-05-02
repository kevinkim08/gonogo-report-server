import express from "express"
import cors from "cors"
import OpenAI from "openai"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"

const app = express()
const PORT = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.json({ limit: "5mb" }))

import cors from "cors"

app.use(
    cors({
        origin: (origin, callback) => {
            // Postman / 서버 내부 요청 허용
            if (!origin) return callback(null, true)

            try {
                const url = new URL(origin)
                const hostname = url.hostname

                const allowed =
                    hostname === "localhost" ||
                    hostname === "127.0.0.1" ||
                    hostname.endsWith(".framer.app") ||
                    hostname.endsWith(".framer.website") ||
                    hostname.endsWith(".onrender.com")

                if (allowed) {
                    return callback(null, true)
                }

                console.log("[CORS_BLOCKED]", origin)
                return callback(new Error("Not allowed by CORS"))
            } catch (err) {
                return callback(new Error("Invalid origin"))
            }
        },
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
    })
)

// preflight 요청 처리 (중요)
app.options("*", cors())

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "GoNoGo Report Server",
        version: "2.2.0-multilingual-pdf",
    })
})

app.get("/api/health", (req, res) => {
    res.json({ ok: true, status: "healthy" })
})

app.get("/api/debug-html", async (req, res) => {
    try {
        const language = normalizeLanguage(
            req.query.lang || req.query.language || "ko"
        )

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
        const locale = loadLocale(normalizedLanguage)

        const normalizedReportType =
            reportType === "paid" || reportType === "deep" ? "paid" : "free"

      const paidReport = await generateDeepReportJson({
    brandName,
    productService,
    targetCustomer,
    language,
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

function buildPaidReportPrompt({ brandName, productService, targetCustomer, language }) {
    const languageName = getLanguageName(language)

    return `
You are GoNoGo, a ruthless business decision engine.

You are NOT a writer.
You are NOT a generic consultant.
You are a paid business decision report engine.

Your job:
Evaluate this business idea and generate a premium PDF-ready JSON report.

Final report language: ${languageName}

Business Input:
- Brand Name: ${brandName}
- Product / Service: ${productService}
- Target Customer: ${targetCustomer}
- Language / Market: ${language}

Critical rules:
1. Output VALID JSON only.
2. No markdown.
3. No explanation outside JSON.
4. Use the exact JSON shape provided below.
5. Do not use placeholders.
6. Every table cell must contain real content.
7. Use realistic assumptions when exact data is unavailable.
8. Clearly state assumptions in appendix.
9. Use country-specific market logic.
10. Be conservative, not optimistic.
11. If the business is weak, say it clearly.
12. All scores must be numbers from 0 to 100.
13. Keep table cells concise but meaningful.
14. Make the report directly useful for founder decision-making.
15. You must return every field in the exact JSON structure.
16. Never omit required keys.
17. Never rename keys.
18. Never add new top-level keys.
19. Every array must keep the required number of rows.
20. Every table row must keep the required number of columns.
21. If data is uncertain, write a conservative assumption instead of leaving it blank.
22. Do not use null.
23. Do not use undefined.
24. Do not use empty strings unless the field is truly impossible.
25. Keep all table cells short and layout-safe.
26. This rule applies ONLY to table cells.
27. Narrative fields must be deeper and more informative.

Layout safety rules:
- Table cells must be short.
- Each table cell should be 8 to 18 words maximum in English.
- For Japanese, Chinese, and Mongolian, keep table cells shorter than English.
- Do not write full paragraphs inside table cells.
- Long explanations must go only into text fields such as marketInsight, buyingTrigger, economicsJudgment, modelJudgment, operatingRule, finalRule, founderWarning.
- Do not put line breaks inside table cells.
- Do not use very long compound phrases inside table cells.
- Avoid repeating the same sentence across multiple cells.
- Numbers, ranges, and decisions should be concise.
- Use clear, founder-friendly wording.

Narrative depth rules (CRITICAL):

customerSummary:
- 3 to 4 sentences
- Summarize both positive buying signals and negative hesitation signals.
- Explain what actually makes the customer buy.
- Explain what blocks the customer from buying.
- End with the most important validation point.

- The report must not feel shallow.
- Narrative fields are the core of decision quality.

structureSummary:
- 3 to 4 sentences
- Rewrite the business diagnosis table into a connected business story.
- Explain how the business actually operates in reality.
- Include business type, revenue model, entry difficulty, bottleneck, and validation logic.

For the following fields, write deeper, structured explanations:

marketInsight:
- 3 to 4 sentences
- Explain: market structure → limitation → real opportunity → strategic implication

economicsJudgment:
- 3 to 4 sentences
- Explain: cost structure → CAC pressure → margin reality → survival condition

modelJudgment:
- 3 to 4 sentences
- Explain: why this model works or fails → structural weakness → how to fix

modelDeepDive:
- 3 to 5 sentences
- Explain the deeper business model mechanics.
- Cover revenue logic, repeat purchase or retention logic, margin pressure, operational weakness, and the best structural improvement.
- This must not repeat modelJudgment.

operatingRule:
- 2 to 3 sentences
- Must define a clear decision rule (what to track and when to stop)

profitJudgment:
- 3 to 4 sentences
- Explain: scaling condition → risk → realistic expectation

breakEvenPoint:
- 2 to 3 sentences
- Explain: when business becomes viable → key threshold → constraint

Additional rules:
- Each explanation must include:
  1. Cause
  2. Business meaning
  3. Action implication

- Avoid generic phrases such as "this is important" or "this is needed"
- Avoid repeating the same logic across sections
- Each section must provide a different angle of insight

Array stability rules:
- glossary must contain exactly 5 items.
- decisionMatrix must contain exactly 4 rows.
- marketCards must contain exactly 4 rows.
- marketFunnel must contain exactly 3 items: TAM, SAM, SOM.
- tamSamSom must contain exactly 3 rows.
- customerTruth must contain exactly 3 rows.
- customerOpportunity must contain exactly 4 rows.
- competitionMap must contain exactly 4 rows.
- benchmarkRows must contain exactly 3 rows.
- unitEconomicsCards must contain exactly 4 rows.
- unitEconomicsTable must contain exactly 4 rows.
- marketingStrategy.channelFit must contain exactly 4 rows.
- marketingStrategy.contentPlaybook must contain exactly 5 items.
- marketingStrategy.thirtyDayMarketingTest must contain exactly 12 rows and represent a 12-week / 3-month test plan.
- businessModel.revenueLayers must contain exactly 3 rows.
- riskSystem must contain exactly 3 rows.
- executionPlan must contain exactly 3 rows.
- goThreshold must contain exactly 4 rows.
- goChecklist must contain exactly 4 items.
- dataConfidence.sourceQuality must contain exactly 3 rows.
- dataConfidence.limits must contain exactly 3 items.
- sensitivityAnalysis.cacLtvTable must contain exactly 3 rows.
- profitSimulation.monthlyScenarioTable must contain exactly 3 rows.
- killCriteria.rules must contain exactly 4 rows.
- appendix.dataSources must contain exactly 3 rows.
- appendix.assumptions must contain exactly 4 items.
- referenceLinks must contain exactly 5 rows.

Language output rules:
- All user-facing values must be written in the final report language.
- Do not mix Korean into English, Japanese, Chinese, or Mongolian reports.
- Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.
- For Japanese, Chinese, and Mongolian, keep sentences compact to protect PDF layout.

Narrative tone rules:
- Write like a strategy consultant, not a content writer
- Be direct, specific, and decision-oriented
- Avoid storytelling, focus on judgment
- Each paragraph should help a founder decide "go / pivot / stop"

Country strategy rules:
- ko: Korea-first. Consider Naver, Kakao, Coupang, SmartStore, Instagram, YouTube Shorts, local payment behavior, Korean price sensitivity.
- en: Global / English market. Consider Google, Meta, Amazon, Shopify, TikTok, Reddit, creator ads, DTC funnel.
- ja: Japan-first. Consider LINE, Rakuten, Yahoo Japan, Amazon JP, trust-heavy purchase behavior, conservative adoption.
- zh: Chinese-speaking market. Consider WeChat, Xiaohongshu, Douyin, Tmall, group commerce, social proof, KOL/KOC.
- mn: Mongolia-first. Consider Facebook commerce, bank transfer, offline trust, messenger sales, low-friction purchase behavior.

Important:
Your JSON must match the current HTML template structure exactly.

Return this exact JSON shape:

{
  "cover": {
    "brandName": "${brandName}",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },

  "glossary": [
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    }
  ],

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

  "benchmarkRows": [
  ["", "", ""],
  ["", "", ""],
  ["", "", ""]
],

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
Glossary rules:
- Explain important business terms used in the report.
- Include terms such as TAM, SAM, SOM, CAC, LTV, AOV, Margin, Retention, Conversion when relevant.
- Meanings must be simple enough for a non-expert founder.
- whyItMatters must explain how the term affects the business decision.

Business diagnosis rules:
- Classify the business industry type.
- Classify the business model type.
- Explain country-specific buying behavior.
- Identify the biggest bottleneck.
- Recommend the best first offer.
- Define the first validation experiment.

Data confidence rules:
- Explain how reliable the market and unit economics assumptions are.
- Separate public data, platform observations, and assumptions.
- Clearly state what is uncertain.
- Do not pretend exact data exists when it does not.

Reference links rules:
- referenceLinks must contain relevant sources for the selected country, industry, and business model.
- Each row must contain: Source name, URL.
- Use official statistics, market platforms, trend tools, or industry-specific sources when relevant.
- Do not use fixed pet, food, ecommerce, or Korea-only sources unless they match the user's business input.

Sensitivity analysis rules:
- Show how the business changes when CAC rises or LTV falls.
- cacLtvTable columns must be: Scenario, CAC, LTV, Decision.
- criticalBreakPoint must explain the point where the business becomes unprofitable.
- founderWarning must be direct and practical.

Profit simulation rules:
- monthlyScenarioTable columns must be: Scenario, Customers, Revenue, Marketing Cost, Estimated Profit, Judgment.
- Use realistic monthly customer acquisition assumptions.
- Include marketing cost, gross margin, fulfillment cost if relevant.
- breakEvenPoint must explain when the business starts making money.
- profitJudgment must clearly say whether this business can make money.
- cashRisk must explain the cashflow risk for the founder.

Kill criteria rules:
- Define measurable stop conditions.
- Rules columns must be: Metric, Kill Line, Action.
- Include CAC, conversion rate, repeat purchase, margin, refund/churn when relevant.
- stopDecision must say when to stop.
- pivotDecision must say when to change offer/model.
- scaleDecision must say when to increase budget.

Calculation rules:
- TAM must describe the total reachable category demand.
- SAM must narrow TAM to the country/channel/customer segment.
- SOM must be a realistic first 12-month obtainable market.
- Unit economics must include CAC, AOV, LTV, repeat purchase, margin, and payback.
- LTV/CAC must be calculated logically.
- Marketing channels must match the selected country.
- Execution plan must be actionable within 30 days.
- GO threshold must define measurable pass/fail criteria.
- Appendix must include assumed data sources and assumptions.

Scoring logic:
- Market score: demand size + urgency + accessibility.
- Profitability score: margin + LTV/CAC + repeat purchase potential.
- Execution score: founder feasibility + launch cost + operational complexity.
- Risk score: higher number means higher risk pressure.
- Overall cover.score should reflect weighted judgment.

Decision logic:
- GO: score 75+, strong demand, viable unit economics.
- HOLD: score 50-74, needs validation.
- NO GO: below 50, weak economics or market access.

Now generate the JSON report.
`
}

function buildFreeReportFromPaidReport(fullReport) {
    return {
        ...fullReport,
        isPaid: false,
        reportMode: "free",

        lockedSections: {
            afterSection01: true,
            message:
                "This free report shows only the business direction and basic structure. Customer analysis, market sizing, profit structure, risk judgment, and execution strategy are available in the paid report.",
        },
    }
}

async function generateDeepReportJson(input) {
    const { brandName, productService, targetCustomer, language } = input

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

    return normalizeDeepReport(JSON.parse(raw), input)
}



async function generateFreeReportJson(input) {
    const deep = await generateDeepReportJson(input)

    return {
        ...deep,
        cover: {
            ...deep.cover,
            subtitle: `${deep.cover.subtitle} — Free Decision Sample`,
        },
    }
}

function normalizeDeepReport(report, input) {
    return {
        cover: {
            brandName: report?.cover?.brandName || input.brandName || "",
            decision: report?.cover?.decision || "HOLD",
            score: Number.isFinite(report?.cover?.score)
                ? report.cover.score
                : 50,
            subtitle: report?.cover?.subtitle || input.productService || "",
            oneLineVerdict: report?.cover?.oneLineVerdict || "",
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

function buildHtmlFromTemplate(report, locale) {
    const templatePath = path.join(__dirname, "templates", "deep-report.html")
    let html = fs.readFileSync(templatePath, "utf8")

    const matrix = objectFromPairs(report.decisionMatrix)
    const market = objectFromPairs(report.marketCards)
    const unit = objectFromPairs(report.unitEconomicsCards)
    const execMap = objectFromPairs(report.executiveDecision)

   const funnel = normalizeFunnel(report.marketFunnel)

const lockedMessage = t(
    locale,
    "locked.message",
    report?.lockedSections?.message ||
        "Core data and execution strategy are available in the paid report."
)

const lockedTitle = t(locale, "locked.title", "Paid report only")
const lockedButton = t(locale, "locked.button", "Premium Report")
    
const scoreGuideRows = getLocaleTable(locale, "tables.scoreGuideRows", [
    ["85~100", "Excellent", "Strong GO candidate. Scaling may be considered."],
    ["70~84", "Good", "GO is possible if key conditions are met."],
    ["50~69", "Average / Needs validation", "HOLD. Decide after a small test."],
    ["30~49", "Risky", "High NO GO probability. Redesign the structure."],
    ["0~29", "Very risky", "Stop immediately or fully reconsider."],
])

const customerOpportunityRows = Array.isArray(report?.customerOpportunity)
    ? report.customerOpportunity
    : []

const benchmarkRows = Array.isArray(report?.benchmarkRows)
    ? report.benchmarkRows
    : []

const referenceLinks = Array.isArray(report?.referenceLinks)
    ? report.referenceLinks
    : []

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
        decisionClass: getStatusClass(report.cover?.decision),
        subtitle: report.cover.subtitle,
        oneLineVerdict: report.cover.oneLineVerdict,

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

   const templateData = {
    ...locale,
    ...data
}

    html = html
        
        .replace("{{modelDeepDive}}", report?.businessModel?.modelDeepDive || "")
        .replace("{{referenceLinkRows}}", rows(referenceLinks))
        
        .replace("{{glossaryRows}}", glossaryRows(report.glossary))
        .replace("{{scoreGuideRows}}", rows(scoreGuideRows))
        .replace("{{marketFunnelChart}}", marketFunnelChart(report.marketFunnel))
        .replaceAll(
    "{{profitSimulationChart}}",
    profitSimulationChart(report.profitSimulation?.monthlyScenarioTable, locale)
)
       .replace("{{cacLtvRiskChart}}",cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale))
        .replace(
            "{{tamSamSomRows}}",
            report?.lockedSections?.tamSamSom
                ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
                : rows(report.tamSamSom)
        )
        .replace("{{customerTruthRows}}", rows(report.customerTruth))
        .replace("{{customerOpportunityRows}}", rows(customerOpportunityRows))
        .replace("{{competitionRows}}",report?.lockedSections?.competition?
         `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`: rows(report.competitionMap))
        .replace("{{competitionPositionChart}}", competitionPositionChart(report.competitionMap, locale))
.replace(
    "{{competitionConclusion}}",
    report?.lockedSections?.competition
        ? esc(lockedMessage)
        : esc(report.competitionConclusion)
)

.replace("{{benchmarkRows}}", rows(benchmarkRows))

        .replace(
    "{{unitEconomicsRows}}",
    report?.lockedSections?.unitEconomics
        ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
        : rows(report.unitEconomicsTable)
)
        .replace(
            "{{marketingChannelRows}}",
            report?.lockedSections?.marketing
                ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
                : rows(report.marketingStrategy.channelFit)
        )
        .replace(
    "{{contentPlaybookItems}}",
    report?.lockedSections?.marketing
        ? `<li>${esc(lockedMessage)}</li>`
        : listItems(report.marketingStrategy.contentPlaybook)
)
        .replace(
            "{{marketingTestRows}}",
            report?.lockedSections?.marketing
                ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
                : rows(report.marketingStrategy.thirtyDayMarketingTest)
        )

.replace(
    "{{businessModelRows}}",
    rows(report.businessModel.revenueLayers)
)
.replace(
    "{{riskRows}}",
    report?.lockedSections?.risk
        ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
        : rows(report.riskSystem)
)
.replace(
    "{{riskHeatmap}}",
    report?.lockedSections?.risk
        ? ""
        : riskHeatmap(report.riskSystem, locale)
)
.replace(
    "{{executionRows}}",
    report?.lockedSections?.execution
        ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
        : rows(report.executionPlan)
)
.replace(
    "{{executionTimeline}}",
    report?.lockedSections?.execution
        ? ""
        : executionTimeline(report.executionPlan, locale)
)
.replace("{{decisionSummaryBox}}", decisionSummaryBox(report, locale))
.replace(
    "{{goThresholdRows}}",
    report?.lockedSections?.goThreshold
        ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
        : rows(report.goThreshold)
)
.replace("{{goChecklistItems}}", checklistItems(report.goChecklist))
        
.replace("{{sourceQualityRows}}", rows(report.dataConfidence?.sourceQuality))
.replace("{{dataLimitItems}}", listItems(report.dataConfidence?.limits))
.replace("{{referenceLinkRows}}", rows(referenceLinks))
.replace("{{cacLtvRows}}", rows(report.sensitivityAnalysis?.cacLtvTable))
 .replace("{{profitSimulationRows}}", rows(report.profitSimulation?.monthlyScenarioTable))
.replace("{{killCriteriaRows}}", rows(report.killCriteria?.rules))        
.replace("{{dataSourceRows}}", rows(report.appendix.dataSources))
.replace("{{assumptionItems}}", listItems(report.appendix.assumptions))

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

    if (report?.reportMode === "free") {
    html = keepFreeReportOnly(html, locale)
}

html = html.replace(/{{[^}]+}}/g, "")

return html
}

function keepFreeReportOnly(html, locale = {}) {
    const splitPoint = "<!-- FREE_REPORT_END -->"
    const index = html.indexOf(splitPoint)

    if (index === -1) {
        console.log("[FREE_SPLIT_POINT_NOT_FOUND]")
        return html
    }

    const freePart = html.slice(0, index)

    const premiumKicker = t(locale, "premium.kicker", "PREMIUM REPORT")
    const premiumTitle = t(
        locale,
        "premium.title",
        "Full analysis is available in the paid report"
    )
    const premiumDesc = t(
        locale,
        "premium.desc",
        "Customer analysis, market sizing, competitive structure, profit simulation, marketing strategy, risk judgment, and execution plan are unlocked in the full report."
    )
    const premiumFooter = t(locale, "premium.footer", "Premium Locked")
    const footerLeft = t(locale, "footer.left", "GoNoGo™")

    return `
${freePart}

<section class="page section-cover">
  <div class="section-kicker">${esc(premiumKicker)}</div>

  <div class="section-cover-title">
    ${esc(premiumTitle)}
  </div>

  <div class="section-cover-desc">
    ${esc(premiumDesc)}
  </div>

  <div style="
    margin-top:28px;
    border:2px solid #123f2b;
    background:#f6faf7;
    padding:22px;
    border-radius:12px;
  ">
    <div style="font-size:18px;font-weight:900;margin-bottom:10px;">
      ${esc(t(locale, "premium.ctaTitle", "This analysis is incomplete."))}
    </div>

    <div style="font-size:13px;line-height:1.7;margin-bottom:18px;">
      ${esc(t(locale, "premium.ctaDesc", "Unlock the full report to see the real risk, profit structure, and execution strategy."))}
    </div>

    <div style="
      display:inline-block;
      background:#123f2b;
      color:#fff;
      font-weight:900;
      font-size:14px;
      padding:13px 18px;
      border-radius:8px;
    ">
      ${esc(t(locale, "premium.ctaButton", "Unlock Full Report"))}
    </div>
  </div>

  <div class="footer">
    <span>${esc(footerLeft)}</span>
    <span>${esc(premiumFooter)}</span>
  </div>
</section>
`
}
function lockedBox(message, title = "Premium Insights", buttonLabel = "Premium Report") {
    return `
    <div style="
        border:1px solid #e0e0e0;
        border-radius:10px;
        padding:18px;
        background:#fafafa;
        text-align:center;
    ">
        <div style="
            font-size:13px;
            font-weight:bold;
            margin-bottom:6px;
        ">
            ${esc(title)}
        </div>

        <div style="
            font-size:11px;
            color:#555;
            margin-bottom:10px;
        ">
            ${esc(message)}
        </div>

        <div style="
            display:inline-block;
            padding:10px 14px;
            background:#2f7d57;
            color:#fff;
            border-radius:6px;
            font-size:12px;
            font-weight:bold;
        ">
            ${esc(buttonLabel)}
        </div>
    </div>
    `
}

async function htmlToPdf(html) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    })

    try {
        const page = await browser.newPage()

        await page.setContent(html, {
    waitUntil: ["domcontentloaded", "networkidle0"],
    timeout: 0,
})

await page.evaluateHandle("document.fonts.ready")

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
        })

        return Buffer.from(pdf)
    } finally {
        await browser.close()
    }
}

function loadLocale(lang) {
    const filePath = path.join(__dirname, "locales", `${lang}.json`)
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function getByPath(obj, pathKey) {
    return pathKey.split(".").reduce((acc, key) => {
        if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
            return acc[key]
        }
        return undefined
    }, obj)
}

function applyTemplateVars(html, data = {}) {
    return html.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
        const value = getByPath(data, key)

        if (value === undefined || value === null) {
    console.error(`[TEMPLATE_MISSING_KEY] ${key}`)
    return `[MISSING:${key}]`
}

        // HTML 블록은 그대로 삽입
        if (typeof value === "string" && value.trim().startsWith("<")) {
            return value
        }

        // 일반 텍스트는 안전하게 escape
        return esc(value)
    })
}

function normalizeLanguage(lang) {
    const supported = ["ko", "en", "ja", "zh", "mn"]
    return supported.includes(lang) ? lang : "en"
}

function flattenLabels(labels) {
    return {
        label: labels || {},
        labels: labels || {},
    }
}


function flattenNotes(notes) {
    return {
        note: notes || {},
        fixedNotes: notes || {},
    }
}

// ✅ 여기부터 추가
function t(locale, key, fallback = "") {
    const value = getByPath(locale, key)

    if (value === undefined || value === null || value === "") {
        return fallback
    }

    return value
}

function getLocaleTable(locale, key, fallback = []) {
    const value = getByPath(locale, key)
    return Array.isArray(value) ? value : fallback
}

function getLocaleList(locale, key, fallback = []) {
    const value = getByPath(locale, key)
    return Array.isArray(value) ? value : fallback
}
// ✅ 여기까지 추가

function rows(items) {
    if (!Array.isArray(items)) return ""
    return items
        .map((row) => {
            const cells = Array.isArray(row) ? row : Object.values(row)
            return `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`
        })
        .join("")
}


function getStatusClass(value) {
    const v = String(value || "").toLowerCase()

    if (v.includes("no go") || v.includes("fail") || v.includes("danger") || v.includes("위험")) {
        return "status-red"
    }

    if (v.includes("hold") || v.includes("watch") || v.includes("주의") || v.includes("보류")) {
        return "status-yellow"
    }

    if (v.includes("go") || v.includes("pass") || v.includes("가능")) {
        return "status-green"
    }

    return ""
}

function getScoreClass(score) {
    const n = Number(score)
    if (!Number.isFinite(n)) return "status-yellow"
    if (n >= 70) return "status-green"
    if (n >= 50) return "status-yellow"
    return "status-red"
}

function getRiskScoreClass(score) {
    const n = Number(score)
    if (!Number.isFinite(n)) return "status-yellow"

    // 리스크는 점수가 높을수록 위험하니까 반대로 처리
    if (n >= 70) return "status-red"
    if (n >= 50) return "status-yellow"
    return "status-green"
}

function marketFunnelChart(items = [], locale = {}) {
    if (!Array.isArray(items) || items.length === 0) return ""

    const normalized = items.map((item) => {
        const label = item?.label || ""
        const value = item?.value || ""
        const score = Math.max(8, Math.min(100, Number(item?.score || 0)))

        return { label, value, score }
    })

    return `
        <div class="market-funnel-box">
            ${normalized
                .map((item, index) => {
                    const levelClass =
                        index === 0 ? "funnel-tam" :
                        index === 1 ? "funnel-sam" :
                        "funnel-som"

                    return `
                        <div class="market-funnel-row ${levelClass}">
                            <div class="market-funnel-label">${esc(item.label)}</div>

                            <div class="market-funnel-track">
                                <div class="market-funnel-fill" style="width:${item.score}%"></div>
                            </div>

                            <div class="market-funnel-value">${esc(item.value)}</div>
                        </div>
                    `
                })
                .join("")}
        </div>
    `
}

function profitSimulationChart(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    const chart = locale?.chart || {}

    const revenueLabel =
        chart.revenue || locale?.th_monthly_revenue || "Revenue"

    const marketingCostLabel =
        chart.marketingCost || locale?.th_marketing_cost || "Marketing Cost"

    const profitLabel =
        chart.profit || locale?.th_expected_profit || "Profit"

    return `
        <div class="chart-box">
            ${rowsData.map((row) => {
                const scenario = row?.[0] || ""
                const revenue = parseMoney(row?.[2])
                const marketing = parseMoney(row?.[3])
                const profit = parseMoney(row?.[4])

                const max = Math.max(revenue, marketing, Math.abs(profit), 1)
                const revenueW = Math.max(5, Math.min(100, (revenue / max) * 100))
                const marketingW = Math.max(5, Math.min(100, (marketing / max) * 100))
                const profitW = Math.max(5, Math.min(100, (Math.abs(profit) / max) * 100))

                return `
                    <div class="scenario-chart">
                        <div class="scenario-title">${esc(scenario)}</div>

                        <div class="mini-bar-row">
                            <span>${esc(revenueLabel)}</span>
                            <div class="chart-track"><div class="chart-fill" style="width:${revenueW}%"></div></div>
                            <b>${esc(row?.[2] || "")}</b>
                        </div>

                        <div class="mini-bar-row">
                            <span>${esc(marketingCostLabel)}</span>
                            <div class="chart-track"><div class="chart-fill light" style="width:${marketingW}%"></div></div>
                            <b>${esc(row?.[3] || "")}</b>
                        </div>

                        <div class="mini-bar-row">
                            <span>${esc(profitLabel)}</span>
                            <div class="chart-track"><div class="chart-fill ${profit < 0 ? "danger" : ""}" style="width:${profitW}%"></div></div>
                            <b>${esc(row?.[4] || "")}</b>
                        </div>
                    </div>
                `
            }).join("")}
        </div>
    `
}

function cacLtvRiskChart(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    const chart = locale?.chart || {}
    const ratioLabel = chart.ltvCac || "LTV/CAC"

    return `
        <div class="chart-box">
            ${rowsData.map((row) => {
                const scenario = row?.[0] || ""
                const cac = parseMoney(row?.[1])
                const ltv = parseMoney(row?.[2])
                const ratio = cac > 0 ? ltv / cac : 0
                const width = Math.max(5, Math.min(100, ratio * 25))
                const cls = ratio >= 3 ? "" : ratio >= 2 ? "light" : "danger"

                return `
                    <div class="chart-row">
                        <div class="chart-label">${esc(scenario)}</div>
                        <div class="chart-track">
                            <div class="chart-fill ${cls}" style="width:${width}%"></div>
                        </div>
                        <div class="chart-value">${esc(ratioLabel)} ${ratio.toFixed(1)}x</div>
                    </div>
                `
            }).join("")}
        </div>
    `
}

// ✅ 여기 추가
function buildDecisionChart(report, locale = {}) {
    const market = toScore(report?.visualScores?.market, 60)
    const profitability = toScore(report?.visualScores?.profitability, 50)
    const execution = toScore(report?.visualScores?.execution, 55)
    const risk = toScore(report?.visualScores?.risk, 40)

    const avg = Math.round((market + profitability + execution + (100 - risk)) / 4)

    const chart = locale?.chart || {}
    const label = locale?.label || locale?.labels || {}

    const message =
        avg >= 70
            ? chart.decisionStrong || "Decision signal is strong enough to continue validation."
            : avg >= 50
                ? chart.decisionMixed || "Decision signal is mixed. Validate before scaling."
                : chart.decisionWeak || "Decision signal is weak. Redesign before spending more."

    return `
        <div class="decision-chart-box">
            <div class="decision-chart-head">
                <div>
                    <div class="decision-chart-kicker">${esc(chart.decisionSignal || "Decision Signal")}</div>
                    <div class="decision-chart-title">${esc(message)}</div>
                </div>
                <div class="decision-chart-score">${avg}/100</div>
            </div>

            ${decisionBar({
                label: chart.market || label.market || "Market",
                value: market,
                danger: false,
                locale,
            })}

            ${decisionBar({
                label: chart.profitability || label.profitability || "Profitability",
                value: profitability,
                danger: false,
                locale,
            })}

            ${decisionBar({
                label: chart.execution || label.execution || "Execution",
                value: execution,
                danger: false,
                locale,
            })}

            ${decisionBar({
                label: chart.riskPressure || label.riskPressure || "Risk Pressure",
                value: risk,
                danger: true,
                locale,
            })}
        </div>
    `
}

function decisionBar({ label = "", value = 0, danger = false, locale = {} }) {
    const safeValue = Math.max(0, Math.min(100, Number(value) || 0))
    const chart = locale?.chart || {}

    const status = danger
        ? safeValue >= 70
            ? chart.high || "HIGH"
            : safeValue >= 50
                ? chart.watch || "WATCH"
                : chart.low || "LOW"
        : safeValue >= 70
            ? chart.good || "GOOD"
            : safeValue >= 50
                ? chart.watch || "WATCH"
                : chart.weak || "WEAK"

    const cls = danger
        ? safeValue >= 70
            ? "danger"
            : safeValue >= 50
                ? "light"
                : ""
        : safeValue >= 70
            ? ""
            : safeValue >= 50
                ? "light"
                : "danger"

    return `
        <div class="decision-bar-row">
            <div class="decision-bar-label">${esc(label)}</div>
            <div class="decision-bar-track">
                <div class="decision-bar-fill ${cls}" style="width:${safeValue}%"></div>
            </div>
            <div class="decision-bar-value">${safeValue} · ${esc(status)}</div>
        </div>
    `
}

function parseMoney(v) {
    const raw = String(v || "")
    const cleaned = raw.replace(/[^\d.-]/g, "")
    const n = Number(cleaned)
    return Number.isFinite(n) ? Math.abs(n) : 0
}

function glossaryRows(items) {
    if (!Array.isArray(items) || items.length === 0) return ""

    return items
        .map((item) => `
            <tr>
                <td>${esc(item?.term || "")}</td>
                <td>${esc(item?.meaning || "")}</td>
                <td>${esc(item?.whyItMatters || "")}</td>
            </tr>
        `)
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""
    return items.map((i) => `<li>${esc(i)}</li>`).join("")
}

function extractTemplateKeys(html) {
    const matches = html.match(/{{\s*[^}]+\s*}}/g) || []

    return [...new Set(
        matches.map((m) =>
            m.replace(/[{}]/g, "").trim()
        )
    )]
}

function validateTemplateKeys(html, templateData, blockKeys = []) {
    const htmlKeys = extractTemplateKeys(html)

    const missingKeys = htmlKeys.filter((key) => {
        if (blockKeys.includes(key)) return false
        return !(key in templateData)
    })

    const extraKeys = Object.keys(templateData).filter(
        (key) => !htmlKeys.includes(key)
    )

    if (missingKeys.length > 0) {
        console.log("[MISSING_TEMPLATE_KEYS]", missingKeys)
    }

    if (extraKeys.length > 0) {
        console.log("[EXTRA_TEMPLATE_KEYS]", extraKeys)
    }

    return {
        missingKeys,
        extraKeys,
    }
}

/* 🔥 완전히 밖으로 분리 */
function competitionPositionChart(map = [], locale = {}) {
    if (!Array.isArray(map)) return ""

    const chart = locale?.chart || {}

    const lowPrice = chart.lowPrice || "Low Price"
    const highPrice = chart.highPrice || "High Price"
    const highValue = chart.highValue || "High Value"
    const lowValue = chart.lowValue || "Low Value"

    return `
    <div class="chart-box">
        <div style="position: relative; height: 240px; background: #f6faf7; border:1px solid #d8e7dc;">
            
            ${map.map((row, i) => {
                const name = esc(row?.[0] || "")
                const x = (i % 2) * 60 + 20
                const y = Math.floor(i / 2) * 60 + 20

                return `
                    <div style="
                        position:absolute;
                        left:${x}%;
                        top:${y}%;
                        transform:translate(-50%, -50%);
                        background:#2f7d57;
                        color:#fff;
                        padding:6px 10px;
                        font-size:10px;
                        border-radius:6px;
                        white-space:nowrap;
                    ">
                        ${name}
                    </div>
                `
            }).join("")}

            <div style="position:absolute; left:10px; bottom:10px; font-size:10px;">${esc(lowPrice)}</div>
            <div style="position:absolute; right:10px; bottom:10px; font-size:10px;">${esc(highPrice)}</div>

            <div style="position:absolute; left:10px; top:10px; font-size:10px;">${esc(highValue)}</div>
            <div style="position:absolute; left:10px; bottom:30px; font-size:10px;">${esc(lowValue)}</div>

        </div>
    </div>
    `
}

function riskHeatmap(rows = [], locale = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return ""

    const chart = locale?.chart || {}

    const levelConfig = [
        {
            level: "HIGH",
            label: chart.high || "HIGH",
            color: "#b94a48",
        },
        {
            level: "MEDIUM",
            label: chart.watch || "WATCH",
            color: "#d8b85a",
        },
        {
            level: "LOW",
            label: chart.low || "LOW",
            color: "#2f7d57",
        },
    ]

    return `
        <div class="chart-box">
            <div style="display:grid; grid-template-columns:1fr; gap:10px;">
                ${rows
                    .slice(0, 3)
                    .map((row, index) => {
                        const title = esc(row?.[0] || "")
                        const impact = esc(row?.[1] || "")
                        const action = esc(row?.[2] || "")

                        const config = levelConfig[index] || levelConfig[1]

                        return `
                            <div style="
                                border:1px solid #d8e7dc;
                                background:#fbfdfb;
                                padding:12px;
                                border-left:6px solid ${config.color};
                                font-size:11px;
                                line-height:1.45;
                            ">
                                <div style="
                                    display:flex;
                                    justify-content:space-between;
                                    gap:10px;
                                    align-items:flex-start;
                                    margin-bottom:6px;
                                ">
                                    <b style="font-size:12px;">${title}</b>
                                    <span style="
                                        color:${config.color};
                                        font-weight:900;
                                        white-space:nowrap;
                                    ">
                                        ${esc(config.label)}
                                    </span>
                                </div>

                                <div style="margin-bottom:5px;">
                                    ${impact}
                                </div>

                                <div style="
                                    color:#4b5d53;
                                    font-size:10.5px;
                                ">
                                    ${action}
                                </div>
                            </div>
                        `
                    })
                    .join("")}
            </div>
        </div>
    `
}

function executionTimeline(rows = [], locale = {}) {
    if (!Array.isArray(rows) || rows.length === 0) return ""

    const chart = locale?.chart || {}
    const actionLabel = chart.action || locale?.th_execution_content || "Action"
    const goalLabel = chart.goal || locale?.th_core_kpi || "Goal"

    return `
        <div class="chart-box">
            ${rows
                .slice(0, 3)
                .map((row, index) => {
                    const phase = esc(row?.[0] || "")
                    const action = esc(row?.[1] || "")
                    const goal = esc(row?.[2] || "")

                    return `
                        <div class="scenario-chart">
                            <div class="scenario-title">${index + 1}. ${phase}</div>
                            <div class="mini-note" style="margin-top:8px;">
                                <b>${esc(actionLabel)}:</b> ${action}<br/>
                                <b>${esc(goalLabel)}:</b> ${goal}
                            </div>
                        </div>
                    `
                })
                .join("")}
        </div>
    `
}

function decisionSummaryBox(report, locale = {}) {
    const decision = report?.cover?.decision || "HOLD"
    const score = Number(report?.cover?.score || 50)
    const chart = locale?.chart || {}

    const confidence =
        score >= 75
            ? chart.highConfidence || "HIGH CONFIDENCE"
            : score >= 55
                ? chart.mediumConfidence || "MEDIUM CONFIDENCE"
                : chart.lowConfidence || "LOW CONFIDENCE"

    const color =
        decision === "GO"
            ? "#2ecc71"
            : decision === "HOLD"
                ? "#f39c12"
                : "#e74c3c"

    const action =
        decision === "GO"
            ? chart.goAction || "Start execution immediately with controlled budget."
            : decision === "HOLD"
                ? chart.holdAction || "Run validation tests before scaling."
                : chart.noGoAction || "Stop or redesign the business model."

    return `
    <div class="chart-box">
        <div style="
            border:2px solid ${color};
            border-radius:10px;
            padding:16px;
        ">
            <div style="
                font-size:14px;
                font-weight:bold;
                color:${color};
                margin-bottom:6px;
            ">
                ${esc(decision)}
            </div>

            <div style="font-size:12px; margin-bottom:6px;">
                ${esc(locale?.scoreLabel || "Score")}: <b>${score}</b> / 100
            </div>

            <div style="font-size:11px; margin-bottom:10px;">
                ${esc(confidence)}
            </div>

            <div style="
                font-size:11px;
                background:#f6f6f6;
                padding:10px;
                border-radius:6px;
            ">
                ${esc(action)}
            </div>
        </div>
    </div>
    `
}

function checklistItems(items) {
    if (!Array.isArray(items)) return ""
    return items
        .map((i) => {
            const s = i.status || "WATCH"
            const cls =
                s === "PASS" ? "status-pass" : s === "FAIL" ? "status-fail" : "status-watch"
            return `<div class="check-item"><span>${esc(i.label)}</span><span class="${cls}">${s}</span></div>`
        })
        .join("")
}

function objectFromPairs(items) {
    const out = {}
    if (!Array.isArray(items)) return out
    items.forEach((i) => {
        if (Array.isArray(i)) out[i[0]] = i[1]
    })
    return out
}

function normalizeFunnel(items) {
    const base = {
        tam: { value: "", score: 100 },
        sam: { value: "", score: 60 },
        som: { value: "", score: 20 },
    }

    if (!Array.isArray(items)) return base

    items.forEach((i) => {
        const key = (i.label || "").toLowerCase()
        if (key === "tam") base.tam = i
        if (key === "sam") base.sam = i
        if (key === "som") base.som = i
    })

    return base
}

function esc(v) {
    return String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
}

function safeArray(v, fallback) {
    return Array.isArray(v) ? v : fallback
}

function toScore(v, fallback = 50) {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.max(0, Math.min(100, Math.round(n)))
}

function getLanguageName(code) {
    return {
        ko: "Korean",
        en: "English",
        ja: "Japanese",
        zh: "Chinese",
        mn: "Mongolian",
    }[code] || "English"
}

function sanitizeFileName(v) {
    return String(v || "report").replace(/[^\w]/g, "_")
}

function getDefaultGlossary(lang = "ko") {
    const glossaries = {
        ko: [
            { term: "TAM", meaning: "전체 시장 규모", whyItMatters: "사업이 이론적으로 얼마나 큰 시장을 노릴 수 있는지 보여줍니다." },
            { term: "SAM", meaning: "실제로 접근 가능한 시장", whyItMatters: "현재 국가, 채널, 고객 기준으로 현실적으로 노릴 수 있는 시장입니다." },
            { term: "SOM", meaning: "초기 확보 가능 시장", whyItMatters: "첫 6~12개월 안에 실제로 얻을 수 있는 매출 가능성을 보여줍니다." },
            { term: "CAC", meaning: "고객 1명을 얻는 비용", whyItMatters: "CAC가 LTV보다 높으면 팔수록 손해가 납니다." },
            { term: "LTV", meaning: "고객 1명이 남기는 총 가치", whyItMatters: "LTV가 CAC보다 충분히 높아야 광고와 성장이 가능합니다." },
            { term: "AOV", meaning: "1회 평균 주문 금액", whyItMatters: "객단가가 낮으면 배송비, 광고비를 감당하기 어렵습니다." },
            { term: "Retention", meaning: "고객 유지율", whyItMatters: "반복구매가 없으면 구독형이나 재구매형 사업은 오래가기 어렵습니다." },
        ],
        en: [
            { term: "TAM", meaning: "Total addressable market", whyItMatters: "Shows the maximum theoretical market size." },
            { term: "SAM", meaning: "Serviceable available market", whyItMatters: "Shows the realistic market reachable by country, channel, and customer type." },
            { term: "SOM", meaning: "Serviceable obtainable market", whyItMatters: "Shows the realistic revenue that can be captured in the first 6–12 months." },
            { term: "CAC", meaning: "Customer acquisition cost", whyItMatters: "If CAC is higher than LTV, growth destroys profit." },
            { term: "LTV", meaning: "Customer lifetime value", whyItMatters: "LTV must be meaningfully higher than CAC for paid growth to work." },
            { term: "AOV", meaning: "Average order value", whyItMatters: "Low AOV makes ads, shipping, and fulfillment harder to sustain." },
            { term: "Retention", meaning: "Customer retention", whyItMatters: "Without repeat behavior, subscription or repeat-purchase models weaken quickly." },
        ],
        ja: [
            { term: "TAM", meaning: "総市場規模", whyItMatters: "理論上到達可能な市場規模を示します。" },
            { term: "SAM", meaning: "実際に狙える市場", whyItMatters: "現実的にアプローチ可能な市場です。" },
            { term: "SOM", meaning: "初期獲得可能市場", whyItMatters: "最初の6〜12ヶ月で獲得可能な市場です。" },
            { term: "CAC", meaning: "顧客獲得コスト", whyItMatters: "CACがLTVを上回ると成長は赤字になります。" },
            { term: "LTV", meaning: "顧客生涯価値", whyItMatters: "LTVはCACより十分高くある必要があります。" }
        ],

        zh: [
            { term: "TAM", meaning: "总市场规模", whyItMatters: "展示理论上可覆盖的最大市场。" },
            { term: "SAM", meaning: "可服务市场", whyItMatters: "当前可实际进入的市场。" },
            { term: "SOM", meaning: "可获取市场", whyItMatters: "前6-12个月可获得的市场。" },
            { term: "CAC", meaning: "获客成本", whyItMatters: "CAC高于LTV将导致亏损增长。" },
            { term: "LTV", meaning: "客户终身价值", whyItMatters: "必须高于CAC才能盈利增长。" }
        ],

        mn: [
            { term: "TAM", meaning: "Нийт зах зээл", whyItMatters: "Онолын хамгийн том зах зээлийг харуулна." },
            { term: "SAM", meaning: "Боломжит зах зээл", whyItMatters: "Одоогийн нөхцөлд хүрэх боломжтой зах зээл." },
            { term: "SOM", meaning: "Эхний зах зээл", whyItMatters: "6-12 сард авах боломжтой зах зээл." },
            { term: "CAC", meaning: "Хэрэглэгч авах зардал", whyItMatters: "CAC нь LTV-ээс өндөр байвал алдагдал үүснэ." },
            { term: "LTV", meaning: "Хэрэглэгчийн үнэ цэнэ", whyItMatters: "LTV нь CAC-ээс өндөр байх ёстой." }
        ]
    }

    return glossaries[lang] || glossaries.en
}
   
app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`)
})

