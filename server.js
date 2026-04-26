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
            language: normalizedLanguage,
        })

        const finalReport =
            normalizedReportType === "paid"
                ? paidReport
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
  return `
You are a business decision engine, market analyst, investor, and execution strategist.

Your job is NOT to write a nice report.
Your job is to judge whether this business should be started, improved, or stopped.

You must produce a premium paid business decision report.

INPUT:
Brand Name: ${brandName}
Product/Service: ${productService}
Target Customer: ${targetCustomer}
Language: ${language}

CRITICAL RULES:
1. Output valid JSON only.
2. Do not include markdown.
3. Do not include text outside JSON.
4. Be realistic, not optimistic.
5. If exact data is unavailable, use reasonable assumptions and clearly state them.
6. All numbers must be internally consistent.
7. Every conclusion must connect to execution.
8. Do not avoid negative conclusions.
9. Think like an investor.
10. Think by country and market behavior.

LANGUAGE / COUNTRY STRATEGY:
- If language is "ko", assume Korea-first strategy.
- If language is "en", assume global / English-speaking market.
- If language is "ja", assume Japan-first strategy.
- If language is "zh", assume Chinese-speaking market strategy.
- If language is "mn", assume Mongolia-first strategy.
- For Mongolia, strongly consider Facebook commerce, bank transfer behavior, local trust, offline-online hybrid sales, and low-friction payment behavior.

REPORT PURPOSE:
The reader must be able to decide:
- Should I start this business?
- How much money do I need to test it?
- What should I test first?
- What can kill this business?
- What exact action should I take tomorrow?

OUTPUT JSON STRUCTURE:

{
  "meta": {
    "brandName": "",
    "productService": "",
    "targetCustomer": "",
    "language": "",
    "reportType": "paid",
    "reportTitle": "",
    "generatedFor": ""
  },

  "executiveDecision": {
    "decision": "GO | CONDITIONAL_GO | NO_GO",
    "oneLineConclusion": "",
    "decisionReason": "",
    "confidenceScore": 0,
    "whyNow": "",
    "mainWarning": ""
  },

  "scorecard": {
    "marketScore": 0,
    "profitScore": 0,
    "executionScore": 0,
    "competitionScore": 0,
    "timingScore": 0,
    "totalScore": 0,
    "scoreExplanation": ""
  },

  "marketAnalysis": {
    "marketDefinition": "",
    "tam": {
      "value": 0,
      "currency": "USD",
      "calculation": "",
      "assumptions": []
    },
    "sam": {
      "value": 0,
      "currency": "USD",
      "calculation": "",
      "assumptions": []
    },
    "som": {
      "value": 0,
      "currency": "USD",
      "calculation": "",
      "assumptions": []
    },
    "marketTrend": "",
    "marketTiming": "",
    "marketRisks": []
  },

  "customerAnalysis": {
    "primaryPersona": {
      "name": "",
      "ageRange": "",
      "incomeLevel": "",
      "behavior": "",
      "buyingTrigger": "",
      "mainObjection": ""
    },
    "painPoints": [],
    "desiredOutcomes": [],
    "willingnessToPay": "",
    "purchaseFrequency": "",
    "trustBarriers": []
  },

  "productStrategy": {
    "coreValueProposition": "",
    "mustHaveFeatures": [],
    "niceToHaveFeatures": [],
    "minimumSellableOffer": "",
    "pricingRecommendation": {
      "lowPrice": 0,
      "midPrice": 0,
      "premiumPrice": 0,
      "currency": "",
      "reason": ""
    },
    "positioningStatement": ""
  },

  "unitEconomics": {
    "aov": 0,
    "grossMarginRate": 0,
    "estimatedCAC": 0,
    "estimatedLTV": 0,
    "ltvToCacRatio": 0,
    "paybackPeriod": "",
    "profitabilityStatus": "PROFITABLE | RISKY | NOT_PROFITABLE",
    "calculationAssumptions": [],
    "unitEconomicsWarning": ""
  },

  "competition": {
    "competitionLevel": "LOW | MEDIUM | HIGH",
    "directCompetitors": [],
    "indirectCompetitors": [],
    "substituteBehaviors": [],
    "differentiationStrategy": "",
    "unfairAdvantageNeeded": ""
  },

  "goToMarket": {
    "primaryChannels": [],
    "channelReasoning": "",
    "firstCampaign": {
      "campaignName": "",
      "message": "",
      "targetAudience": "",
      "budget": 0,
      "expectedResult": ""
    },
    "countrySpecificStrategy": "",
    "salesFunnel": {
      "step1": "",
      "step2": "",
      "step3": "",
      "step4": ""
    }
  },

  "executionPlan": {
    "day1": "",
    "day3": "",
    "day7": "",
    "day14": "",
    "day30": "",
    "minimumTestBudget": 0,
    "mustMeasureKPIs": [],
    "killCriteria": [],
    "scaleCriteria": []
  },

  "riskAnalysis": {
    "topRisks": [
      {
        "risk": "",
        "impact": "HIGH | MEDIUM | LOW",
        "probability": "HIGH | MEDIUM | LOW",
        "mitigation": ""
      }
    ],
    "biggestFailureScenario": "",
    "legalOrOperationalConcerns": []
  },

  "finalRecommendation": {
    "finalDecision": "GO | CONDITIONAL_GO | NO_GO",
    "recommendedNextMove": "",
    "whatNotToDo": [],
    "founderMessage": ""
  }
}

SCORING RULES:
- 80-100: Strong GO
- 65-79: Conditional GO
- 50-64: High risk, test only
- Below 50: NO_GO

IMPORTANT:
If the business idea is weak, say it clearly.
If the idea can work only in a narrow condition, explain that condition.
Do not write generic business advice.
Generate the JSON now.
`;
}

function buildFreeReportFromPaidReport(fullReport) {
  return {
    meta: {
      brandName: fullReport?.meta?.brandName || "",
      productService: fullReport?.meta?.productService || "",
      targetCustomer: fullReport?.meta?.targetCustomer || "",
      language: fullReport?.meta?.language || "ko",
      reportType: "free",
      reportTitle: fullReport?.meta?.reportTitle || "Free Business Report",
    },

    executiveDecision: {
      decision: fullReport?.executiveDecision?.decision || "CONDITIONAL_GO",
      oneLineConclusion: fullReport?.executiveDecision?.oneLineConclusion || "",
      confidenceScore: fullReport?.executiveDecision?.confidenceScore || 0,
      mainWarning: fullReport?.executiveDecision?.mainWarning || "",
    },

    scorecard: {
      marketScore: fullReport?.scorecard?.marketScore || 0,
      profitScore: fullReport?.scorecard?.profitScore || 0,
      executionScore: fullReport?.scorecard?.executionScore || 0,
      totalScore: fullReport?.scorecard?.totalScore || 0,
    },

    marketAnalysis: {
      marketDefinition: fullReport?.marketAnalysis?.marketDefinition || "",
      marketTrend: fullReport?.marketAnalysis?.marketTrend || "",
      marketTiming: fullReport?.marketAnalysis?.marketTiming || "",
    },

    customerAnalysis: {
      painPoints: fullReport?.customerAnalysis?.painPoints?.slice(0, 3) || [],
      desiredOutcomes: fullReport?.customerAnalysis?.desiredOutcomes?.slice(0, 3) || [],
      willingnessToPay: fullReport?.customerAnalysis?.willingnessToPay || "",
    },

    productStrategy: {
      coreValueProposition: fullReport?.productStrategy?.coreValueProposition || "",
      minimumSellableOffer: fullReport?.productStrategy?.minimumSellableOffer || "",
    },

    finalRecommendation: {
      finalDecision: fullReport?.finalRecommendation?.finalDecision || "CONDITIONAL_GO",
      recommendedNextMove: fullReport?.finalRecommendation?.recommendedNextMove || "",
    },

    lockedSections: {
      tamSamSom: true,
      unitEconomics: true,
      competition: true,
      goToMarket: true,
      executionPlan: true,
      riskAnalysis: true,
      message: "전체 시장 규모, 수익성 계산, 실행 전략은 유료 보고서에서 확인할 수 있습니다."
    }
  };
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
                sample.cover.oneLineVerdict,
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
    const execMap = objectFromPairs(report.executiveDecision)

    const funnel = normalizeFunnel(report.marketFunnel)

    const data = {
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

        cacValue: unit.CAC || "",
        ltvValue: unit.LTV || "",
        aovValue: unit.AOV || "",
        repeatValue: unit.REPEAT || "",

        economicsJudgment: report.economicsJudgment,
        modelJudgment: report.businessModel.modelJudgment,
        operatingRule: report.operatingRule,
        finalRule: report.finalRule,
    }

    html = replacePlaceholders(html, data)

    html = html
        .replace("{{tamSamSomRows}}", rows(report.tamSamSom))
        .replace("{{customerTruthRows}}", rows(report.customerTruth))
        .replace("{{competitionRows}}", rows(report.competitionMap))
        .replace("{{competitionConclusion}}", esc(report.competitionConclusion))
        .replace("{{unitEconomicsRows}}", rows(report.unitEconomicsTable))
        .replace(
            "{{marketingChannelRows}}",
            rows(report.marketingStrategy.channelFit)
        )
        .replace(
            "{{contentPlaybookItems}}",
            listItems(report.marketingStrategy.contentPlaybook)
        )
        .replace(
            "{{marketingTestRows}}",
            rows(report.marketingStrategy.thirtyDayMarketingTest)
        )
        .replace(
            "{{businessModelRows}}",
            rows(report.businessModel.revenueLayers)
        )
        .replace("{{riskRows}}", rows(report.riskSystem))
        .replace("{{executionRows}}", rows(report.executionPlan))
        .replace("{{goThresholdRows}}", rows(report.goThreshold))
        .replace("{{goChecklistItems}}", checklistItems(report.goChecklist))
        .replace("{{dataSourceRows}}", rows(report.appendix.dataSources))
        .replace("{{assumptionItems}}", listItems(report.appendix.assumptions))

    html = html.replace(/{{[^}]+}}/g, "")

    return html
}

async function htmlToPdf(html) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    })

    try {
        const page = await browser.newPage()
        await page.setContent(html, { waitUntil: "networkidle0" })

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

function normalizeLanguage(lang) {
    const supported = ["ko", "en", "ja", "zh", "mn"]
    return supported.includes(lang) ? lang : "en"
}

function flattenLabels(labels) {
    const flat = {}
    Object.entries(labels || {}).forEach(([k, v]) => {
        flat[`label.${k}`] = v
    })
    return flat
}

function flattenNotes(notes) {
    const flat = {}
    Object.entries(notes || {}).forEach(([k, v]) => {
        flat[`note.${k}`] = v
    })
    return flat
}

function replacePlaceholders(html, data) {
    let output = html
    Object.entries(data).forEach(([key, value]) => {
        output = output.replace(
            new RegExp(`{{${key}}}`, "g"),
            esc(String(value ?? ""))
        )
    })
    return output
}

function rows(items) {
    if (!Array.isArray(items)) return ""
    return items
        .map((row) => {
            const cells = Array.isArray(row) ? row : Object.values(row)
            return `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`
        })
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""
    return items.map((i) => `<li>${esc(i)}</li>`).join("")
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

function getSampleReport(lang = "ko") {
    return {
        cover: {
            brandName: "샘플브랜드",
            decision: "HOLD",
            score: 60,
            subtitle: "샘플 설명",
            oneLineVerdict: "이 사업은 검증 후 진행해야 한다.",
        },
        visualScores: { market: 70, profitability: 55, execution: 60, risk: 65 },
        decisionMatrix: [
            ["MARKET", "HIGH"],
            ["PROFITABILITY", "MEDIUM"],
            ["EXECUTION", "HIGH"],
            ["RISK", "HIGH"],
        ],
        executiveDecision: [
            ["Why this works", "수요는 존재한다"],
            ["Why this fails", "차별화 부족"],
            ["What to do now", "소규모 테스트"],
        ],
        founderDecision: "확장 금지, 검증 먼저",
        marketCards: [
            ["TAM", "100B"],
            ["SAM", "30B"],
            ["SOM", "1K users"],
            ["GROWTH", "5%"],
        ],
        marketFunnel: [
            { label: "TAM", value: "100B", score: 100 },
            { label: "SAM", value: "30B", score: 50 },
            { label: "SOM", value: "1K", score: 20 },
        ],
        tamSamSom: [["TAM", "", "", ""], ["SAM", "", "", ""], ["SOM", "", "", ""]],
        marketInsight: "시장 존재",
        customerTruth: [["문제", "행동", "의미"]],
        buyingTrigger: "문제 발생 시 구매",
        competitionMap: [["경쟁", "유형", "강점", "약점"]],
        competitionConclusion: "경쟁 존재",
        unitEconomicsCards: [["CAC", "50"], ["LTV", "150"], ["AOV", "30"], ["REPEAT", "3"]],
        unitEconomicsScore: { ltvToCac: "3x", payback: "2m", margin: "30%", status: "WATCH" },
        unitEconomicsTable: [["", "", "", ""]],
        economicsJudgment: "조건부 가능",
        marketingStrategy: {
            channelFit: [["SNS", "HIGH", "", ""]],
            contentPlaybook: ["콘텐츠"],
            thirtyDayMarketingTest: [["1주", "", ""]],
        },
        businessModel: {
            revenueLayers: [["제품", "", ""]],
            modelJudgment: "업셀 필요",
        },
        riskSystem: [["리스크", "", ""]],
        executionPlan: [["1단계", "", ""]],
        operatingRule: "검증 먼저",
        goThreshold: [["CAC", "", ""]],
        goChecklist: [{ label: "CAC", status: "PASS" }],
        finalRule: "조건 충족 시 GO",
        appendix: {
            dataSources: [["데이터", "", ""]],
            assumptions: ["가정"],
        },
    }
}

app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`)
})
