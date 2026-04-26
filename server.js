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
        version: "1.4.0-template-layout",
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
                ? await buildDeepDocx(report)
                : await buildFreeDocx(report)

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
You are GoNoGo, a paid business decision report engine.

You do not write generic advice.
You create structured founder decision reports.

Final report language: ${languageName}

Rules:
- Return only valid JSON.
- No markdown.
- Use short judgment blocks.
- Do not put long paragraphs inside wide tables.
- Use conservative estimates when exact data is unavailable.
- Always include marketing strategy.
- Always include threshold metrics.
- Every section must help a founder decide GO, HOLD, or NO GO.
`

    const userPrompt = `
Create a DEEP PAID GoNoGo report.

Business Input:
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
    { "label": "MARKET", "value": "LOW" | "MEDIUM" | "HIGH" },
    { "label": "PROFITABILITY", "value": "LOW" | "MEDIUM" | "HIGH" },
    { "label": "EXECUTION", "value": "LOW" | "MEDIUM" | "HIGH" },
    { "label": "RISK", "value": "LOW" | "MEDIUM" | "HIGH" }
  ],

  "reportPromise": string,

  "executiveDecision": [
    { "question": "Why this works", "judgment": string },
    { "question": "Why this fails", "judgment": string },
    { "question": "What to do now", "judgment": string }
  ],

  "founderDecision": string,

  "marketCards": [
    { "label": string, "value": string },
    { "label": string, "value": string },
    { "label": string, "value": string },
    { "label": string, "value": string }
  ],

  "tamSamSom": [
    {
      "layer": "TAM",
      "estimate": string,
      "formula": string,
      "interpretation": string
    },
    {
      "layer": "SAM",
      "estimate": string,
      "formula": string,
      "interpretation": string
    },
    {
      "layer": "SOM",
      "estimate": string,
      "formula": string,
      "interpretation": string
    }
  ],

  "marketInsight": string,

  "customerTruth": [
    {
      "problem": string,
      "behaviorEvidence": string,
      "businessMeaning": string
    }
  ],

  "buyingTrigger": string,

  "competitionMap": [
    {
      "competitor": string,
      "type": string,
      "strength": string,
      "weakness": string
    }
  ],

  "competitionConclusion": string,

  "unitEconomicsCards": [
    { "label": "CAC", "value": string },
    { "label": "LTV", "value": string },
    { "label": "AOV", "value": string },
    { "label": "PAYBACK", "value": string }
  ],

  "unitEconomicsTable": [
    {
      "metric": string,
      "targetRange": string,
      "passFailRule": string,
      "reason": string
    }
  ],

  "economicsJudgment": string,

  "marketingStrategy": {
    "channelFit": [
      {
        "channel": string,
        "fit": "LOW" | "MEDIUM" | "HIGH" | "WATCH",
        "role": string,
        "why": string
      }
    ],
    "contentPlaybook": string[],
    "thirtyDayMarketingTest": [
      {
        "period": string,
        "action": string,
        "successMetric": string
      }
    ]
  },

  "businessModel": {
    "revenueLayers": [
      {
        "layer": string,
        "example": string,
        "purpose": string
      }
    ],
    "modelJudgment": string
  },

  "riskSystem": [
    {
      "risk": string,
      "impact": string,
      "countermeasure": string
    }
  ],

  "executionPlan": [
    {
      "phase": string,
      "actions": string,
      "primaryKpi": string
    }
  ],

  "operatingRule": string,

  "goThreshold": [
    {
      "metric": string,
      "passCondition": string,
      "decisionMeaning": string
    }
  ],

  "finalRule": string,

  "appendix": {
    "dataSources": [
      {
        "dataPoint": string,
        "sourceBasis": string,
        "usage": string
      }
    ],
    "assumptions": string[]
  }
}

Quality requirements:
- competitionMap must contain 4 to 6 competitors or alternatives.
- marketingStrategy.channelFit must contain 4 to 6 channels.
- contentPlaybook must contain 5 items.
- thirtyDayMarketingTest must contain 3 periods.
- riskSystem must contain 3 to 5 risks.
- goThreshold must contain 4 to 5 metrics.
- Keep each table cell concise.
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
You are GoNoGo, a business decision analyst.
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
    const cover = report.cover || {}

    return {
        cover: {
            brandName: cover.brandName || input.brandName,
            decision: cover.decision || "HOLD",
            score: Number.isFinite(cover.score) ? cover.score : 50,
            subtitle: cover.subtitle || input.productService,
            oneLineVerdict:
                cover.oneLineVerdict ||
                "This business requires validation before scaling.",
        },
        decisionMatrix: safeArray(report.decisionMatrix, [
            { label: "MARKET", value: "MEDIUM" },
            { label: "PROFITABILITY", value: "MEDIUM" },
            { label: "EXECUTION", value: "MEDIUM" },
            { label: "RISK", value: "MEDIUM" },
        ]),
        reportPromise:
            report.reportPromise ||
            "This report shows decision first, data second, and execution third.",
        executiveDecision: safeArray(report.executiveDecision, []),
        founderDecision: report.founderDecision || "",
        marketCards: safeArray(report.marketCards, []),
        tamSamSom: safeArray(report.tamSamSom, []),
        marketInsight: report.marketInsight || "",
        customerTruth: safeArray(report.customerTruth, []),
        buyingTrigger: report.buyingTrigger || "",
        competitionMap: safeArray(report.competitionMap, []),
        competitionConclusion: report.competitionConclusion || "",
        unitEconomicsCards: safeArray(report.unitEconomicsCards, []),
        unitEconomicsTable: safeArray(report.unitEconomicsTable, []),
        economicsJudgment: report.economicsJudgment || "",
        marketingStrategy: report.marketingStrategy || {
            channelFit: [],
            contentPlaybook: [],
            thirtyDayMarketingTest: [],
        },
        businessModel: report.businessModel || {
            revenueLayers: [],
            modelJudgment: "",
        },
        riskSystem: safeArray(report.riskSystem, []),
        executionPlan: safeArray(report.executionPlan, []),
        operatingRule: report.operatingRule || "",
        goThreshold: safeArray(report.goThreshold, []),
        finalRule: report.finalRule || "",
        appendix: report.appendix || {
            dataSources: [],
            assumptions: [],
        },
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
        topRisks: safeArray(report.topRisks, []),
        firstAction: report.firstAction || "",
        upgradeHook:
            report.upgradeHook ||
            "The deep report unlocks full market, marketing, unit economics, and execution strategy.",
    }
}

async function buildDeepDocx(report) {
    const children = []

    addBrand(children)
    addDecision(children, report.cover.decision)
    addScore(children, `Score: ${report.cover.score} / 100`)
    addTitle(children, `${report.cover.brandName} Deep Business Decision Report`)
    addNormal(children, report.cover.subtitle)

    children.push(
        twoColumnCards(
            report.decisionMatrix.map((item) => [
                item.label || "",
                item.value || "",
            ])
        )
    )

    addNormal(children, `One-line verdict: ${report.cover.oneLineVerdict}`)
    addSection(children, "Report Promise")
    addNormal(children, report.reportPromise)

    addDivider(children)

    addSection(children, "REPORT MAP")
    addSubTitle(children, "Table of Contents")
    ;[
        "1. Executive Decision",
        "2. Market Reality",
        "3. Customer Truth",
        "4. Competition Map",
        "5. Unit Economics",
        "6. Marketing Strategy",
        "7. Business Model",
        "8. Risk System",
        "9. Execution Plan",
        "10. GO Threshold",
        "11. Appendix",
    ].forEach((item) => addBullet(children, item))

    addNormal(
        children,
        "Design note: Each section uses compact tables, short judgment blocks, and clear thresholds. Long paragraphs are intentionally avoided."
    )

    addDivider(children)

    addPageLabel(children, "PAGE 1")
    addSection(children, "1. Executive Decision")
    children.push(
        basicTable([
            ["Question", "Judgment"],
            ...report.executiveDecision.map((item) => [
                item.question || "",
                item.judgment || "",
            ]),
        ])
    )
    addSubTitle(children, "Founder Decision")
    addNormal(children, report.founderDecision)

    addDivider(children)

    addPageLabel(children, "PAGE 2")
    addSection(children, "2. Market Reality")
    children.push(
        twoColumnCards(
            report.marketCards.map((item) => [
                item.label || "",
                item.value || "",
            ])
        )
    )

    addSubTitle(children, "TAM / SAM / SOM")
    children.push(
        basicTable([
            ["Layer", "Estimate", "Formula / Logic", "Interpretation"],
            ...report.tamSamSom.map((item) => [
                item.layer || "",
                item.estimate || "",
                item.formula || "",
                item.interpretation || "",
            ]),
        ])
    )
    addSubTitle(children, "Market Insight")
    addNormal(children, report.marketInsight)

    addDivider(children)

    addPageLabel(children, "PAGE 3")
    addSection(children, "3. Customer Truth")
    children.push(
        basicTable([
            ["Customer Problem", "Behavior Evidence", "Business Meaning"],
            ...report.customerTruth.map((item) => [
                item.problem || "",
                item.behaviorEvidence || "",
                item.businessMeaning || "",
            ]),
        ])
    )
    addSubTitle(children, "Buying Trigger")
    addNormal(children, report.buyingTrigger)

    addDivider(children)

    addPageLabel(children, "PAGE 4")
    addSection(children, "4. Competition Map")
    children.push(
        basicTable([
            ["Competitor / Alternative", "Type", "Strength", "Weakness"],
            ...report.competitionMap.map((item) => [
                item.competitor || "",
                item.type || "",
                item.strength || "",
                item.weakness || "",
            ]),
        ])
    )
    addSubTitle(children, "Competitive Conclusion")
    addNormal(children, report.competitionConclusion)

    addDivider(children)

    addPageLabel(children, "PAGE 5")
    addSection(children, "5. Unit Economics")
    children.push(
        twoColumnCards(
            report.unitEconomicsCards.map((item) => [
                item.label || "",
                item.value || "",
            ])
        )
    )
    children.push(
        basicTable([
            ["Metric", "Target Range", "Pass / Fail Rule", "Reason"],
            ...report.unitEconomicsTable.map((item) => [
                item.metric || "",
                item.targetRange || "",
                item.passFailRule || "",
                item.reason || "",
            ]),
        ])
    )
    addSubTitle(children, "Economics Judgment")
    addNormal(children, report.economicsJudgment)

    addDivider(children)

    addPageLabel(children, "PAGE 6")
    addSection(children, "6. Marketing Strategy")
    addSubTitle(children, "Channel Fit Analysis")
    children.push(
        basicTable([
            ["Channel", "Fit", "Role", "Why"],
            ...(report.marketingStrategy.channelFit || []).map((item) => [
                item.channel || "",
                item.fit || "",
                item.role || "",
                item.why || "",
            ]),
        ])
    )

    addSubTitle(children, "Content Playbook")
    ;(report.marketingStrategy.contentPlaybook || []).forEach((item) =>
        addBullet(children, item)
    )

    addSubTitle(children, "30-Day Marketing Test")
    children.push(
        basicTable([
            ["Period", "Action", "Success Metric"],
            ...(report.marketingStrategy.thirtyDayMarketingTest || []).map(
                (item) => [
                    item.period || "",
                    item.action || "",
                    item.successMetric || "",
                ]
            ),
        ])
    )

    addDivider(children)

    addPageLabel(children, "PAGE 7")
    addSection(children, "7. Business Model")
    children.push(
        basicTable([
            ["Revenue Layer", "Example", "Purpose"],
            ...(report.businessModel.revenueLayers || []).map((item) => [
                item.layer || "",
                item.example || "",
                item.purpose || "",
            ]),
        ])
    )
    addSubTitle(children, "Model Judgment")
    addNormal(children, report.businessModel.modelJudgment)

    addDivider(children)

    addPageLabel(children, "PAGE 8")
    addSection(children, "8. Risk System")
    children.push(
        basicTable([
            ["Risk", "Impact", "Countermeasure"],
            ...report.riskSystem.map((item) => [
                item.risk || "",
                item.impact || "",
                item.countermeasure || "",
            ]),
        ])
    )

    addDivider(children)

    addPageLabel(children, "PAGE 9")
    addSection(children, "9. Execution Plan")
    children.push(
        basicTable([
            ["Phase", "Actions", "Primary KPI"],
            ...report.executionPlan.map((item) => [
                item.phase || "",
                item.actions || "",
                item.primaryKpi || "",
            ]),
        ])
    )
    addSubTitle(children, "Operating Rule")
    addNormal(children, report.operatingRule)

    addDivider(children)

    addPageLabel(children, "PAGE 10")
    addSection(children, "10. GO Threshold")
    children.push(
        basicTable([
            ["Metric", "Pass Condition", "Decision Meaning"],
            ...report.goThreshold.map((item) => [
                item.metric || "",
                item.passCondition || "",
                item.decisionMeaning || "",
            ]),
        ])
    )
    addSubTitle(children, "Final Rule")
    addNormal(children, report.finalRule)

    addDivider(children)

    addSection(children, "APPENDIX")
    addSubTitle(children, "Appendix: Data Sources & Assumptions")
    children.push(
        basicTable([
            ["Data Point", "Source / Basis", "Usage"],
            ...(report.appendix.dataSources || []).map((item) => [
                item.dataPoint || "",
                item.sourceBasis || "",
                item.usage || "",
            ]),
        ])
    )

    addSubTitle(children, "Assumptions")
    ;(report.appendix.assumptions || []).forEach((item) =>
        addBullet(children, item)
    )

    addFooter(children)

    const doc = new Document({
        creator: "GoNoGo",
        title: `GoNoGo Deep Report - ${report.cover.brandName}`,
        description: report.cover.oneLineVerdict,
        sections: [{ children }],
    })

    return await Packer.toBuffer(doc)
}

async function buildFreeDocx(report) {
    const children = []

    addBrand(children)
    addDecision(children, report.decision)
    addScore(children, `Score: ${report.score} / 100`)
    addTitle(children, `${report.brandName} Free Decision Report`)
    addNormal(children, report.oneLineVerdict)

    addDivider(children)

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

    addFooter(children)

    const doc = new Document({
        creator: "GoNoGo",
        title: `GoNoGo Free Report - ${report.brandName}`,
        description: report.oneLineVerdict,
        sections: [{ children }],
    })

    return await Packer.toBuffer(doc)
}

function addBrand(children) {
    children.push(
        new Paragraph({
            children: [new TextRun({ text: "GONOGO™", bold: true, size: 28 })],
            spacing: { after: 220 },
        })
    )
}

function addDecision(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 64,
                }),
            ],
            spacing: { after: 120 },
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

function addTitle(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 30,
                }),
            ],
            spacing: { after: 160 },
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
                    size: 26,
                }),
            ],
            spacing: { before: 360, after: 160 },
        })
    )
}

function addSubTitle(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 22,
                }),
            ],
            spacing: { before: 220, after: 120 },
        })
    )
}

function addPageLabel(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    bold: true,
                    size: 18,
                }),
            ],
            spacing: { before: 260, after: 80 },
        })
    )
}

function addNormal(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: String(text || ""),
                    size: 21,
                }),
            ],
            spacing: { after: 140 },
        })
    )
}

function addBullet(children, text) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: `• ${String(text || "")}`,
                    size: 21,
                }),
            ],
            spacing: { after: 90 },
        })
    )
}

function addDivider(children) {
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: "────────────────────────────────────────",
                    size: 14,
                }),
            ],
            spacing: { before: 220, after: 220 },
        })
    )
}

function addFooter(children) {
    addDivider(children)
    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: "GoNoGo™ Business Decision Report",
                    size: 18,
                }),
            ],
        })
    )
}

function basicTable(rows) {
    const safeRows = Array.isArray(rows) ? rows : []

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: safeRows.map((row, rowIndex) => {
            const cells = Array.isArray(row) ? row : [String(row || "")]
            return new TableRow({
                children: cells.map((cell) => {
                    return new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: String(cell || ""),
                                        bold: rowIndex === 0,
                                        size: rowIndex === 0 ? 19 : 18,
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

function twoColumnCards(items) {
    const rows = []

    for (let i = 0; i < items.length; i += 2) {
        const left = items[i] || ["", ""]
        const right = items[i + 1] || ["", ""]

        rows.push([
            `${left[0]}\n${left[1]}`,
            `${right[0]}\n${right[1]}`,
        ])
    }

    return basicTable(rows)
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

app.listen(PORT, () => {
    console.log(`GoNoGo server running on port ${PORT}`)
})
