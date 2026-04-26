import express from "express"
import cors from "cors"
import OpenAI from "openai"
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
} from "docx"

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json({ limit: "2mb" }))

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
        version: "1.3.0-deep-report-layout",
    })
})

app.get("/api/health", (req, res) => {
    res.json({ ok: true, status: "healthy" })
})

app.post("/api/generate-report", async (req, res) => {
    try {
        const {
            brandName,
            productService,
            targetCustomer,
            language = "en",
            reportType = "free",
        } = req.body || {}

        if (!brandName || !productService || !targetCustomer) {
            return res.status(400).json({
                ok: false,
                error: "brandName, productService, targetCustomer are required.",
            })
        }

        const report =
            reportType === "deep"
                ? await generateDeepReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language,
                  })
                : await generateFreeReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language,
                  })

        const buffer =
            reportType === "deep"
                ? await buildDeepDocx(report, { brandName, language })
                : await buildFreeDocx(report, { brandName, language })

        const safeBrand = sanitizeFileName(brandName)
        const fileName =
            reportType === "deep"
                ? `GoNoGo_Deep_Report_${safeBrand}_${language}.docx`
                : `GoNoGo_Free_Report_${safeBrand}_${language}.docx`

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`)

        return res.send(buffer)
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
You are GoNoGo, a ruthless business strategy report engine.

You do not write generic advice.
You produce a paid business decision report.

Final report language: ${languageName}

Rules:
- Return only valid JSON.
- No markdown.
- No vague language.
- Every section must be judgment-driven.
- Use conservative estimates when exact data is unavailable.
- Use simple, readable business language.
- The report must help a founder decide whether to start, pause, or reject the business.
`

    const userPrompt = `
Create a DEEP PAID GoNoGo report.

Business Input:
Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

Return this exact JSON shape:

{
  "brandName": string,
  "decision": "GO" | "HOLD" | "NO GO",
  "score": number,
  "oneLineVerdict": string,

  "decisionMatrix": {
    "market": "LOW" | "MEDIUM" | "HIGH",
    "profitability": "LOW" | "MEDIUM" | "HIGH",
    "executionDifficulty": "LOW" | "MEDIUM" | "HIGH",
    "risk": "LOW" | "MEDIUM" | "HIGH"
  },

  "executiveDecision": {
    "whyItWorks": string,
    "whyItFails": string,
    "whatToDoNow": string
  },

  "marketReality": {
    "tam": string,
    "sam": string,
    "som": string,
    "growthRate": string,
    "marketInsight": string
  },

  "customerTruth": {
    "behaviors": string[],
    "buyingTrigger": string
  },

  "competitionMap": [
    {
      "competitor": string,
      "type": string,
      "strength": string,
      "weakness": string
    }
  ],

  "competitionConclusion": string,

  "unitEconomics": {
    "cac": string,
    "ltv": string,
    "aov": string,
    "repeatRate": string,
    "conclusion": string
  },

  "marketingStrategy": {
    "channelFit": [
      {
        "channel": string,
        "fit": "LOW" | "MEDIUM" | "HIGH",
        "reason": string
      }
    ],
    "contentStrategy": string[],
    "cacStrategy": {
      "earlyStage": string,
      "growthStage": string
    },
    "thirtyDayPlan": {
      "weekOneTwo": string[],
      "weekThreeFour": string[],
      "goal": string
    }
  },

  "businessModel": {
    "revenueSources": [
      {
        "source": string,
        "description": string
      }
    ],
    "pricingStructure": [
      {
        "plan": string,
        "price": string
      }
    ],
    "conclusion": string
  },

  "riskSystem": [
    {
      "risk": string,
      "impact": string,
      "solution": string
    }
  ],

  "executionPlan": {
    "days0to30": string[],
    "days30to60": string[],
    "days60to90": string[],
    "keyKpis": string[]
  },

  "goThreshold": [
    {
      "metric": string,
      "condition": string,
      "decision": "PASS" | "FAIL" | "WATCH"
    }
  ],

  "finalRule": string,

  "appendix": {
    "assumptions": string[],
    "sources": string[]
  }
}

Quality requirements:
- competitionMap must contain at least 4 competitors or alternatives.
- channelFit must contain at least 4 marketing channels.
- contentStrategy must contain at least 4 content ideas.
- riskSystem must contain at least 3 risks.
- goThreshold must contain at least 3 threshold metrics.
- Score must be 0 to 100.
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
    const { brandName, productService, targetCustomer, language } = input
    const languageName = getLanguageName(language)

    const systemPrompt = `
You are GoNoGo, a ruthless business decision analyst.
Final report language: ${languageName}
Return only valid JSON.
`

    const userPrompt = `
Create a FREE GoNoGo sample report.

Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

Return JSON:

{
  "brandName": string,
  "decision": "GO" | "HOLD" | "NO GO",
  "score": number,
  "oneLineVerdict": string,
  "whyItWorks": string,
  "whyItFails": string,
  "topRisks": string[],
  "firstAction": string,
  "upgradeHook": string
}
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

    return normalizeFreeReport(JSON.parse(raw), input)
}

function normalizeDeepReport(report, input) {
    return {
        brandName: report.brandName || input.brandName,
        decision: report.decision || "HOLD",
        score: Number.isFinite(report.score) ? report.score : 50,
        oneLineVerdict:
            report.oneLineVerdict ||
            "This business requires deeper validation before scaling.",

        decisionMatrix: report.decisionMatrix || {
            market: "MEDIUM",
            profitability: "MEDIUM",
            executionDifficulty: "MEDIUM",
            risk: "MEDIUM",
        },

        executiveDecision: report.executiveDecision || {},
        marketReality: report.marketReality || {},
        customerTruth: report.customerTruth || { behaviors: [], buyingTrigger: "" },
        competitionMap: Array.isArray(report.competitionMap)
            ? report.competitionMap
            : [],
        competitionConclusion: report.competitionConclusion || "",
        unitEconomics: report.unitEconomics || {},
        marketingStrategy: report.marketingStrategy || {
            channelFit: [],
            contentStrategy: [],
            cacStrategy: {},
            thirtyDayPlan: {},
        },
        businessModel: report.businessModel || {
            revenueSources: [],
            pricingStructure: [],
            conclusion: "",
        },
        riskSystem: Array.isArray(report.riskSystem) ? report.riskSystem : [],
        executionPlan: report.executionPlan || {
            days0to30: [],
            days30to60: [],
            days60to90: [],
            keyKpis: [],
        },
        goThreshold: Array.isArray(report.goThreshold) ? report.goThreshold : [],
        finalRule: report.finalRule || "",
        appendix: report.appendix || { assumptions: [], sources: [] },
    }
}

function normalizeFreeReport(report, input) {
    return {
        brandName: report.brandName || input.brandName,
        decision: report.decision || "HOLD",
        score: Number.isFinite(report.score) ? report.score : 50,
        oneLineVerdict:
            report.oneLineVerdict ||
            "This business requires validation before launch.",
        whyItWorks: report.whyItWorks || "",
        whyItFails: report.whyItFails || "",
        topRisks: Array.isArray(report.topRisks) ? report.topRisks : [],
        firstAction: report.firstAction || "",
        upgradeHook:
            report.upgradeHook ||
            "The deep report unlocks full market, marketing, unit economics, and execution strategy.",
    }
}

async function buildDeepDocx(report, meta) {
    const children = []

    // PAGE 1
    addTitle(children, "GONOGO™")
    addBigDecision(children, report.decision)
    addScore(children, `Score: ${report.score} / 100`)
    addTitle(children, report.brandName)
    addNormal(children, report.oneLineVerdict)

    addSpace(children)

    children.push(
        safeTable([
            ["Market", "Profitability", "Execution Difficulty", "Risk"],
            [
                report.decisionMatrix.market,
                report.decisionMatrix.profitability,
                report.decisionMatrix.executionDifficulty,
                report.decisionMatrix.risk,
            ],
        ])
    )

    addPageBreak(children)

    // PAGE 2
    addSection(children, "1. Executive Decision")
    children.push(
        safeTable([
            ["Why this works", report.executiveDecision.whyItWorks || ""],
            ["Why this fails", report.executiveDecision.whyItFails || ""],
            ["What to do now", report.executiveDecision.whatToDoNow || ""],
        ])
    )

    addPageBreak(children)

    // PAGE 3
    addSection(children, "2. Market Reality")
    children.push(
        safeTable([
            ["TAM", "SAM", "SOM", "Growth Rate"],
            [
                report.marketReality.tam || "",
                report.marketReality.sam || "",
                report.marketReality.som || "",
                report.marketReality.growthRate || "",
            ],
        ])
    )
    addSubSection(children, "Market Insight")
    addNormal(children, report.marketReality.marketInsight || "")

    addPageBreak(children)

    // PAGE 4
    addSection(children, "3. Customer Truth")
    addSubSection(children, "Customer Behaviors")
    ;(report.customerTruth.behaviors || []).forEach((item) =>
        addBullet(children, item)
    )
    addSubSection(children, "Buying Trigger")
    addNormal(children, report.customerTruth.buyingTrigger || "")

    addPageBreak(children)

    // PAGE 5
    addSection(children, "4. Competition Map")
    children.push(
        safeTable([
            ["Competitor", "Type", "Strength", "Weakness"],
            ...report.competitionMap.map((item) => [
                item.competitor || "",
                item.type || "",
                item.strength || "",
                item.weakness || "",
            ]),
        ])
    )
    addSubSection(children, "Conclusion")
    addNormal(children, report.competitionConclusion || "")

    addPageBreak(children)

    // PAGE 6
    addSection(children, "5. Unit Economics")
    children.push(
        safeTable([
            ["Metric", "Value"],
            ["CAC", report.unitEconomics.cac || ""],
            ["LTV", report.unitEconomics.ltv || ""],
            ["AOV", report.unitEconomics.aov || ""],
            ["Repeat Rate", report.unitEconomics.repeatRate || ""],
        ])
    )
    addSubSection(children, "Conclusion")
    addNormal(children, report.unitEconomics.conclusion || "")

    addPageBreak(children)

    // PAGE 7
    addSection(children, "6. Marketing Strategy")
    addSubSection(children, "Channel Fit Analysis")
    children.push(
        safeTable([
            ["Channel", "Fit", "Reason"],
            ...(report.marketingStrategy.channelFit || []).map((item) => [
                item.channel || "",
                item.fit || "",
                item.reason || "",
            ]),
        ])
    )

    addSubSection(children, "Content Strategy")
    ;(report.marketingStrategy.contentStrategy || []).forEach((item) =>
        addBullet(children, item)
    )

    addSubSection(children, "CAC Strategy")
    addNormal(
        children,
        `Early Stage: ${
            report.marketingStrategy.cacStrategy?.earlyStage || ""
        }`
    )
    addNormal(
        children,
        `Growth Stage: ${
            report.marketingStrategy.cacStrategy?.growthStage || ""
        }`
    )

    addSubSection(children, "30-Day Marketing Plan")
    addNormal(children, "Week 1–2")
    ;(report.marketingStrategy.thirtyDayPlan?.weekOneTwo || []).forEach((item) =>
        addBullet(children, item)
    )
    addNormal(children, "Week 3–4")
    ;(report.marketingStrategy.thirtyDayPlan?.weekThreeFour || []).forEach(
        (item) => addBullet(children, item)
    )
    addNormal(
        children,
        `Goal: ${report.marketingStrategy.thirtyDayPlan?.goal || ""}`
    )

    addPageBreak(children)

    // PAGE 8
    addSection(children, "7. Business Model")
    addSubSection(children, "Revenue Model")
    children.push(
        safeTable([
            ["Source", "Description"],
            ...(report.businessModel.revenueSources || []).map((item) => [
                item.source || "",
                item.description || "",
            ]),
        ])
    )

    addSubSection(children, "Pricing Structure")
    children.push(
        safeTable([
            ["Plan", "Price"],
            ...(report.businessModel.pricingStructure || []).map((item) => [
                item.plan || "",
                item.price || "",
            ]),
        ])
    )
    addSubSection(children, "Conclusion")
    addNormal(children, report.businessModel.conclusion || "")

    addPageBreak(children)

    // PAGE 9
    addSection(children, "8. Risk System")
    children.push(
        safeTable([
            ["Risk", "Impact", "Solution"],
            ...report.riskSystem.map((item) => [
                item.risk || "",
                item.impact || "",
                item.solution || "",
            ]),
        ])
    )

    addPageBreak(children)

    // PAGE 10
    addSection(children, "9. Execution Plan")
    addSubSection(children, "0–30 Days")
    ;(report.executionPlan.days0to30 || []).forEach((item) =>
        addBullet(children, item)
    )

    addSubSection(children, "30–60 Days")
    ;(report.executionPlan.days30to60 || []).forEach((item) =>
        addBullet(children, item)
    )

    addSubSection(children, "60–90 Days")
    ;(report.executionPlan.days60to90 || []).forEach((item) =>
        addBullet(children, item)
    )

    addSubSection(children, "Key KPIs")
    ;(report.executionPlan.keyKpis || []).forEach((item) =>
        addBullet(children, item)
    )

    addPageBreak(children)

    // PAGE 11
    addSection(children, "10. GO Threshold")
    children.push(
        safeTable([
            ["Metric", "Condition", "Decision"],
            ...report.goThreshold.map((item) => [
                item.metric || "",
                item.condition || "",
                item.decision || "",
            ]),
        ])
    )

    addSubSection(children, "Final Rule")
    addNormal(children, report.finalRule || "")

    addPageBreak(children)

    // APPENDIX
    addSection(children, "Appendix. Assumptions")
    ;(report.appendix.assumptions || []).forEach((item) =>
        addBullet(children, item)
    )

    addSection(children, "Appendix. Sources")
    ;(report.appendix.sources || []).forEach((item) =>
        addBullet(children, item)
    )

    const doc = new Document({
        creator: "GoNoGo",
        title: `GoNoGo Deep Report - ${report.brandName}`,
        description: report.oneLineVerdict,
        sections: [{ children }],
    })

    return await Packer.toBuffer(doc)
}

async function buildFreeDocx(report, meta) {
    const children = []

    addTitle(children, "GONOGO™")
    addBigDecision(children, report.decision)
    addScore(children, `Score: ${report.score} / 100`)
    addTitle(children, report.brandName)
    addNormal(children, report.oneLineVerdict)

    addSection(children, "1. Why This Works")
    addNormal(children, report.whyItWorks)

    addSection(children, "2. Why This Fails")
    addNormal(children, report.whyItFails)

    addSection(children, "3. Top Risks")
    ;(report.topRisks || []).forEach((item) => addBullet(children, item))

    addSection(children, "4. First Action")
    addNormal(children, report.firstAction)

    addSection(children, "5. Unlock Deep Report")
    addNormal(children, report.upgradeHook)

    const doc = new Document({
        creator: "GoNoGo",
        title: `GoNoGo Free Report - ${report.brandName}`,
        description: report.oneLineVerdict,
        sections: [{ children }],
    })

    return await Packer.toBuffer(doc)
}

function addTitle(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 32,
                }),
            ],
            spacing: { after: 240 },
        })
    )
}

function addBigDecision(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 58,
                }),
            ],
            spacing: { after: 160 },
        })
    )
}

function addScore(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 28,
                }),
            ],
            spacing: { after: 240 },
        })
    )
}

function addSection(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 28,
                }),
            ],
            spacing: { before: 420, after: 180 },
        })
    )
}

function addSubSection(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 23,
                }),
            ],
            spacing: { before: 260, after: 120 },
        })
    )
}

function addNormal(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    size: 22,
                }),
            ],
            spacing: { after: 160 },
        })
    )
}

function addBullet(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: `• ${String(text || "")}`,
                    size: 22,
                }),
            ],
            spacing: { after: 120 },
        })
    )
}

function addSpace(children) {
    children.push(
        new Paragraph({
            children: [new TextRun({ text: "", size: 12 })],
            spacing: { after: 260 },
        })
    )
}

function addPageBreak(children) {
    children.push(
        new Paragraph({
            children: [new TextRun({ text: "\n", break: 1 })],
            spacing: { after: 320 },
        })
    )
}

function safeTable(rows) {
    const safeRows = Array.isArray(rows) ? rows : []

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: safeRows.map((row) => {
            const cells = Array.isArray(row) ? row : [String(row || "")]
            return new TableRow({
                children: cells.map((cell) => {
                    return new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: String(cell || ""),
                                        size: 20,
                                    }),
                                ],
                            }),
                        ],
                    })
                }),
            })
        }),
    })
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

app.listen(PORT, () => {
    console.log(`GoNoGo server running on port ${PORT}`)
})
