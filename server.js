import express from "express"
import cors from "cors"
import OpenAI from "openai"
import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    AlignmentType,
    PageBreak,
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
        version: "1.1.0-free-report-upgrade",
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
            `attachment; filename="${encodeURIComponent(fileName)}"`
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
- This is a FREE SAMPLE REPORT, so it must be sharp, valuable, and conversion-oriented.
- Do not provide a full execution strategy.
- Do not provide full detailed financial modeling.
- Return only valid JSON.
`

    const userPrompt = `
Create a FREE GoNoGo sample report.

Business Input:
Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}

The report must follow this exact JSON shape:

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

Create a structured deep report.
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
        return await buildFreeDocx(report, meta)
    }

    return await buildDeepDocx(report, meta)
}

async function buildFreeDocx(report, meta) {
    const children = []

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: "GONOGO™",
                    bold: true,
                    size: 24,
                }),
            ],
            spacing: { after: 800 },
        })
    )

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: report.decision,
                    bold: true,
                    size: 72,
                }),
            ],
            spacing: { after: 200 },
        })
    )

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: `${report.score}/100`,
                    bold: true,
                    size: 34,
                }),
            ],
            spacing: { after: 500 },
        })
    )

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: report.title,
                    bold: true,
                    size: 30,
                }),
            ],
            spacing: { after: 200 },
        })
    )

    children.push(
        new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
                new TextRun({
                    text: report.oneLineVerdict,
                    size: 22,
                }),
            ],
            spacing: { after: 700 },
        })
    )

    children.push(
        createInfoTable([
            ["Report Type", "FREE SAMPLE"],
            ["Decision", report.decision],
            ["Score", `${report.score}/100`],
            ["Language", meta.language],
            ["Generated For", meta.brandName],
        ])
    )

    children.push(new Paragraph({ children: [new PageBreak()] }))

    addHeading(children, "1. Executive Kill Shot")

    children.push(
        createDataTable({
            headers: ["Question", "Judgment"],
            rows: [
                ["Why this works", report.killShot.whyItWorks],
                ["Why this fails", report.killShot.whyItFails],
                ["What to do now", report.killShot.whatToDoNow],
            ],
        })
    )

    addHeading(children, "2. Core Decision Logic")

    report.decisionReasons.forEach((reason, index) => {
        addBullet(children, `${index + 1}. ${reason}`)
    })

    addHeading(children, "3. Market Snapshot")

    children.push(
        createDataTable({
            headers: ["Item", "Judgment"],
            rows: [
                ["Estimated TAM", report.marketSnapshot.estimatedTAM],
                ["Entry Difficulty", report.marketSnapshot.entryDifficulty],
                ["Market Judgment", report.marketSnapshot.marketJudgment],
            ],
        })
    )

    addHeading(children, "4. Top 3 Risks")

    children.push(
        createDataTable({
            headers: ["Risk", "Impact", "Reason"],
            rows: report.topRisks.map((item) => [
                item.risk || "",
                item.impact || "",
                item.reason || "",
            ]),
        })
    )

    addHeading(children, "5. Unit Economics Estimate")

    children.push(
        createDataTable({
            headers: ["Metric", "Estimate"],
            rows: [
                ["Estimated CAC", report.unitEconomics.estimatedCAC],
                ["Estimated LTV", report.unitEconomics.estimatedLTV],
                ["Judgment", report.unitEconomics.judgment],
            ],
        })
    )

    addHeading(children, "6. First Action")

    children.push(
        new Paragraph({
            text: report.firstAction,
            spacing: { after: 300 },
        })
    )

    addHeading(children, "7. Unlock Deep Report")

    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: report.upgradeHook,
                    bold: true,
                }),
            ],
            spacing: { after: 500 },
        })
    )

    addHeading(children, "Appendix. Assumptions & Sources")

    addSubHeading(children, "Assumptions")
    report.appendix.assumptions.forEach((item) => addBullet(children, item))

    addSubHeading(children, "Sources")
    report.appendix.sources.forEach((item) => addBullet(children, item))

    const doc = new Document({
        creator: "GoNoGo",
        title: report.title,
        description: report.subtitle,
        sections: [{ properties: {}, children }],
    })

    return await Packer.toBuffer(doc)
}

async function buildDeepDocx(report, meta) {
    const children = []

    children.push(
        new Paragraph({
            children: [
                new TextRun({
                    text: "GONOGO™",
                    bold: true,
                    size: 24,
                }),
            ],
        })
    )

    children.push(
        new Paragraph({
            text: report.title,
            heading: HeadingLevel.TITLE,
            spacing: { before: 900, after: 300 },
        })
    )

    children.push(
        new Paragraph({
            children: [new TextRun({ text: report.subtitle, size: 24 })],
            spacing: { after: 500 },
        })
    )

    children.push(
        createInfoTable([
            ["Report Type", String(report.reportType).toUpperCase()],
            ["Decision", report.decision],
            ["Score", `${report.score}/100`],
            ["Language", meta.language],
            ["Generated For", meta.brandName],
        ])
    )

    children.push(new Paragraph({ children: [new PageBreak()] }))

    addHeading(children, "0. Executive Summary")

    report.summaryBullets.forEach((item) => addBullet(children, item))

    report.sections.forEach((section, index) => {
        addHeading(children, `${index + 1}. ${section.heading || "Untitled"}`)

        if (section.body) {
            children.push(
                new Paragraph({
                    text: section.body,
                    spacing: { after: 240 },
                })
            )
        }

        if (Array.isArray(section.bullets)) {
            section.bullets.forEach((bullet) => addBullet(children, bullet))
        }

        if (section.table && Array.isArray(section.table.rows)) {
            addSubHeading(children, section.table.title || "Analysis Table")
            children.push(createDataTable(section.table))
        }
    })

    addHeading(children, "Appendix. Assumptions & Sources")

    addSubHeading(children, "Assumptions")
    report.appendix.assumptions.forEach((item) => addBullet(children, item))

    addSubHeading(children, "Sources")
    report.appendix.sources.forEach((item) => addBullet(children, item))

    const doc = new Document({
        creator: "GoNoGo",
        title: report.title,
        description: report.subtitle,
        sections: [{ properties: {}, children }],
    })

    return await Packer.toBuffer(doc)
}

function addHeading(children, text) {
    children.push(
        new Paragraph({
            text,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 520, after: 240 },
        })
    )
}

function addSubHeading(children, text) {
    children.push(
        new Paragraph({
            text,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 160 },
        })
    )
}

function addBullet(children, text) {
    children.push(
        new Paragraph({
            text: `• ${text}`,
            spacing: { after: 120 },
        })
    )
}

function createInfoTable(rows) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(([label, value]) => {
            return new TableRow({
                children: [
                    new TableCell({
                        width: { size: 30, type: WidthType.PERCENTAGE },
                        shading: { fill: "F2F2F2" },
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: label,
                                        bold: true,
                                    }),
                                ],
                            }),
                        ],
                    }),
                    new TableCell({
                        width: { size: 70, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(String(value || ""))],
                    }),
                ],
            })
        }),
    })
}

function createDataTable(table) {
    const headers = Array.isArray(table.headers) ? table.headers : []
    const rows = Array.isArray(table.rows) ? table.rows : []

    const tableRows = []

    if (headers.length) {
        tableRows.push(
            new TableRow({
                children: headers.map((header) => {
                    return new TableCell({
                        shading: { fill: "EDEDED" },
                        children: [
                            new Paragraph({
                                children: [
                                    new TextRun({
                                        text: String(header),
                                        bold: true,
                                    }),
                                ],
                            }),
                        ],
                    })
                }),
            })
        )
    }

    rows.forEach((row) => {
        tableRows.push(
            new TableRow({
                children: row.map((cell) => {
                    return new TableCell({
                        children: [new Paragraph(String(cell || ""))],
                    })
                }),
            })
        )
    })

    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
            left: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
            right: { style: BorderStyle.SINGLE, size: 1, color: "D9D9D9" },
            insideHorizontal: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: "D9D9D9",
            },
            insideVertical: {
                style: BorderStyle.SINGLE,
                size: 1,
                color: "D9D9D9",
            },
        },
        rows: tableRows,
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
