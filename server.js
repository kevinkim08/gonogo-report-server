// ======================================================
// 01. IMPORTS
// ======================================================

import express from "express"
import cors from "cors"
import OpenAI from "openai"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"


// ======================================================
// 02. APP SETUP
// ======================================================

const app = express()
const PORT = process.env.PORT || 3000

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.json({ limit: "5mb" }))

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


// ======================================================
// 03. BASIC ROUTES
// ======================================================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "GoNoGo Report Server",
        version: "3.0.0-sectioned",
    })
})

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        status: "healthy",
    })
})
// ======================================================
// 04. API ROUTES
// ======================================================

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
                : {
                      ...paidReport,
                      isPaid: true,
                      reportMode: "paid",
                  }

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
            reportType === "paid" || reportType === "deep"
                ? "paid"
                : "free"

        const paidReport = await generateDeepReportJson({
            brandName,
            productService,
            targetCustomer,
            language: normalizedLanguage,
        })

        const finalReport =
            normalizedReportType === "paid"
                ? {
                      ...paidReport,
                      isPaid: true,
                      reportMode: "paid",
                  }
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
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        )

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
// ======================================================
// 05. REPORT GENERATION (OpenAI)
// ======================================================

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

    if (!raw) {
        throw new Error("Empty OpenAI response.")
    }

    return normalizeDeepReport(JSON.parse(raw), input)
}


// ======================================================
// 06. PROMPT BUILDER
// ======================================================

function buildPaidReportPrompt({
    brandName,
    productService,
    targetCustomer,
    language,
}) {
    const languageName = getLanguageName(language)

    return `
You are GoNoGo, a ruthless business decision engine.

You are NOT a writer.
You are NOT a generic consultant.
You are a paid business decision report engine.

Your job:
Evaluate this business idea and generate a premium JSON report.

Final report language: ${languageName}

Business Input:
Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}
Language / Market: ${language}

CRITICAL RULES:

- Output VALID JSON only
- No markdown
- No explanation
- No text outside JSON
- Every field must be filled
- Never return null or undefined
- If data is missing → use conservative assumption

SCORING RULE:

GO: score 75+
HOLD: 50~74
NO GO: below 50

RETURN THIS STRUCTURE:

{
  "cover": {
    "brandName": "${brandName}",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },

  "visualScores": {
    "market": 0,
    "profitability": 0,
    "execution": 0,
    "risk": 0
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

  "marketInsight": "",
  "customerSummary": "",
  "economicsJudgment": "",

  "unitEconomicsCards": [
    ["CAC", ""],
    ["LTV", ""],
    ["AOV", ""],
    ["REPEAT", ""]
  ],

  "decisionMatrix": [
    ["MARKET", "LOW | MEDIUM | HIGH"],
    ["PROFITABILITY", "LOW | MEDIUM | HIGH"],
    ["EXECUTION", "LOW | MEDIUM | HIGH"],
    ["RISK", "LOW | MEDIUM | HIGH"]
  ],

  "founderDecision": ""
}
`
}
// ======================================================
// 07. FREE REPORT BUILDER
// ======================================================

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


// ======================================================
// 08. REPORT NORMALIZER
// ======================================================

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
            businessModelType:
                report?.businessDiagnosis?.businessModelType || "",
            countryMarketBehavior:
                report?.businessDiagnosis?.countryMarketBehavior || "",
            marketEntryDifficulty:
                report?.businessDiagnosis?.marketEntryDifficulty || "MEDIUM",
            mainBottleneck:
                report?.businessDiagnosis?.mainBottleneck || "",
            bestFirstOffer:
                report?.businessDiagnosis?.bestFirstOffer || "",
            validationExperiment:
                report?.businessDiagnosis?.validationExperiment || "",
            goNoGoLogic:
                report?.businessDiagnosis?.goNoGoLogic || "",
            structureSummary:
                report?.businessDiagnosis?.structureSummary || "",
        },

        visualScores: {
            market: toScore(report?.visualScores?.market, 50),
            profitability: toScore(
                report?.visualScores?.profitability,
                50
            ),
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
        customerOpportunity: safeArray(
            report?.customerOpportunity,
            []
        ).slice(0, 4),
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

        unitEconomicsTable: safeArray(
            report?.unitEconomicsTable,
            []
        ).slice(0, 4),

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
            modelJudgment:
                report?.businessModel?.modelJudgment || "",
            modelDeepDive:
                report?.businessModel?.modelDeepDive || "",
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
            overallLevel:
                report?.dataConfidence?.overallLevel || "MEDIUM",
            summary: report?.dataConfidence?.summary || "",
            sourceQuality: safeArray(
                report?.dataConfidence?.sourceQuality,
                []
            ).slice(0, 3),
            limits: safeArray(
                report?.dataConfidence?.limits,
                []
            ).slice(0, 3),
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
            breakEvenPoint:
                report?.profitSimulation?.breakEvenPoint || "",
            profitJudgment:
                report?.profitSimulation?.profitJudgment || "",
            cashRisk: report?.profitSimulation?.cashRisk || "",
        },

        killCriteria: {
            rules: safeArray(
                report?.killCriteria?.rules,
                []
            ).slice(0, 4),
            stopDecision:
                report?.killCriteria?.stopDecision || "",
            pivotDecision:
                report?.killCriteria?.pivotDecision || "",
            scaleDecision:
                report?.killCriteria?.scaleDecision || "",
        },

        appendix: {
            dataSources: safeArray(
                report?.appendix?.dataSources,
                []
            ).slice(0, 3),
            assumptions: safeArray(
                report?.appendix?.assumptions,
                []
            ).slice(0, 4),
        },

        referenceLinks: safeArray(report?.referenceLinks, []).slice(0, 5),
    }
}
// ======================================================
// 09. HTML TEMPLATE BUILDER
// ======================================================

function buildHtmlFromTemplate(report, locale) {
    const templatePath = path.join(
        __dirname,
        "templates",
        "deep-report.html"
    )

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
        [
            "85~100",
            "Excellent",
            "Strong GO candidate. Scaling may be considered.",
        ],
        [
            "70~84",
            "Good",
            "GO is possible if key conditions are met.",
        ],
        [
            "50~69",
            "Average / Needs validation",
            "HOLD. Decide after a small test.",
        ],
        [
            "30~49",
            "Risky",
            "High NO GO probability. Redesign the structure.",
        ],
        [
            "0~29",
            "Very risky",
            "Stop immediately or fully reconsider.",
        ],
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
        countryMarketBehavior:
            report.businessDiagnosis?.countryMarketBehavior || "",
        marketEntryDifficulty:
            report.businessDiagnosis?.marketEntryDifficulty || "",
        mainBottleneck: report.businessDiagnosis?.mainBottleneck || "",
        bestFirstOffer: report.businessDiagnosis?.bestFirstOffer || "",
        validationExperiment:
            report.businessDiagnosis?.validationExperiment || "",
        goNoGoLogic: report.businessDiagnosis?.goNoGoLogic || "",
        structureSummary: report.businessDiagnosis?.structureSummary || "",

        dataConfidenceLevel: report.dataConfidence?.overallLevel || "",
        dataConfidenceSummary: report.dataConfidence?.summary || "",
        criticalBreakPoint:
            report.sensitivityAnalysis?.criticalBreakPoint || "",
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

        brandDirection: report?.brandNaming?.brandDirection || "",
        namingStrategy: report?.brandNaming?.namingStrategy || "",

        brandKeywordCards: Array.isArray(report?.brandNaming?.keywords)
            ? report.brandNaming.keywords
                  .slice(0, 8)
                  .map(
                      (keyword) => `
                        <div class="card">
                            <div class="card-title">${
                                locale.brand_keyword_label || "Keyword"
                            }</div>
                            <div class="card-value">${esc(keyword)}</div>
                        </div>
                    `
                  )
                  .join("")
            : "",

        brandNameCandidateRows: Array.isArray(
            report?.brandNaming?.nameCandidates
        )
            ? report.brandNaming.nameCandidates
                  .slice(0, 5)
                  .map(
                      (item) => `
                        <tr>
                            <td>${esc(item?.name || "")}</td>
                            <td>${esc(item?.meaning || "")}</td>
                            <td>${esc(item?.fit || "")}</td>
                            <td>${esc(item?.risk || "")}</td>
                            <td>${esc(item?.score || "")}</td>
                        </tr>
                    `
                  )
                  .join("")
            : "",

        recommendedBrandName:
            report?.brandNaming?.recommendedName?.name || "",

        recommendedBrandReason: [
            report?.brandNaming?.recommendedName?.reason || "",
            report?.brandNaming?.recommendedName?.positioning || "",
            report?.brandNaming?.recommendedName?.expansionPotential || "",
        ]
            .filter(Boolean)
            .join(" "),

        brandDomainRows: Array.isArray(
            report?.brandNaming?.domainSuggestions
        )
            ? report.brandNaming.domainSuggestions
                  .slice(0, 5)
                  .map(
                      (item) => `
                        <tr>
                            <td>${esc(item?.domain || "")}</td>
                            <td>${esc(item?.reason || "")}</td>
                            <td>${esc(item?.availability || "")}</td>
                        </tr>
                    `
                  )
                  .join("")
            : "",

        marketLevel: matrix.MARKET || "",
        profitabilityLevel: matrix.PROFITABILITY || "",
        executionLevel: matrix.EXECUTION || "",
        riskLevel: matrix.RISK || "",

        marketScore: report.visualScores.market,
        profitabilityScore: report.visualScores.profitability,
        executionScore: report.visualScores.execution,
        riskScore: report.visualScores.risk,

        marketScoreClass: getScoreClass(report.visualScores.market),
        profitabilityScoreClass: getScoreClass(
            report.visualScores.profitability
        ),
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
        competitionPositionChart: competitionPositionChart(
            report.competitionMap,
            locale
        ),
        riskHeatmap: riskHeatmap(report.riskSystem, locale),
        executionTimeline: executionTimeline(report.executionPlan, locale),
        decisionSummaryBox: decisionSummaryBox(report, locale),
    }

    const templateData = {
        ...locale,
        ...data,
    }
            html = html
        .replace("{{modelDeepDive}}", report?.businessModel?.modelDeepDive || "")
        .replace("{{referenceLinkRows}}", rows(referenceLinks))
        .replace("{{glossaryRows}}", glossaryRows(report.glossary))
        .replace("{{scoreGuideRows}}", rows(scoreGuideRows))
        .replace("{{marketFunnelChart}}", marketFunnelChart(report.marketFunnel))
        .replaceAll(
            "{{profitSimulationChart}}",
            profitSimulationChart(
                report.profitSimulation?.monthlyScenarioTable,
                locale
            )
        )
        .replace(
            "{{cacLtvRiskChart}}",
            cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale)
        )
        .replace(
            "{{tamSamSomRows}}",
            report?.lockedSections?.tamSamSom
                ? `<tr><td colspan="4">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
                : rows(report.tamSamSom)
        )
        .replace("{{customerTruthRows}}", rows(report.customerTruth))
        .replace("{{customerOpportunityRows}}", rows(customerOpportunityRows))
        .replace(
            "{{competitionRows}}",
            report?.lockedSections?.competition
                ? `<tr><td colspan="4">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
                : rows(report.competitionMap)
        )
        .replace(
            "{{competitionPositionChart}}",
            competitionPositionChart(report.competitionMap, locale)
        )
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
                ? `<tr><td colspan="4">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
                : rows(report.unitEconomicsTable)
        )
        .replace(
            "{{marketingChannelRows}}",
            report?.lockedSections?.marketing
                ? `<tr><td colspan="4">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
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
                ? `<tr><td colspan="3">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
                : rows(report.marketingStrategy.thirtyDayMarketingTest)
        )
        .replace(
            "{{businessModelRows}}",
            rows(report.businessModel.revenueLayers)
        )
        .replace(
            "{{riskRows}}",
            report?.lockedSections?.risk
                ? `<tr><td colspan="3">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
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
                ? `<tr><td colspan="3">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
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
                ? `<tr><td colspan="3">${lockedBox(
                      lockedMessage,
                      lockedTitle,
                      lockedButton
                  )}</td></tr>`
                : rows(report.goThreshold)
        )
        .replace("{{goChecklistItems}}", checklistItems(report.goChecklist))
        .replace(
            "{{sourceQualityRows}}",
            rows(report.dataConfidence?.sourceQuality)
        )
        .replace(
            "{{dataLimitItems}}",
            listItems(report.dataConfidence?.limits)
        )
        .replace("{{referenceLinkRows}}", rows(referenceLinks))
        .replace(
            "{{cacLtvRows}}",
            rows(report.sensitivityAnalysis?.cacLtvTable)
        )
        .replace(
            "{{profitSimulationRows}}",
            rows(report.profitSimulation?.monthlyScenarioTable)
        )
        .replace(
            "{{killCriteriaRows}}",
            rows(report.killCriteria?.rules)
        )
        .replace(
            "{{dataSourceRows}}",
            rows(report.appendix.dataSources)
        )
        .replace(
            "{{assumptionItems}}",
            listItems(report.appendix.assumptions)
        )

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
        "riskHeatmap",
        "executionRows",
        "executionTimeline",
        "decisionSummaryBox",
        "goThresholdRows",
        "goChecklistItems",
        "sourceQualityRows",
        "dataLimitItems",
        "cacLtvRows",
        "profitSimulationRows",
        "killCriteriaRows",
        "dataSourceRows",
        "assumptionItems",
    ])

    html = applyTemplateVars(html, templateData)

    if (report?.reportMode === "free") {
        html = keepFreeReportOnly(html, locale, report)
    }

    html = html.replace(/{{[^}]+}}/g, "")

    return html
}
// ======================================================
// 10. FREE REPORT / PAYWALL
// ======================================================

function keepFreeReportOnly(html, locale = {}, report = {}) {
    const splitPoint = "<!-- FREE_REPORT_END -->"
    const index = html.indexOf(splitPoint)

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

    const checkoutUrl =
        process.env.PAYWALL_CHECKOUT_URL ||
        "https://your-checkout-link.com"

    return `
${freePart}

<section class="page section-cover">
  <div class="section-kicker">
    ${esc(t(locale, "premium.kicker", "PREMIUM REPORT"))}
  </div>

  <div class="section-cover-title">
    ${esc(t(locale, "premium.title", "You are 65% done. The real decision is locked."))}
  </div>

  <div class="section-cover-desc">
    ${esc(t(locale, "premium.desc", "The free report shows the basic direction. The full report unlocks brand naming, domain strategy, customer buying logic, market reality, profit structure, risk judgment, and execution strategy."))}
  </div>

  <div style="
    margin-top:28px;
    border:1px solid #d8e7dc;
    background:#ffffff;
    padding:22px;
    box-shadow:0 14px 36px rgba(16,32,24,0.10);
  ">
    <div style="
      font-size:11px;
      font-weight:900;
      color:#2f7d57;
      text-transform:uppercase;
      letter-spacing:0.06em;
      margin-bottom:10px;
    ">
      ${esc(t(locale, "premium.progressLabel", "Report Completion"))}
    </div>

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
      ${esc(t(locale, "premium.ctaButton", "Unlock Full Report"))} — $49
    </a>

    <div style="
      margin-top:12px;
      font-size:11px;
      line-height:1.5;
      color:#6a7a71;
      text-align:center;
    ">
      ${esc(t(locale, "premium.ctaSub", "Includes brand naming, domain strategy, customer analysis, market reality, revenue structure, execution plan, and risk judgment."))}
    </div>
  </div>

  <div class="footer">
    <span>${esc(footerLeft)}</span>
    <span>${esc(premiumFooter)}</span>
  </div>
</section>
`
}

function lockedBox(
    message,
    title = "Premium Insights",
    buttonLabel = "Premium Report"
) {
    return `
        <div style="
            border:1px solid #d8e7dc;
            background:#f6faf7;
            padding:14px;
            border-radius:8px;
        ">
            <div style="
                font-size:13px;
                font-weight:900;
                color:#163c2b;
                margin-bottom:6px;
            ">
                ${esc(title)}
            </div>

            <div style="
                font-size:11px;
                color:#555;
                margin-bottom:10px;
                line-height:1.5;
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


// ======================================================
// 11. PDF GENERATOR
// ======================================================

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


// ======================================================
// 12. CHART / VISUAL HTML HELPERS 1
// ======================================================

function marketFunnelChart(items = [], locale = {}) {
    if (!Array.isArray(items) || items.length === 0) return ""

    const normalized = items.map((item) => {
        const label = item?.label || ""
        const value = item?.value || ""
        const score = Math.max(8, Math.min(100, Number(item?.score || 0)))

        return {
            label,
            value,
            score,
        }
    })

    return `
        <div class="market-funnel-box">
            ${normalized
                .map((item, index) => {
                    const levelClass =
                        index === 0
                            ? "funnel-tam"
                            : index === 1
                              ? "funnel-sam"
                              : "funnel-som"

                    return `
                        <div class="market-funnel-row ${levelClass}">
                            <div class="market-funnel-label">${esc(
                                item.label
                            )}</div>

                            <div class="market-funnel-track">
                                <div 
                                    class="market-funnel-fill" 
                                    style="width:${item.score}%"
                                ></div>
                            </div>

                            <div class="market-funnel-value">${esc(
                                item.value
                            )}</div>
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
        chart.marketingCost ||
        locale?.th_marketing_cost ||
        "Marketing Cost"

    const profitLabel =
        chart.profit || locale?.th_expected_profit || "Profit"

    return `
        <div class="chart-box">
            ${rowsData
                .map((row) => {
                    const scenario = row?.[0] || ""
                    const revenue = parseMoney(row?.[2])
                    const marketing = parseMoney(row?.[3])
                    const profit = parseMoney(row?.[4])

                    const max = Math.max(
                        revenue,
                        marketing,
                        Math.abs(profit),
                        1
                    )

                    const revenueW = Math.max(
                        5,
                        Math.min(100, (revenue / max) * 100)
                    )

                    const marketingW = Math.max(
                        5,
                        Math.min(100, (marketing / max) * 100)
                    )

                    const profitW = Math.max(
                        5,
                        Math.min(100, (Math.abs(profit) / max) * 100)
                    )

                    return `
                        <div class="scenario-chart">
                            <div class="scenario-title">${esc(
                                scenario
                            )}</div>

                            <div class="mini-bar-row">
                                <span>${esc(revenueLabel)}</span>
                                <div class="chart-track">
                                    <div 
                                        class="chart-fill" 
                                        style="width:${revenueW}%"
                                    ></div>
                                </div>
                                <b>${esc(row?.[2] || "")}</b>
                            </div>

                            <div class="mini-bar-row">
                                <span>${esc(marketingCostLabel)}</span>
                                <div class="chart-track">
                                    <div 
                                        class="chart-fill light" 
                                        style="width:${marketingW}%"
                                    ></div>
                                </div>
                                <b>${esc(row?.[3] || "")}</b>
                            </div>

                            <div class="mini-bar-row">
                                <span>${esc(profitLabel)}</span>
                                <div class="chart-track">
                                    <div 
                                        class="chart-fill ${
                                            profit < 0 ? "danger" : ""
                                        }" 
                                        style="width:${profitW}%"
                                    ></div>
                                </div>
                                <b>${esc(row?.[4] || "")}</b>
                            </div>
                        </div>
                    `
                })
                .join("")}
        </div>
    `
}

function cacLtvRiskChart(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    const chart = locale?.chart || {}
    const ratioLabel = chart.ltvCac || "LTV/CAC"

    return `
        <div class="chart-box">
            ${rowsData
                .map((row) => {
                    const scenario = row?.[0] || ""
                    const cac = parseMoney(row?.[1])
                    const ltv = parseMoney(row?.[2])
                    const ratio = cac > 0 ? ltv / cac : 0
                    const width = Math.max(5, Math.min(100, ratio * 25))

                    const cls =
                        ratio >= 3 ? "" : ratio >= 2 ? "light" : "danger"

                    return `
                        <div class="chart-row">
                            <div class="chart-label">${esc(scenario)}</div>

                            <div class="chart-track">
                                <div 
                                    class="chart-fill ${cls}" 
                                    style="width:${width}%"
                                ></div>
                            </div>

                            <div class="chart-value">
                                ${esc(ratioLabel)} ${ratio.toFixed(1)}x
                            </div>
                        </div>
                    `
                })
                .join("")}
        </div>
    `
}
function buildDecisionChart(report, locale = {}) {
    const market = toScore(report?.visualScores?.market, 60)
    const profitability = toScore(report?.visualScores?.profitability, 50)
    const execution = toScore(report?.visualScores?.execution, 55)
    const risk = toScore(report?.visualScores?.risk, 40)

    const avg = Math.round(
        (market + profitability + execution + (100 - risk)) / 4
    )

    const chart = locale?.chart || {}
    const label = locale?.label || locale?.labels || {}

    const message =
        avg >= 70
            ? chart.decisionStrong ||
              "Decision signal is strong enough to continue validation."
            : avg >= 50
              ? chart.decisionMixed ||
                "Decision signal is mixed. Validate before scaling."
              : chart.decisionWeak ||
                "Decision signal is weak. Redesign before spending more."

    return `
        <div class="decision-chart-box">
            <div class="decision-chart-head">
                <div>
                    <div class="decision-chart-kicker">${esc(
                        chart.decisionSignal || "Decision Signal"
                    )}</div>
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
                label:
                    chart.profitability ||
                    label.profitability ||
                    "Profitability",
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
                label:
                    chart.riskPressure ||
                    label.riskPressure ||
                    "Risk Pressure",
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
                <div 
                    class="decision-bar-fill ${cls}" 
                    style="width:${safeValue}%"
                ></div>
            </div>
            <div class="decision-bar-value">
                ${safeValue} · ${esc(status)}
            </div>
        </div>
    `
}

function competitionPositionChart(map = [], locale = {}) {
    if (!Array.isArray(map)) return ""

    const chart = locale?.chart || {}

    const lowPrice = chart.lowPrice || "Low Price"
    const highPrice = chart.highPrice || "High Price"
    const highValue = chart.highValue || "High Value"
    const lowValue = chart.lowValue || "Low Value"

    return `
        <div class="chart-box">
            <div style="
                position: relative;
                height: 240px;
                background: #f6faf7;
                border:1px solid #d8e7dc;
            ">
                ${map
                    .map((row, i) => {
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
                    })
                    .join("")}

                <div style="
                    position:absolute;
                    left:10px;
                    bottom:10px;
                    font-size:10px;
                ">
                    ${esc(lowPrice)}
                </div>

                <div style="
                    position:absolute;
                    right:10px;
                    bottom:10px;
                    font-size:10px;
                ">
                    ${esc(highPrice)}
                </div>

                <div style="
                    position:absolute;
                    left:10px;
                    top:10px;
                    font-size:10px;
                ">
                    ${esc(highValue)}
                </div>

                <div style="
                    position:absolute;
                    left:10px;
                    bottom:30px;
                    font-size:10px;
                ">
                    ${esc(lowValue)}
                </div>
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
    const actionLabel =
        chart.action || locale?.th_execution_content || "Action"
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
                            <div class="scenario-title">
                                ${index + 1}. ${phase}
                            </div>
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
            ? chart.goAction ||
              "Start execution immediately with controlled budget."
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
                    ${esc(locale?.scoreLabel || "Score")}: 
                    <b>${score}</b> / 100
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
        .map((item) => {
            const status = item?.status || "WATCH"
            const cls = getStatusClass(status)

            return `
                <div class="checklist-item ${cls}">
                    <span>${esc(item?.label || "")}</span>
                    <b>${esc(status)}</b>
                </div>
            `
        })
        .join("")
}

function glossaryRows(items) {
    if (!Array.isArray(items) || items.length === 0) return ""

    return items
        .map(
            (item) => `
                <tr>
                    <td>${esc(item?.term || "")}</td>
                    <td>${esc(item?.meaning || "")}</td>
                    <td>${esc(item?.whyItMatters || "")}</td>
                </tr>
            `
        )
        .join("")
}


// ======================================================
// 13. TEMPLATE HELPERS
// ======================================================

function loadLocale(lang) {
    const filePath = path.join(__dirname, "locales", `${lang}.json`)
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function getByPath(obj, pathKey) {
    return String(pathKey || "")
        .split(".")
        .reduce((acc, key) => {
            if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
                return acc[key]
            }

            return undefined
        }, obj)
}

function applyTemplateVars(html, data = {}) {
    return html.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (match, key) => {
        const value = getByPath(data, key)

        if (value === undefined || value === null) {
            console.error(`[TEMPLATE_MISSING_KEY] ${key}`)
            return `[MISSING:${key}]`
        }

        if (typeof value === "string" && value.trim().startsWith("<")) {
            return value
        }

        return esc(value)
    })
}

function extractTemplateKeys(html) {
    const matches = html.match(/{{\s*[^}]+\s*}}/g) || []

    return [
        ...new Set(
            matches.map((match) => {
                return match.replace(/[{}]/g, "").trim()
            })
        ),
    ]
}

function validateTemplateKeys(html, templateData, blockKeys = []) {
    const htmlKeys = extractTemplateKeys(html)

    const missingKeys = htmlKeys.filter((key) => {
        if (blockKeys.includes(key)) return false
        return !(key in templateData)
    })

    const extraKeys = Object.keys(templateData).filter((key) => {
        return !htmlKeys.includes(key)
    })

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

function rows(items) {
    if (!Array.isArray(items)) return ""

    return items
        .map((row) => {
            const cells = Array.isArray(row) ? row : Object.values(row)

            return `
                <tr>
                    ${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}
                </tr>
            `
        })
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""

    return items.map((item) => `<li>${esc(item)}</li>`).join("")
}


// ======================================================
// 14. GENERAL UTILS
// ======================================================

function normalizeLanguage(lang) {
    const supported = ["ko", "en", "ja", "zh", "mn"]
    return supported.includes(lang) ? lang : "en"
}

function getLanguageName(code) {
    return (
        {
            ko: "Korean",
            en: "English",
            ja: "Japanese",
            zh: "Chinese",
            mn: "Mongolian",
        }[code] || "English"
    )
}

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
}

function safeArray(value, fallback = []) {
    return Array.isArray(value) ? value : fallback
}

function toScore(value, fallback = 50) {
    const n = Number(value)

    if (!Number.isFinite(n)) return fallback

    return Math.max(0, Math.min(100, Math.round(n)))
}

function sanitizeFileName(value) {
    return String(value || "report").replace(
        /[^\w가-힣ぁ-んァ-ン一-龥]/g,
        "_"
    )
}

function objectFromPairs(items) {
    const out = {}

    if (!Array.isArray(items)) return out

    items.forEach((item) => {
        if (Array.isArray(item)) {
            out[item[0]] = item[1]
        }
    })

    return out
}

function normalizeFunnel(items) {
    const base = {
        tam: {
            label: "TAM",
            value: "",
            score: 100,
        },
        sam: {
            label: "SAM",
            value: "",
            score: 60,
        },
        som: {
            label: "SOM",
            value: "",
            score: 20,
        },
    }

    if (!Array.isArray(items)) return base

    items.forEach((item) => {
        const key = String(item?.label || "").toLowerCase()

        if (key === "tam") base.tam = item
        if (key === "sam") base.sam = item
        if (key === "som") base.som = item
    })

    return base
}

function getStatusClass(value) {
    const v = String(value || "").toLowerCase()

    if (
        v.includes("no go") ||
        v.includes("fail") ||
        v.includes("danger") ||
        v.includes("위험")
    ) {
        return "status-red"
    }

    if (
        v.includes("hold") ||
        v.includes("watch") ||
        v.includes("주의") ||
        v.includes("보류")
    ) {
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
    if (n >= 70) return "status-red"
    if (n >= 50) return "status-yellow"

    return "status-green"
}

function parseMoney(value) {
    const raw = String(value || "")
    const cleaned = raw.replace(/[^\d.-]/g, "")
    const n = Number(cleaned)

    return Number.isFinite(n) ? Math.abs(n) : 0
}

function getDefaultGlossary(language = "en") {
    const lang = normalizeLanguage(language)

    if (lang === "ko") {
        return [
            {
                term: "TAM",
                meaning: "전체 시장 규모",
                whyItMatters: "사업이 접근할 수 있는 최대 기회를 판단합니다.",
            },
            {
                term: "SAM",
                meaning: "실제 공략 가능한 시장",
                whyItMatters: "초기 채널과 고객 범위를 현실적으로 좁힙니다.",
            },
            {
                term: "SOM",
                meaning: "초기 확보 가능한 시장",
                whyItMatters: "첫 12개월 목표를 보수적으로 계산합니다.",
            },
            {
                term: "CAC",
                meaning: "고객 한 명을 얻는 비용",
                whyItMatters: "광고비와 수익성의 생존선을 결정합니다.",
            },
            {
                term: "LTV",
                meaning: "고객 한 명이 남기는 총 가치",
                whyItMatters: "반복 구매와 장기 수익성을 판단합니다.",
            },
        ]
    }

    return [
        {
            term: "TAM",
            meaning: "Total addressable market.",
            whyItMatters: "Shows the maximum market opportunity.",
        },
        {
            term: "SAM",
            meaning: "Serviceable available market.",
            whyItMatters: "Narrows the market to reachable segments.",
        },
        {
            term: "SOM",
            meaning: "Serviceable obtainable market.",
            whyItMatters: "Defines realistic first-year capture potential.",
        },
        {
            term: "CAC",
            meaning: "Cost to acquire one customer.",
            whyItMatters: "Determines whether marketing can be profitable.",
        },
        {
            term: "LTV",
            meaning: "Lifetime value of one customer.",
            whyItMatters: "Shows whether repeat value supports growth.",
        },
    ]
}


// ======================================================
// 15. SERVER START
// ======================================================

app.listen(PORT, () => {
    console.log(`GoNoGo Report Server running on port ${PORT}`)
})
