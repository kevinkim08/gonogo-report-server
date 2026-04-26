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
        version: "1.2.0-safe-docx",
    })
})

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        status: "healthy",
    })
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
                      reportType,
                  })
                : await generateFreeReportJson({
                      brandName,
                      productService,
                      targetCustomer,
                      language,
                      reportType: "free",
                  })

        const buffer = await buildDocx(report, {
            brandName,
            language,
            reportType,
        })

        const safeBrand = sanitizeFileName(brandName)
        const fileName =
            reportType === "deep"
                ? `GoNoGo_Deep_Report_${safeBrand}_${language}.docx`
                : `GoNoGo_Free_Report_${safeBrand}_${language}.docx`

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        )

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

async function generateFreeReportJson(input) {
    const { brandName, productService, targetCustomer, language } = input
    const languageName = getLanguageName(language)

    const systemPrompt = `
You are GoNoGo, a ruthless business decision analyst.

Your job is NOT to explain.
Your job is to decide whether this business should GO, HOLD, or NO GO.

Rules:
- Final report language: ${languageName}
- No vague language.
- Avoid "might", "could", "possibly", "seems".
- Every sentence must be judgment-based.
- Use conservative estimates where exact data is unavailable.
- This is a FREE SAMPLE REPORT.
- It must be sharp, valuable, and conversion-oriented.
- Do not provide full execution strategy.
- Do not provide full detailed financial modeling.
- Return only valid JSON.
`

    const userPrompt = `
Create a FREE GoNoGo sample report.

Business Input:
Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

Return this exact JSON shape:

{
  "title": string,
  "subtitle": string,
  "reportType": "free",
  "language": string,
  "decision": "GO" | "HOLD" | "NO GO",
  "score": number,
  "oneLineVerdict": string,
  "killShot": {
    "whyItWorks": string,
    "whyItFails": string,
    "whatToDoNow": string
  },
  "decisionReasons": string[],
  "marketSnapshot": {
    "estimatedTAM": string,
    "entryDifficulty": "LOW" | "MEDIUM" | "HIGH",
    "marketJudgment": string
  },
  "topRisks": [
    {
      "risk": string,
      "impact": string,
      "reason": string
    }
  ],
  "unitEconomics": {
    "estimatedCAC": string,
    "estimatedLTV": string,
    "judgment": string
  },
  "firstAction": string,
  "upgradeHook": string,
  "appendix": {
    "assumptions": string[],
    "sources": string[]
  }
}

Quality rules:
- Score must be between 0 and 100.
- topRisks must contain exactly 3 risks.
- decisionReasons must contain exactly 3 reasons.
- estimatedTAM must include a rough number or range.
- estimatedCAC and estimatedLTV must include rough estimates.
- upgradeHook must clearly explain what the paid deep report unlocks.
`

    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
    })

    const raw = completion.choices?.[0]?.message?.content
    if (!raw) throw new Error("Empty OpenAI response.")

    const parsed = JSON.parse(raw)
    return normalizeFreeReport(parsed, input)
}

async function generateDeepReportJson(input) {
    const { brandName, productService, targetCustomer, language } = input
    const languageName = getLanguageName(language)

    const systemPrompt = `
You are GoNoGo, a business strategy consultant.
Final report language: ${languageName}.
Return only valid JSON.
`

    const userPrompt = `
Create a DEEP GoNoGo business report.

Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

Return JSON:

{
  "title": string,
  "subtitle": string,
  "reportType": "deep",
  "language": string,
  "decision": "GO" | "HOLD" | "NO GO",
  "score": number,
  "summaryBullets": string[],
  "sections": [
    {
      "heading": string,
      "body": string,
      "bullets": string[],
      "table": {
        "title": string,
        "headers": string[],
        "rows": string[][]
      } | null
    }
  ],
  "appendix": {
    "assumptions": string[],
    "sources": string[]
  }
}
`

    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
    })

    const raw = completion.choices?.[0]?.message?.content
    if (!raw) throw new Error("Empty OpenAI response.")

    const parsed = JSON.parse(raw)
    return normalizeDeepReport(parsed, input)
}

function normalizeFreeReport(report, input) {
    return {
        title: report.title || `GoNoGo Free Report: ${input.brandName}`,
        subtitle:
            report.subtitle ||
            "A fast decision report designed to test whether this business deserves deeper analysis.",
        reportType: "free",
        language: report.language || input.language,
        decision: report.decision || "HOLD",
        score: Number.isFinite(report.score) ? report.score : 50,
        oneLineVerdict:
            report.oneLineVerdict ||
            "This business requires validation before serious launch investment.",
        killShot: {
            whyItWorks: report?.killShot?.whyItWorks || "",
            whyItFails: report?.killShot?.whyItFails || "",
            whatToDoNow: report?.killShot?.whatToDoNow || "",
        },
        decisionReasons: Array.isArray(report.decisionReasons)
            ? report.decisionReasons.slice(0, 3)
            : [],
        marketSnapshot: {
            estimatedTAM: report?.marketSnapshot?.estimatedTAM || "Unknown",
            entryDifficulty:
                report?.marketSnapshot?.entryDifficulty || "MEDIUM",
            marketJudgment: report?.marketSnapshot?.marketJudgment || "",
        },
        topRisks: Array.isArray(report.topRisks)
            ? report.topRisks.slice(0, 3)
            : [],
        unitEconomics: {
            estimatedCAC: report?.unitEconomics?.estimatedCAC || "Unknown",
            estimatedLTV: report?.unitEconomics?.estimatedLTV || "Unknown",
            judgment: report?.unitEconomics?.judgment || "",
        },
        firstAction: report.firstAction || "",
        upgradeHook:
            report.upgradeHook ||
            "The paid deep report unlocks full market sizing, CAC/LTV modeling, competitor analysis, and execution roadmap.",
        appendix: {
            assumptions: Array.isArray(report?.appendix?.assumptions)
                ? report.appendix.assumptions
                : ["Generated from user-provided business input."],
            sources: Array.isArray(report?.appendix?.sources)
                ? report.appendix.sources
                : [
                      "User input assumption.",
                      "Public market data required for full paid analysis.",
                  ],
        },
    }
}

function normalizeDeepReport(report, input) {
    return {
        title: report.title || `GoNoGo Deep Report: ${input.brandName}`,
        subtitle:
            report.subtitle ||
            "A structured business decision report generated by GoNoGo.",
        reportType: "deep",
        language: report.language || input.language,
        decision: report.decision || "HOLD",
        score: Number.isFinite(report.score) ? report.score : 50,
        summaryBullets: Array.isArray(report.summaryBullets)
            ? report.summaryBullets
            : [],
        sections: Array.isArray(report.sections) ? report.sections : [],
        appendix: {
            assumptions: Array.isArray(report?.appendix?.assumptions)
                ? report.appendix.assumptions
                : ["Generated from user-provided business input."],
            sources: Array.isArray(report?.appendix?.sources)
                ? report.appendix.sources
                : ["User input assumption."],
        },
    }
}

async function buildDocx(report, meta) {
    if (report.reportType === "free") {
        return await buildSafeFreeDocx(report, meta)
    }

    return await buildSafeDeepDocx(report, meta)
}

async function buildSafeFreeDocx(report, meta) {
    const children = []

    addTitle(children, "GONOGO™")
    addBigDecision(children, report.decision)
    addScore(children, `${report.score}/100`)
    addTitle(children, report.title)
    addNormal(children, report.oneLineVerdict)

    addSpacer(children)

    children.push(
        safeTable([
            ["Report Type", "FREE SAMPLE"],
            ["Decision", report.decision],
            ["Score", `${report.score}/100`],
            ["Language", meta.language],
            ["Generated For", meta.brandName],
        ])
    )

    addSection(children, "1. Executive Kill Shot")

    children.push(
        safeTable([
            ["Why this works", report.killShot.whyItWorks],
            ["Why this fails", report.killShot.whyItFails],
            ["What to do now", report.killShot.whatToDoNow],
        ])
    )

    addSection(children, "2. Core Decision Logic")
    report.decisionReasons.forEach((item, index) => {
        addBullet(children, `${index + 1}. ${item}`)
    })

    addSection(children, "3. Market Snapshot")
    children.push(
        safeTable([
            ["Estimated TAM", report.marketSnapshot.estimatedTAM],
            ["Entry Difficulty", report.marketSnapshot.entryDifficulty],
            ["Market Judgment", report.marketSnapshot.marketJudgment],
        ])
    )

    addSection(children, "4. Top 3 Risks")
    report.topRisks.forEach((item, index) => {
        addSubSection(children, `Risk ${index + 1}: ${item.risk || ""}`)
        addNormal(children, `Impact: ${item.impact || ""}`)
        addNormal(children, `Reason: ${item.reason || ""}`)
    })

    addSection(children, "5. Unit Economics Estimate")
    children.push(
        safeTable([
            ["Estimated CAC", report.unitEconomics.estimatedCAC],
            ["Estimated LTV", report.unitEconomics.estimatedLTV],
            ["Judgment", report.unitEconomics.judgment],
        ])
    )

    addSection(children, "6. First Action")
    addNormal(children, report.firstAction)

    addSection(children, "7. Unlock Deep Report")
    addNormal(children, report.upgradeHook)

    addSection(children, "Appendix. Assumptions")
    report.appendix.assumptions.forEach((item) => addBullet(children, item))

    addSection(children, "Appendix. Sources")
    report.appendix.sources.forEach((item) => addBullet(children, item))

    const doc = new Document({
        creator: "GoNoGo",
        title: report.title,
        description: report.subtitle,
        sections: [
            {
                children,
            },
        ],
    })

    return await Packer.toBuffer(doc)
}

async function buildSafeDeepDocx(report, meta) {
    const children = []

    addTitle(children, "GONOGO™")
    addTitle(children, report.title)
    addNormal(children, report.subtitle)

    children.push(
        safeTable([
            ["Report Type", "DEEP REPORT"],
            ["Decision", report.decision],
            ["Score", `${report.score}/100`],
            ["Language", meta.language],
            ["Generated For", meta.brandName],
        ])
    )

    addSection(children, "0. Executive Summary")
    report.summaryBullets.forEach((item) => addBullet(children, item))

    report.sections.forEach((section, index) => {
        addSection(children, `${index + 1}. ${section.heading || "Untitled"}`)

        if (section.body) addNormal(children, section.body)

        if (Array.isArray(section.bullets)) {
            section.bullets.forEach((bullet) => addBullet(children, bullet))
        }

        if (section.table && Array.isArray(section.table.rows)) {
            addSubSection(children, section.table.title || "Analysis Table")
            children.push(
                safeTable([
                    section.table.headers || [],
                    ...section.table.rows,
                ])
            )
        }
    })

    addSection(children, "Appendix. Assumptions")
    report.appendix.assumptions.forEach((item) => addBullet(children, item))

    addSection(children, "Appendix. Sources")
    report.appendix.sources.forEach((item) => addBullet(children, item))

    const doc = new Document({
        creator: "GoNoGo",
        title: report.title,
        description: report.subtitle,
        sections: [
            {
                children,
            },
        ],
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
                    size: 56,
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
                    size: 26,
                }),
            ],
            spacing: { before: 360, after: 180 },
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
                    size: 22,
                }),
            ],
            spacing: { before: 220, after: 120 },
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
            spacing: { after: 180 },
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

function addSpacer(children) {
    children.push(
        new Paragraph({
            children: [new TextRun({ text: "", size: 12 })],
            spacing: { after: 260 },
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
