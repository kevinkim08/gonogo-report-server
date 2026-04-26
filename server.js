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

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin) return callback(null, true)

            const allowed =
                origin.includes("framer.app") ||
                origin.includes("framer.website") ||
                origin.includes("onrender.com") ||
                origin.includes("localhost") ||
                origin.includes("127.0.0.1") ||
                origin === "https://big-evidence-039433.framer.app"

            if (allowed) return callback(null, true)
            return callback(new Error("Not allowed by CORS"))
        },
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
    })
)

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

app.get("/api/test-pdf", async (req, res) => {
    try {
        const language = normalizeLanguage(req.query.language || "ko")
        const locale = loadLocale(language)

        const sampleReport = normalizeDeepReport(getSampleReport(language), {
            brandName: "NomNomBox",
            productService: "Premium pet-food sample subscription",
            targetCustomer: "Online dog owners",
            language,
        })

        const html = buildHtmlFromTemplate(sampleReport, locale)
        const pdfBuffer = await htmlToPdf(html)

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Length", pdfBuffer.length)
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="GoNoGo_Test_Report_${language}.pdf"`
        )

        return res.end(pdfBuffer)
    } catch (error) {
        console.error("[TEST_PDF_ERROR]", error)
        return res.status(500).json({
            ok: false,
            error: "Failed to generate test PDF.",
            detail: String(error?.message || error),
        })
    }
})

app.post("/api/generate-report", async (req, res) => {
    try {
        const {
            brandName,
            productService,
            targetCustomer,
            language = "ko",
            reportType = "deep",
        } = req.body || {}

        if (!brandName || !productService || !targetCustomer) {
            return res.status(400).json({
                ok: false,
                error: "brandName, productService, targetCustomer are required.",
            })
        }

        const safeLanguage = normalizeLanguage(language)
        const locale = loadLocale(safeLanguage)

        const report =
            reportType === "free"
                ? await generateFreeReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language: safeLanguage,
                  })
                : await generateDeepReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language: safeLanguage,
                  })

        const html = buildHtmlFromTemplate(report, locale)
        const pdfBuffer = await htmlToPdf(html)

        const safeBrand = sanitizeFileName(brandName)
        const fileName =
            reportType === "free"
                ? `GoNoGo_Free_Report_${safeBrand}_${safeLanguage}.pdf`
                : `GoNoGo_Deep_Report_${safeBrand}_${safeLanguage}.pdf`

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

async function generateDeepReportJson(input) {
    const { brandName, productService, targetCustomer, language } = input
    const languageName = getLanguageName(language)

    const systemPrompt = `
You are GoNoGo, a ruthless business decision system.

You are NOT a writer.
You are a decision engine used by founders to decide whether to start, pause, or reject a business.

Absolute rules:
- Output VALID JSON only.
- No markdown.
- No vague language.
- Every statement must be judgment-based.
- Use conservative estimates when uncertain.
- The report must be actionable in the real world.
- This is a PAID REPORT.
- Final language: ${languageName}
`

    const userPrompt = `
Create a GoNoGo DEEP PAID REPORT.

Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

Return this exact JSON shape:

{
  "cover": {
    "brandName": string,
    "decision": "GO" | "HOLD" | "NO GO",
    "score": number,
    "subtitle": string,
    "oneLineVerdict": string
  },
  "visualScores": {
    "market": number,
    "profitability": number,
    "execution": number,
    "risk": number
  },
  "decisionMatrix": [
    ["MARKET", "LOW" | "MEDIUM" | "HIGH"],
    ["PROFITABILITY", "LOW" | "MEDIUM" | "HIGH"],
    ["EXECUTION", "LOW" | "MEDIUM" | "HIGH"],
    ["RISK", "LOW" | "MEDIUM" | "HIGH"]
  ],
  "executiveDecision": [
    ["Why this works", string],
    ["Why this fails", string],
    ["What to do now", string]
  ],
  "founderDecision": string,
  "marketCards": [
    ["TAM", string],
    ["SAM", string],
    ["SOM", string],
    ["GROWTH", string]
  ],
  "marketFunnel": [
    { "label": "TAM", "value": string, "score": number },
    { "label": "SAM", "value": string, "score": number },
    { "label": "SOM", "value": string, "score": number }
  ],
  "tamSamSom": [
    ["TAM", string, string, string],
    ["SAM", string, string, string],
    ["SOM", string, string, string]
  ],
  "marketInsight": string,
  "customerTruth": [
    [string, string, string],
    [string, string, string],
    [string, string, string]
  ],
  "buyingTrigger": string,
  "competitionMap": [
    [string, string, string, string],
    [string, string, string, string],
    [string, string, string, string],
    [string, string, string, string]
  ],
  "competitionConclusion": string,
  "unitEconomicsCards": [
    ["CAC", string],
    ["LTV", string],
    ["AOV", string],
    ["REPEAT", string]
  ],
  "unitEconomicsScore": {
    "ltvToCac": string,
    "payback": string,
    "margin": string,
    "status": "PASS" | "WATCH" | "FAIL"
  },
  "unitEconomicsTable": [
    [string, string, string, string],
    [string, string, string, string],
    [string, string, string, string],
    [string, string, string, string]
  ],
  "economicsJudgment": string,
  "marketingStrategy": {
    "channelFit": [
      [string, "LOW" | "MEDIUM" | "HIGH" | "WATCH", string, string],
      [string, "LOW" | "MEDIUM" | "HIGH" | "WATCH", string, string],
      [string, "LOW" | "MEDIUM" | "HIGH" | "WATCH", string, string],
      [string, "LOW" | "MEDIUM" | "HIGH" | "WATCH", string, string]
    ],
    "contentPlaybook": [string, string, string, string, string],
    "thirtyDayMarketingTest": [
      [string, string, string],
      [string, string, string],
      [string, string, string]
    ]
  },
  "businessModel": {
    "revenueLayers": [
      [string, string, string],
      [string, string, string],
      [string, string, string]
    ],
    "modelJudgment": string
  },
  "riskSystem": [
    [string, string, string],
    [string, string, string],
    [string, string, string]
  ],
  "executionPlan": [
    [string, string, string],
    [string, string, string],
    [string, string, string]
  ],
  "operatingRule": string,
  "goThreshold": [
    [string, string, string],
    [string, string, string],
    [string, string, string],
    [string, string, string]
  ],
  "goChecklist": [
    { "label": string, "status": "PASS" | "WATCH" | "FAIL" },
    { "label": string, "status": "PASS" | "WATCH" | "FAIL" },
    { "label": string, "status": "PASS" | "WATCH" | "FAIL" },
    { "label": string, "status": "PASS" | "WATCH" | "FAIL" }
  ],
  "finalRule": string,
  "appendix": {
    "dataSources": [
      [string, string, string],
      [string, string, string],
      [string, string, string]
    ],
    "assumptions": [string, string, string, string]
  }
}

Quality rules:
- Include objective market size, success probability, unit economics, marketing strategy, and execution plan.
- visualScores must be numbers from 0 to 100.
- marketFunnel scores must be numbers from 0 to 100.
- Numbers must include logic or assumptions.
- Keep table cell text concise.
`

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
    const sample = getSampleReport(input.language || "ko")

    return {
        cover: {
            brandName: report?.cover?.brandName || input.brandName,
            decision: report?.cover?.decision || "HOLD",
            score: Number.isFinite(report?.cover?.score)
                ? report.cover.score
                : 50,
            subtitle: report?.cover?.subtitle || input.productService,
            oneLineVerdict:
                report?.cover?.oneLineVerdict ||
                "This business requires validation before scaling.",
        },
        visualScores: {
            market: toScore(report?.visualScores?.market, sample.visualScores.market),
            profitability: toScore(
                report?.visualScores?.profitability,
                sample.visualScores.profitability
            ),
            execution: toScore(
                report?.visualScores?.execution,
                sample.visualScores.execution
            ),
            risk: toScore(report?.visualScores?.risk, sample.visualScores.risk),
        },
        decisionMatrix: safeArray(report?.decisionMatrix, sample.decisionMatrix),
        executiveDecision: safeArray(
            report?.executiveDecision,
            sample.executiveDecision
        ),
        founderDecision: report?.founderDecision || sample.founderDecision,
        marketCards: safeArray(report?.marketCards, sample.marketCards),
        marketFunnel: safeArray(report?.marketFunnel, sample.marketFunnel),
        tamSamSom: safeArray(report?.tamSamSom, sample.tamSamSom),
        marketInsight: report?.marketInsight || sample.marketInsight,
        customerTruth: safeArray(report?.customerTruth, sample.customerTruth),
        buyingTrigger: report?.buyingTrigger || sample.buyingTrigger,
        competitionMap: safeArray(
            report?.competitionMap,
            sample.competitionMap
        ),
        competitionConclusion:
            report?.competitionConclusion || sample.competitionConclusion,
        unitEconomicsCards: safeArray(
            report?.unitEconomicsCards,
            sample.unitEconomicsCards
        ),
        unitEconomicsScore: {
            ltvToCac:
                report?.unitEconomicsScore?.ltvToCac ||
                sample.unitEconomicsScore.ltvToCac,
            payback:
                report?.unitEconomicsScore?.payback ||
                sample.unitEconomicsScore.payback,
            margin:
                report?.unitEconomicsScore?.margin ||
                sample.unitEconomicsScore.margin,
            status:
                report?.unitEconomicsScore?.status ||
                sample.unitEconomicsScore.status,
        },
        unitEconomicsTable: safeArray(
            report?.unitEconomicsTable,
            sample.unitEconomicsTable
        ),
        economicsJudgment:
            report?.economicsJudgment || sample.economicsJudgment,
        marketingStrategy: {
            channelFit: safeArray(
                report?.marketingStrategy?.channelFit,
                sample.marketingStrategy.channelFit
            ),
            contentPlaybook: safeArray(
                report?.marketingStrategy?.contentPlaybook,
                sample.marketingStrategy.contentPlaybook
            ),
            thirtyDayMarketingTest: safeArray(
                report?.marketingStrategy?.thirtyDayMarketingTest,
                sample.marketingStrategy.thirtyDayMarketingTest
            ),
        },
        businessModel: {
            revenueLayers: safeArray(
                report?.businessModel?.revenueLayers,
                sample.businessModel.revenueLayers
            ),
            modelJudgment:
                report?.businessModel?.modelJudgment ||
                sample.businessModel.modelJudgment,
        },
        riskSystem: safeArray(report?.riskSystem, sample.riskSystem),
        executionPlan: safeArray(report?.executionPlan, sample.executionPlan),
        operatingRule: report?.operatingRule || sample.operatingRule,
        goThreshold: safeArray(report?.goThreshold, sample.goThreshold),
        goChecklist: safeArray(report?.goChecklist, sample.goChecklist),
        finalRule: report?.finalRule || sample.finalRule,
        appendix: {
            dataSources: safeArray(
                report?.appendix?.dataSources,
                sample.appendix.dataSources
            ),
            assumptions: safeArray(
                report?.appendix?.assumptions,
                sample.appendix.assumptions
            ),
        },
    }
}

function buildHtmlFromTemplate(report, locale) {
    const templatePath = path.join(__dirname, "templates", "deep-report.html")
    let html = fs.readFileSync(templatePath, "utf8")

    const matrix = objectFromPairs(report.decisionMatrix)
    const market = objectFromPairs(report.marketCards)
    const unit = objectFromPairs(report.unitEconomicsCards)
    const executiveMap = objectFromPairs(report.executiveDecision)
    const funnel = normalizeFunnel(report.marketFunnel)

    const data = {
        lang: locale.lang || "en",
        fontFamily: locale.fontFamily || "Arial, sans-serif",

        reportTitleSuffix: locale.reportTitleSuffix || "Deep Business Decision Report",
        scoreLabel: locale.scoreLabel || "Score",
        footerLeft: locale.footer?.left || "GoNoGo™ Business Decision Report",

        brandName: report.cover.brandName,
        decision: report.cover.decision,
        score: report.cover.score,
        subtitle: report.cover.subtitle,
        oneLineVerdict: report.cover.oneLineVerdict,

        marketLevel: matrix.MARKET || "",
        profitabilityLevel: matrix.PROFITABILITY || "",
        executionLevel: matrix.EXECUTION || "",
        riskLevel: matrix.RISK || "",

        marketScore: report.visualScores.market,
        profitabilityScore:
