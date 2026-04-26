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
        version: "2.1.0-visual-pdf",
    })
})

app.get("/api/health", (req, res) => {
    res.json({ ok: true, status: "healthy" })
})

app.get("/api/test-pdf", async (req, res) => {
    try {
        const sampleReport = normalizeDeepReport(getSampleReport(), {
            brandName: "NomNomBox",
            productService:
                "Premium pet-food sample subscription for online dog owners",
            targetCustomer: "Online dog owners",
            language: "en",
        })

        const html = buildHtmlFromTemplate(sampleReport)
        const pdfBuffer = await htmlToPdf(html)

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Length", pdfBuffer.length)
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="GoNoGo_Test_Report.pdf"`
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
- Include market size, success probability, unit economics, marketing strategy, and execution plan.
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

function buildHtmlFromTemplate(report) {
    const templatePath = path.join(__dirname, "templates", "deep-report.html")
    let html = fs.readFileSync(templatePath, "utf8")

    const matrix = objectFromPairs(report.decisionMatrix)
    const market = objectFromPairs(report.marketCards)
    const unit = objectFromPairs(report.unitEconomicsCards)
    const executiveMap = objectFromPairs(report.executiveDecision)

    const funnel = normalizeFunnel(report.marketFunnel)

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

        marketScore: report.visualScores.market,
        profitabilityScore: report.visualScores.profitability,
        executionScore: report.visualScores.execution,
        riskScore: report.visualScores.risk,

        ltvToCac: report.unitEconomicsScore.ltvToCac,
        unitEconomicsStatus: report.unitEconomicsScore.status,
        paybackValue: report.unitEconomicsScore.payback,

        whyItWorks: executiveMap["Why this works"] || "",
        whyItFails: executiveMap["Why this fails"] || "",
        whatToDoNow: executiveMap["What to do now"] || "",
        founderDecision: report.founderDecision,

        tamValue: market.TAM || funnel.tam.value || "",
        samValue: market.SAM || funnel.sam.value || "",
        somValue: market.SOM || funnel.som.value || "",
        growthValue: market.GROWTH || "",

        tamScore: funnel.tam.score,
        samScore: funnel.sam.score,
        somScore: funnel.som.score,

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
        .replace("{{goChecklistItems}}", checklistItems(report.goChecklist))
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

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "0mm",
                right: "0mm",
                bottom: "0mm",
                left: "0mm",
            },
        })

        return Buffer.from(pdf)
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
            return `<tr>${cells
                .map((cell) => `<td>${esc(cell)}</td>`)
                .join("")}</tr>`
        })
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""

    return items.map((item) => `<li>${esc(item)}</li>`).join("")
}

function checklistItems(items) {
    if (!Array.isArray(items)) return ""

    return items
        .map((item) => {
            const status = String(item.status || "WATCH").toUpperCase()
            const cls =
                status === "PASS"
                    ? "status-pass"
                    : status === "FAIL"
                      ? "status-fail"
                      : "status-watch"

            return `
                <div class="check-item">
                    <span>${esc(item.label || "")}</span>
                    <span class="${cls}">${esc(status)}</span>
                </div>
            `
        })
        .join("")
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

function normalizeFunnel(items) {
    const base = {
        tam: { value: "", score: 100 },
        sam: { value: "", score: 55 },
        som: { value: "", score: 18 },
    }

    if (!Array.isArray(items)) return base

    items.forEach((item) => {
        const label = String(item?.label || "").toUpperCase()
        const target =
            label === "TAM" ? "tam" : label === "SAM" ? "sam" : label === "SOM" ? "som" : null

        if (!target) return

        base[target] = {
            value: String(item?.value || ""),
            score: toScore(item?.score, base[target].score),
        }
    })

    return base
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

function toScore(value, fallback = 50) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(0, Math.min(100, Math.round(n)))
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
            brandName: "노미박스",
            decision: "HOLD",
            score: 61,
            subtitle: "온라인 반려견 고객을 위한 프리미엄 사료 샘플 구독 서비스",
            oneLineVerdict:
                "수요는 존재하지만, 반복구매와 마진 구조를 증명하기 전까지 확장은 위험하다.",
        },

        visualScores: {
            market: 82,
            profitability: 58,
            execution: 64,
            risk: 72,
        },

        decisionMatrix: [
            ["MARKET", "높음"],
            ["PROFITABILITY", "중간"],
            ["EXECUTION", "높음"],
            ["RISK", "높음"],
        ],

        executiveDecision: [
            [
                "Why this works",
                "반려견 시장은 꾸준히 성장하고 있으며, 반복 소비 구조가 존재한다.",
            ],
            [
                "Why this fails",
                "샘플 기반 모델은 차별화가 어렵고, 물류비가 수익성을 크게 악화시킨다.",
            ],
            [
                "What to do now",
                "전체 시장 확장이 아닌, 특정 고객군을 대상으로 소규모 검증부터 진행해야 한다.",
            ],
        ],

        founderDecision:
            "이 사업은 바로 확장할 대상이 아니라, 반드시 검증을 거쳐야 하는 모델이다. CAC와 반복구매가 기준을 통과하기 전까지는 확장을 금지해야 한다.",

        marketCards: [
            ["TAM", "약 170조원"],
            ["SAM", "약 58조원"],
            ["SOM", "500~2000명"],
            ["GROWTH", "연 5% 이상"],
        ],

        marketFunnel: [
            { label: "TAM", value: "170조원", score: 100 },
            { label: "SAM", value: "58조원", score: 55 },
            { label: "SOM", value: "초기 500~2000명", score: 18 },
        ],

        tamSamSom: [
            [
                "TAM",
                "글로벌 반려동물 식품 시장",
                "전체 시장 규모 기준",
                "시장 자체는 충분히 크다",
            ],
            [
                "SAM",
                "프리미엄 온라인 반려견 소비자",
                "온라인 + 프리미엄 고객층",
                "타겟 시장은 충분히 존재",
            ],
            [
                "SOM",
                "초기 유료 고객",
                "전환율 기반 추정",
                "검증 단계 시장",
            ],
        ],

        marketInsight:
            "이 시장은 단순 상품 판매보다 '신뢰'와 '문제 해결'이 중요한 시장이다.",

        customerTruth: [
            [
                "사료 거부 문제",
                "강아지가 사료를 먹지 않는 경우가 많다",
                "샘플 테스트 수요 존재",
            ],
            [
                "알러지 문제",
                "잘못된 사료 선택에 대한 두려움",
                "검증된 제품 선호",
            ],
            [
                "리뷰 의존",
                "다른 고객 경험을 참고",
                "콘텐츠 기반 마케팅 가능",
            ],
        ],

        buyingTrigger:
            "구매는 ‘새로운 사료를 찾는 순간’이 아니라 ‘실패를 피하고 싶을 때’ 발생한다.",

        competitionMap: [
            ["쿠팡", "플랫폼", "편리함", "큐레이션 없음"],
            ["네이버", "플랫폼", "가격 경쟁력", "신뢰 부족"],
            ["프레시펫", "DTC", "프리미엄", "가격 부담"],
            ["샘플 서비스 없음", "공백", "기회 존재", "시장 미형성"],
        ],

        competitionConclusion:
            "이 시장의 기회는 ‘구독’이 아니라 ‘선택 실패를 줄여주는 구조’다.",

        unitEconomicsCards: [
            ["CAC", "약 4~10만원"],
            ["LTV", "약 15~40만원"],
            ["AOV", "3~7만원"],
            ["REPEAT", "2.5회 이상"],
        ],

        unitEconomicsScore: {
            ltvToCac: "3.4배",
            payback: "3개월 이내",
            margin: "35% 이상",
            status: "WATCH",
        },

        unitEconomicsTable: [
            [
                "CAC",
                "4~10만원",
                "5만원 이하",
                "광고비 관리 필요",
            ],
            [
                "마진",
                "35% 이상",
                "통과",
                "물류비 영향 큼",
            ],
            [
                "LTV",
                "15~40만원",
                "20만원 이상",
                "반복구매 중요",
            ],
            [
                "반복구매",
                "2.5회 이상",
                "통과",
                "핵심 지표",
            ],
        ],

        economicsJudgment:
            "이 구조는 반복구매가 발생할 때만 성립하는 모델이다.",

        marketingStrategy: {
            channelFit: [
                ["틱톡", "HIGH", "유입", "반려동물 콘텐츠 강함"],
                ["인스타그램", "HIGH", "신뢰 구축", "스토리 기반"],
                ["검색", "MEDIUM", "문제 해결", "알러지 검색"],
                ["광고", "WATCH", "확장", "초기 비효율"],
            ],
            contentPlaybook: [
                "강아지 반응 테스트 영상",
                "사료 비교 콘텐츠",
                "알러지 해결 사례",
                "실제 사용자 후기",
                "실패 경험 공유",
            ],
            thirtyDayMarketingTest: [
                ["1~2주", "영상 20개 제작", "조회수 확인"],
                ["3주", "소액 광고 테스트", "CAC 측정"],
                ["4주", "고객 인터뷰", "문제 파악"],
            ],
        },

        businessModel: {
            revenueLayers: [
                ["샘플 박스", "1~2만원", "진입 장벽 낮춤"],
                ["구독", "월 2~4만원", "지속 수익"],
                ["정식 제품", "업셀", "LTV 확보"],
            ],
            modelJudgment:
                "샘플만으로는 수익이 안 나오고, 반드시 본품 전환이 필요하다.",
        },

        riskSystem: [
            ["물류비 증가", "높음", "상품 단순화"],
            ["재구매 없음", "높음", "업셀 구조 필요"],
            ["신뢰 부족", "높음", "리뷰 확보"],
        ],

        executionPlan: [
            ["1단계", "랜딩 + 100명 테스트", "전환율"],
            ["2단계", "배송 및 재구매 확인", "마진"],
            ["3단계", "확장 여부 결정", "CAC"],
        ],

        operatingRule:
            "검증 전까지 확장 금지. 하나의 고객군에서만 테스트 진행.",

        goThreshold: [
            ["CAC", "3개월 회수", "확장 가능"],
            ["마진", "35% 이상", "운영 가능"],
            ["재구매", "2.5회 이상", "수익 가능"],
            ["불만율", "5% 이하", "제품 안정"],
        ],

        goChecklist: [
            { label: "CAC 3개월 회수", status: "PASS" },
            { label: "마진 35% 이상", status: "PASS" },
            { label: "재구매율", status: "WATCH" },
            { label: "불만율 5% 이하", status: "PASS" },
        ],

        finalRule:
            "4개 중 3개 이상 통과 시 GO, 2개 이하 통과 시 HOLD, 핵심 지표 실패 시 NO GO.",

        appendix: {
            dataSources: [
                ["반려동물 시장", "산업 보고서", "시장 규모"],
                ["소비 데이터", "통계 자료", "수요 분석"],
                ["광고 비용", "마케팅 데이터", "CAC 계산"],
            ],
            assumptions: [
                "초기 브랜드 없음",
                "온라인 중심 판매",
                "데이터 기반 추정",
                "테스트 필요",
            ],
        },
    }
}

app.listen(PORT, () => {
    console.log(`GoNoGo server running on port ${PORT}`)
})
