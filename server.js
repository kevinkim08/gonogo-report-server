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

app.use(express.json({ limit: "2mb" }))

app.use(
    cors({
        origin: [
            "https://big-evidence-039433.framer.app",
            "https://*.framer.app",
            "https://*.framer.website",
            "http://localhost:3000",
            "http://localhost:5173",
        ],
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type"],
    })
)

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

const PORT = process.env.PORT || 3000

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "GoNoGo Report Server",
        version: "1.0.0",
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

        const report = await generateReportJson({
            brandName,
            productService,
            targetCustomer,
            language,
            reportType,
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

async function generateReportJson(input) {
    const { brandName, productService, targetCustomer, language, reportType } =
        input

    const languageName = getLanguageName(language)
    const isDeep = reportType === "deep"

    const systemPrompt = `
You are GoNoGo, a business decision report engine.

Your role:
- Evaluate whether a business idea should move forward.
- Write in a direct, judgment-driven consulting style.
- Do not use vague language such as "might", "could", "seems", or "possibly" unless clearly marked as an assumption.
- The final answer must be written in ${languageName}.
- Return only valid JSON.
`

    const userPrompt = `
Create a ${isDeep ? "deep paid" : "free sample"} GoNoGo business report.

Input:
Brand Name: ${brandName}
Product / Service: ${productService}
Target Customer: ${targetCustomer}
Language: ${languageName}

Report Type Rules:
${
    isDeep
        ? `
DEEP REPORT:
- Must include detailed market judgment.
- Must include TAM / SAM / SOM.
- Must include CAC, LTV, conversion rate, AOV, repeat purchase rate, and BEP.
- Must include execution roadmap.
- Must include risk response.
- Must be useful enough for a founder to make a business decision.
`
        : `
FREE REPORT:
- Must be short but valuable.
- Must create curiosity for the deep report.
- Include only high-level judgment.
- Do not include full CAC/LTV/BEP calculations.
- Do not include full execution strategy.
`
}

Required JSON shape:
{
  "title": string,
  "subtitle": string,
  "reportType": "free" | "deep",
  "language": string,
  "decision": "GO" | "NO-GO" | "HOLD",
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

Section rules:
- Free report: 5 sections.
- Deep report: 10 sections.
- Every table row must contain plain text only.
- Sources may be listed as "Public market data required / User input assumption" if live browsing is not available.
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

    if (!raw) {
        throw new Error("Empty OpenAI response.")
    }

    const parsed = JSON.parse(raw)

    return normalizeReport(parsed, input)
}

function normalizeReport(report, input) {
    const fallbackTitle =
        input.reportType === "deep"
            ? `GoNoGo Deep Report: ${input.brandName}`
            : `GoNoGo Free Report: ${input.brandName}`

    return {
        title: report.title || fallbackTitle,
        subtitle:
            report.subtitle ||
            "A structured business decision report generated by GoNoGo.",
        reportType: report.reportType || input.reportType,
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
            children: [
                new TextRun({
                    text: report.subtitle,
                    size: 24,
                }),
            ],
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

    children.push(
        new Paragraph({
            text: "0. Executive Summary",
            heading: HeadingLevel.HEADING_1,
        })
    )

    if (report.summaryBullets.length) {
        report.summaryBullets.forEach((item) => {
            children.push(
                new Paragraph({
                    text: `• ${item}`,
                    spacing: { after: 120 },
                })
            )
        })
    }

    report.sections.forEach((section, index) => {
        children.push(
            new Paragraph({
                text: `${index + 1}. ${section.heading || "Untitled Section"}`,
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 480, after: 240 },
            })
        )

        if (section.body) {
            children.push(
                new Paragraph({
                    text: section.body,
                    spacing: { after: 240 },
                })
            )
        }

        if (Array.isArray(section.bullets)) {
            section.bullets.forEach((bullet) => {
                children.push(
                    new Paragraph({
                        text: `• ${bullet}`,
                        spacing: { after: 100 },
                    })
                )
            })
        }

        if (section.table && Array.isArray(section.table.rows)) {
            children.push(
                new Paragraph({
                    text: section.table.title || "Analysis Table",
                    heading: HeadingLevel.HEADING_2,
                    spacing: { before: 260, after: 120 },
                })
            )

            children.push(createDataTable(section.table))
        }
    })

    children.push(
        new Paragraph({
            text: "Appendix. Assumptions & Sources",
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 700, after: 260 },
        })
    )

    children.push(
        new Paragraph({
            text: "Assumptions",
            heading: HeadingLevel.HEADING_2,
        })
    )

    report.appendix.assumptions.forEach((item) => {
        children.push(new Paragraph(`• ${item}`))
    })

    children.push(
        new Paragraph({
            text: "Sources",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300 },
        })
    )

    report.appendix.sources.forEach((item) => {
        children.push(new Paragraph(`• ${item}`))
    })

    const doc = new Document({
        creator: "GoNoGo",
        title: report.title,
        description: report.subtitle,
        sections: [
            {
                properties: {},
                children,
            },
        ],
    })

    return await Packer.toBuffer(doc)
}

function createInfoTable(rows) {
    return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(([label, value]) => {
            return new TableRow({
                children: [
                    new TableCell({
                        width: { size: 30, type: WidthType.PERCENTAGE },
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
                        shading: { fill: "F2F2F2" },
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
