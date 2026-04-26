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
        version: "2.0.0-html-pdf",
    })
})

app.get("/api/health", (req, res) => {
    res.json({ ok: true, status: "healthy" })
})

app.get("/api/test-pdf", async (req, res) => {
    try {
        const sampleReport = getSampleReport()
        const html = buildHtmlFromTemplate(sampleReport)
        const pdfBuffer = await htmlToPdf(html)

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="GoNoGo_Test_Report.pdf"`
        )

        return res.send(pdfBuffer)
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
            language = "en",
            reportType = "deep",
        } = req.body || {}

        if (!brandName || !productService || !targetCustomer) {
            return res.status(400).json({
                ok: false,
                error: "brandName, productService, targetCustomer are required.",
            })
        }

        const report =
            reportType === "free"
                ? await generateFreeReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language,
                  })
                : await generateDeepReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language,
                  })

        const html = buildHtmlFromTemplate(report)
        const pdfBuffer = await htmlToPdf(html)

        const safeBrand = sanitizeFileName(brandName)
        const fileName =
            reportType === "free"
                ? `GoNoGo_Free_Report_${safeBrand}_${language}.pdf`
                : `GoNoGo_Deep_Report_${safeBrand}_${language}.pdf`

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)

        return res.send(pdfBuffer)
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
    [string, string],
    [string, string],
    [string, string],
    [string, string]
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
- Include market size, success probability, unit economics, marketing strategy, and execution plan.
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
    const sample = getSampleReport()

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
        decisionMatrix: safeArray(report?.decisionMatrix, sample.decisionMatrix),
        executiveDecision: safeArray(
            report?.executiveDecision,
            sample.executiveDecision
        ),
        founderDecision: report?.founderDecision || sample.founderDecision,
        marketCards: safeArray(report?.marketCards, sample.marketCards),
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

function buildHtmlFromTemplate(report) {
    const templatePath = path.join(__dirname, "templates", "deep-report.html")
    let html = fs.readFileSync(templatePath, "utf8")

    const matrix = objectFromPairs(report.decisionMatrix)
    const market = objectFromPairs(report.marketCards)
    const unit = objectFromPairs(report.unitEconomicsCards)

    const executiveMap = objectFromPairs(report.executiveDecision)

    const data = {
        brandName: report.cover.brandName,
        decision: report.cover.decision,
        score: report.cover.score,
        subtitle: report.cover.subtitle,
        oneLineVerdict: report.cover.oneLineVerdict,

        marketLevel: matrix.MARKET || "",
        profitabilityLevel: matrix.PROFITABILITY || "",
        executionLevel: matrix.EXECUTION || "",
        riskLevel: matrix.RISK || "",

        whyItWorks: executiveMap["Why this works"] || "",
        whyItFails: executiveMap["Why this fails"] || "",
        whatToDoNow: executiveMap["What to do now"] || "",
        founderDecision: report.founderDecision,

        tamValue: market.TAM || market["GLOBAL PET FOOD"] || "",
        samValue: market.SAM || market["U.S. PET FOOD"] || "",
        somValue: market.SOM || market["U.S. PET SPEND"] || "",
        growthValue: market.GROWTH || "",

        marketInsight: report.marketInsight,
        buyingTrigger: report.buyingTrigger,

        cacValue: unit.CAC || "",
        ltvValue: unit.LTV || "",
        aovValue: unit.AOV || "",
        repeatValue: unit.REPEAT || unit.PAYBACK || "",

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
        .replace("{{dataSourceRows}}", rows(report.appendix.dataSources))
        .replace("{{assumptionItems}}", listItems(report.appendix.assumptions))

    html = html.replace(/{{[^}]+}}/g, "")

    return html
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

        await page.setContent(html, {
            waitUntil: "networkidle0",
        })

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
            const cells = Array.isArray(row) ? row : Object.values(row || {})
            return `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`
        })
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""

    return items.map((item) => `<li>${esc(item)}</li>`).join("")
}

function objectFromPairs(items) {
    const out = {}

    if (!Array.isArray(items)) return out

    items.forEach((item) => {
        if (Array.isArray(item)) {
            out[item[0]] = item[1]
        } else if (item?.label) {
            out[item.label] = item.value
        }
    })

    return out
}

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
}

function safeArray(value, fallback) {
    return Array.isArray(value) ? value : fallback
}

function getLanguageName(code) {
    const map = {
        ko: "Korean",
        en: "English",
        ja: "Japanese",
        zh: "Chinese",
    }

    return map[code] || "English"
}

function sanitizeFileName(value) {
    return String(value || "Report")
        .replace(/[\\/:*?"<>|]/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 60)
}

function getSampleReport() {
    return {
        cover: {
            brandName: "NomNomBox",
            decision: "HOLD",
            score: 61,
            subtitle: "Premium pet-food sample subscription for online dog owners",
            oneLineVerdict:
                "Demand is real, but the model must prove a narrow niche, repeat purchasing, and margin after shipping before scaling.",
        },
        decisionMatrix: [
            ["MARKET", "HIGH"],
            ["PROFITABILITY", "MEDIUM"],
            ["EXECUTION", "HIGH"],
            ["RISK", "HIGH"],
        ],
        executiveDecision: [
            [
                "Why this works",
                "Dog owners buy repeatedly, pet spending is resilient, and subscription behavior already exists in pet commerce.",
            ],
            [
                "Why this fails",
                "Generic sampling is easy to copy, shipping is margin-heavy, and repeat behavior weakens once the dog finds a preferred food.",
            ],
            [
                "What to do now",
                "Do not launch broadly. Validate one segment first with a 100-order paid pilot.",
            ],
        ],
        founderDecision:
            "NomNomBox deserves a controlled pilot, not a full launch. The business moves to GO only if customer acquisition payback and repeat purchase behavior pass the threshold section.",
        marketCards: [
            ["TAM", "~$128.7B"],
            ["SAM", "~$43.5B"],
            ["SOM", "500–2,000 subs"],
            ["GROWTH", "4–5%+"],
        ],
        tamSamSom: [
            [
                "TAM",
                "Global pet food market: ~$128.7B",
                "Global pet food category spend",
                "Large enough market, but too broad for entry strategy.",
            ],
            [
                "SAM",
                "U.S. online premium dog-food buyers",
                "U.S. market × online adoption × premium dog share",
                "Serviceable market is attractive if sharply positioned.",
            ],
            [
                "SOM",
                "500–2,000 subscribers",
                "Early pilot conversion × target channel reach",
                "Validation target, not domination.",
            ],
        ],
        marketInsight:
            "The market rewards trust, convenience, and measurable pet health confidence. A generic sample box is weak; a risk-reduction platform for picky or allergy-sensitive dogs is stronger.",
        customerTruth: [
            [
                "Food rejection",
                "Owners test brands and abandon bags their dog refuses.",
                "Sampling reduces waste and purchase anxiety.",
            ],
            [
                "Allergy concern",
                "Owners fear switching food without proof.",
                "Trust and guidance matter more than variety.",
            ],
            [
                "Review dependence",
                "Customers search reactions and ingredients.",
                "UGC becomes acquisition asset.",
            ],
        ],
        buyingTrigger:
            "The strongest trigger is not discovery. It is avoiding wasted money and avoiding the wrong food.",
        competitionMap: [
            [
                "Chewy Autoship",
                "Marketplace subscription",
                "Trust, logistics, recurring behavior",
                "Weak curation",
            ],
            [
                "Amazon Subscribe & Save",
                "Marketplace utility",
                "Convenience and price",
                "No pet-specific trust layer",
            ],
            [
                "The Farmer’s Dog",
                "Fresh food subscription",
                "Premium positioning",
                "High price",
            ],
            [
                "Ollie / Nom Nom",
                "Fresh food DTC",
                "Strong subscription model",
                "Churn pressure",
            ],
        ],
        competitionConclusion:
            "The open space is not subscription pet food. The open space is trial-before-commitment guidance for owners with a specific dog problem.",
        unitEconomicsCards: [
            ["CAC", "$35–$90"],
            ["LTV", "$120–$320"],
            ["AOV", "$25–$55"],
            ["REPEAT", "2.5x+"],
        ],
        unitEconomicsTable: [
            [
                "CAC",
                "$35–$90",
                "PASS below $45",
                "Sampling boxes are low-AOV; CAC must stay controlled.",
            ],
            [
                "Gross margin",
                "35%+",
                "PASS at 35%+",
                "Shipping can destroy contribution margin.",
            ],
            [
                "LTV",
                "$120–$320",
                "PASS above $180",
                "LTV must justify acquisition.",
            ],
            [
                "Repeat rate",
                "2.5x+",
                "PASS above 2.5x",
                "One-time testers do not support subscription economics.",
            ],
        ],
        economicsJudgment:
            "The model works only if sampling becomes a conversion engine into full-size products.",
        marketingStrategy: {
            channelFit: [
                [
                    "TikTok / Reels",
                    "HIGH",
                    "Demand creation",
                    "Pet reaction content is emotional and shareable.",
                ],
                [
                    "Instagram",
                    "HIGH",
                    "Trust building",
                    "Owner stories and testimonials work well.",
                ],
                [
                    "Search / SEO",
                    "MEDIUM",
                    "Intent capture",
                    "Useful for allergy and food comparison queries.",
                ],
                [
                    "Paid social",
                    "WATCH",
                    "Scale channel",
                    "Only after CAC and retention are proven.",
                ],
            ],
            contentPlaybook: [
                "Dog food reaction test: Will my picky dog eat it?",
                "Allergy-safe trial pack explanation",
                "Owner story: wasted money on rejected food",
                "Before/after feeding routine",
                "Full-size bag risk vs sample-first path",
            ],
            thirtyDayMarketingTest: [
                [
                    "Week 1–2",
                    "Create 20 short videos across 4 angles.",
                    "Find 2 hooks above baseline CTR.",
                ],
                [
                    "Week 3",
                    "Run $300–$500 micro paid test.",
                    "CAC estimate below target band.",
                ],
                [
                    "Week 4",
                    "Interview buyers and non-buyers.",
                    "Identify top objections and winning promise.",
                ],
            ],
        },
        businessModel: {
            revenueLayers: [
                ["Starter sample box", "$9–$19 trial", "Reduce first-purchase friction."],
                [
                    "Monthly discovery box",
                    "$19–$39/month",
                    "Recurring exploration revenue.",
                ],
                [
                    "Full-size conversion",
                    "Partner or private-label upsell",
                    "Create real LTV.",
                ],
            ],
            modelJudgment:
                "A sample-only subscription is fragile. The stronger model is a sample-to-full-size conversion platform.",
        },
        riskSystem: [
            [
                "Fulfillment cost crushes margin",
                "Severe",
                "Limit SKU complexity and batch shipping tests.",
            ],
            [
                "Weak repeat behavior",
                "High",
                "Create full-size conversion path.",
            ],
            [
                "Trust gap",
                "High",
                "Use ingredient transparency and clear allergy handling.",
            ],
        ],
        executionPlan: [
            [
                "0–30 days",
                "Build one niche offer, landing page, 100-order pre-sell test.",
                "Paid conversion rate + CAC estimate",
            ],
            [
                "30–60 days",
                "Fulfill pilot and measure repeat intent.",
                "Gross margin after shipping",
            ],
            [
                "60–90 days",
                "Scale only winning segment and content angle.",
                "CAC payback + retention",
            ],
        ],
        operatingRule:
            "Do not add more segments, SKUs, or channels until one customer segment proves repeat behavior.",
        goThreshold: [
            [
                "CAC payback",
                "Under 3 months",
                "Customer acquisition is financially scalable.",
            ],
            [
                "Gross margin after shipping",
                "35%+",
                "Operations can support marketing costs.",
            ],
            [
                "Repeat rate",
                "2.5x+ orders",
                "Sampling converts into ongoing value.",
            ],
            [
                "Refund / complaint rate",
                "Below 5%",
                "Product trust is not breaking.",
            ],
        ],
        finalRule:
            "GO only if at least three of four thresholds pass. HOLD if one or two fail. NO GO if CAC payback and repeat behavior both fail.",
        appendix: {
            dataSources: [
                ["U.S. pet industry spend", "APPA industry reporting", "Market scale benchmark"],
                [
                    "Global pet food market",
                    "Grand View Research pet food market report",
                    "Global TAM reference",
                ],
                [
                    "CAC / LTV ranges",
                    "DTC subscription benchmark assumptions",
                    "Economic stress test",
                ],
            ],
            assumptions: [
                "NomNomBox starts without existing brand equity.",
                "Initial launch focuses on one country and one niche segment.",
                "Financial ranges are directional and require validation with first-party test data.",
                "This report is a sample layout for product design and PDF conversion.",
            ],
        },
    }
}

app.listen(PORT, () => {
    console.log(`GoNoGo server running on port ${PORT}`)
})
