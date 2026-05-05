import express from "express"
import cors from "cors"
import crypto from "crypto"
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
app.use(express.urlencoded({ extended: true }))

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

const paidDownloadTokens = new Map()

function createPaidDownloadToken(payload = {}) {
    const token = crypto.randomBytes(24).toString("hex")

    paidDownloadTokens.set(token, {
        paid: true,
        downloadLimit: 3,
        downloadCount: 0,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        payload,
    })

    return token
}

function validatePaidDownloadToken(token) {
    if (!token) {
        return { ok: false, status: 401, message: "Missing download token." }
    }

    const record = paidDownloadTokens.get(token)

    if (!record || !record.paid) {
        return { ok: false, status: 403, message: "Invalid payment token." }
    }

    if (Date.now() > record.expiresAt) {
        return { ok: false, status: 403, message: "This download link has expired." }
    }

    if (record.downloadCount >= record.downloadLimit) {
        return { ok: false, status: 403, message: "Download limit exceeded." }
    }

    return { ok: true, record }
}

function normalizeLanguage(lang) {
    const supported = ["ko", "en", "ja", "zh", "mn"]
    return supported.includes(lang) ? lang : "en"
}

function getLanguageName(lang) {
    const map = {
        ko: "Korean",
        en: "English",
        ja: "Japanese",
        zh: "Chinese",
        mn: "Mongolian",
    }

    return map[normalizeLanguage(lang)] || "English"
}

function esc(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
}

function safeArray(value, fallback = []) {
    return Array.isArray(value) ? value : fallback
}

function toScore(value, fallback = 50) {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(0, Math.min(100, Math.round(n)))
}

function sanitizeFileName(value = "Report") {
    return String(value || "Report")
        .replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ一-龥ぁ-んァ-ン.\-]+/g, "_")
        .slice(0, 80)
}

function objectFromPairs(rows = []) {
    const out = {}

    for (const row of safeArray(rows, [])) {
        if (Array.isArray(row) && row.length >= 2) {
            out[String(row[0]).toUpperCase()] = row[1]
        }
    }

    return out
}
function loadLocale(language = "ko") {
    const lang = normalizeLanguage(language)
    const localePath = path.join(__dirname, "locales", `${lang}.json`)

    try {
        const raw = fs.readFileSync(localePath, "utf8")
        return {
            ...JSON.parse(raw),
            lang,
        }
    } catch (error) {
        console.warn("[LOCALE_LOAD_FALLBACK]", lang, error?.message)

        return {
            lang,
            fontFamily:
                "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            reportTitleSuffix: "Deep Business Decision Report",
            scoreLabel: "Score",
            footer: {
                left: "GoNoGo™ Business Decision Report",
            },
            labels: {},
            fixedNotes: {},
            locked: {
                title: "Paid report only",
                button: "Premium Report",
                message:
                    "Core data and execution strategy are available in the paid report.",
            },
            premium: {
                kicker: "PREMIUM REPORT",
                title: "The full analysis is available in the paid report.",
                desc: "Customer analysis, market size, competitive structure, profit simulation, marketing strategy, risk judgment, and execution plan are available in the full report.",
                ctaButton: "Unlock Full Report",
            },
            tables: {
                scoreGuideRows: [
                    ["85~100", "Excellent", "Strong GO candidate. Scaling can be reviewed"],
                    ["70~84", "Good", "GO is possible if the conditions fit"],
                    ["50~69", "Average / Needs Validation", "HOLD. Decide after a small test"],
                    ["30~49", "Risky", "High possibility of NO GO. Structural redesign needed"],
                    ["0~29", "Very Risky", "Stop immediately or conduct a full review"],
                ],
            },
        }
    }
}

function t(locale = {}, key = "", fallback = "") {
    const parts = String(key).split(".")
    let cur = locale

    for (const part of parts) {
        if (!cur || typeof cur !== "object" || !(part in cur)) {
            return fallback
        }
        cur = cur[part]
    }

    return cur ?? fallback
}

function getLocaleTable(locale = {}, key = "", fallback = []) {
    const value = t(locale, key, null)
    return Array.isArray(value) ? value : fallback
}

function flattenLabels(labels = {}, prefix = "") {
    const out = {}

    for (const [key, value] of Object.entries(labels || {})) {
        const nextKey = prefix ? `${prefix}_${key}` : key

        if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.assign(out, flattenLabels(value, nextKey))
        } else {
            out[nextKey] = value
        }
    }

    return out
}

function flattenNotes(notes = {}, prefix = "") {
    const out = {}

    for (const [key, value] of Object.entries(notes || {})) {
        const nextKey = prefix ? `${prefix}_${key}` : key

        if (value && typeof value === "object" && !Array.isArray(value)) {
            Object.assign(out, flattenNotes(value, nextKey))
        } else {
            out[nextKey] = value
        }
    }

    return out
}

function applyTemplateVars(html, data = {}) {
    let result = html

    for (const [key, value] of Object.entries(data)) {
        const safeValue =
            typeof value === "number" || typeof value === "boolean"
                ? String(value)
                : esc(value ?? "")

        result = result.replaceAll(`{{${key}}}`, safeValue)
    }

    return result
}

function validateTemplateKeys(html, data = {}, ignored = []) {
    const missing = [...html.matchAll(/{{([^}]+)}}/g)]
        .map((m) => m[1])
        .filter((key) => !ignored.includes(key))
        .filter((key) => !(key in data))

    if (missing.length) {
        console.warn("[MISSING_TEMPLATE_KEYS]", [...new Set(missing)].slice(0, 40))
    }
}

function rows(table = []) {
    return safeArray(table, [])
        .map((row) => {
            const cells = safeArray(row, [])
                .map((cell) => `<td>${esc(cell)}</td>`)
                .join("")
            return `<tr>${cells}</tr>`
        })
        .join("")
}

function listItems(items = []) {
    return safeArray(items, [])
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")
}

function glossaryRows(items = []) {
    return safeArray(items, [])
        .map(
            (item) => `
<tr>
  <td>${esc(item?.term || "")}</td>
  <td>${esc(item?.meaning || "")}</td>
  <td>${esc(item?.whyItMatters || "")}</td>
</tr>`
        )
        .join("")
}

function checklistItems(items = []) {
    return safeArray(items, [])
        .map(
            (item) => `
<li>
  <strong>${esc(item?.label || "")}</strong>
  <span>${esc(item?.status || "")}</span>
</li>`
        )
        .join("")
}

function lockedBox(message = "", title = "Paid report only", button = "Premium Report") {
    return `
<div class="locked-box">
  <div class="locked-title">${esc(title)}</div>
  <div class="locked-message">${esc(message)}</div>
  <div class="locked-button">${esc(button)}</div>
</div>`
}
function getStatusClass(decision = "") {
    const value = String(decision).toUpperCase()

    if (value.includes("NO")) return "nogo"
    if (value.includes("GO")) return "go"
    return "hold"
}

function getScoreClass(score = 0) {
    const n = toScore(score, 50)

    if (n >= 75) return "good"
    if (n >= 50) return "watch"
    return "bad"
}

function getRiskScoreClass(score = 0) {
    const n = toScore(score, 50)

    if (n >= 70) return "bad"
    if (n >= 40) return "watch"
    return "good"
}

function normalizeFunnel(funnel = []) {
    const arr = safeArray(funnel, [])

    const findItem = (label, fallbackScore) => {
        const item =
            arr.find(
                (x) =>
                    String(x?.label || "")
                        .toUpperCase()
                        .trim() === label
            ) || {}

        return {
            label,
            value: item?.value || "",
            score: toScore(item?.score, fallbackScore),
        }
    }

    return {
        tam: findItem("TAM", 100),
        sam: findItem("SAM", 60),
        som: findItem("SOM", 20),
    }
}

function buildDecisionChart(report = {}, locale = {}) {
    const scores = report?.visualScores || {}

    const items = [
        ["Market", toScore(scores.market, 50), getScoreClass(scores.market)],
        ["Profitability", toScore(scores.profitability, 50), getScoreClass(scores.profitability)],
        ["Execution", toScore(scores.execution, 50), getScoreClass(scores.execution)],
        ["Risk", toScore(scores.risk, 50), getRiskScoreClass(scores.risk)],
    ]

    return `
<div class="decision-chart">
  ${items
      .map(
          ([label, score, className]) => `
  <div class="decision-chart-card">
    <div class="chart-label">${esc(label)}</div>
    <div class="chart-score">${esc(score)} / 100</div>
    <div class="chart-bar">
      <div class="chart-fill ${esc(className)}" style="width:${esc(score)}%;"></div>
    </div>
  </div>`
      )
      .join("")}
</div>`
}

function marketFunnelChart(funnel = []) {
    const normalized = normalizeFunnel(funnel)
    const items = [normalized.tam, normalized.sam, normalized.som]

    return `
<div class="market-funnel-chart">
  ${items
      .map(
          (item) => `
  <div class="funnel-row">
    <div class="funnel-label">${esc(item.label)}</div>
    <div class="funnel-track">
      <div class="funnel-fill" style="width:${esc(item.score)}%;"></div>
    </div>
    <div class="funnel-value">${esc(item.value)}</div>
  </div>`
      )
      .join("")}
</div>`
}

function profitSimulationChart(table = [], locale = {}) {
    const rows = safeArray(table, []).slice(0, 3)

    return `
<div class="profit-simulation-chart">
  ${rows
      .map((row) => {
          const scenario = row?.[0] || ""
          const revenue = row?.[2] || ""
          const marketing = row?.[3] || ""
          const profit = row?.[4] || ""

          return `
  <div class="profit-card">
    <div class="profit-scenario">${esc(scenario)}</div>
    <div class="profit-line"><span>Revenue</span><strong>${esc(revenue)}</strong></div>
    <div class="profit-line"><span>Marketing Cost</span><strong>${esc(marketing)}</strong></div>
    <div class="profit-line"><span>Profit</span><strong>${esc(profit)}</strong></div>
  </div>`
      })
      .join("")}
</div>`
}

function cacLtvRiskChart(table = [], locale = {}) {
    const rows = safeArray(table, []).slice(0, 3)

    return `
<div class="cac-ltv-chart">
  ${rows
      .map((row) => {
          const scenario = row?.[0] || ""
          const cac = row?.[1] || ""
          const ltv = row?.[2] || ""
          const decision = row?.[3] || ""

          return `
  <div class="cac-ltv-card">
    <div class="cac-ltv-scenario">${esc(scenario)}</div>
    <div class="cac-ltv-values">
      <span>CAC ${esc(cac)}</span>
      <span>LTV ${esc(ltv)}</span>
    </div>
    <div class="cac-ltv-decision">${esc(decision)}</div>
  </div>`
      })
      .join("")}
</div>`
}

function competitionPositionChart(rowsInput = [], locale = {}) {
    const items = safeArray(rowsInput, []).slice(0, 4)

    return `
<div class="competition-position-chart">
  ${items
      .map((row) => {
          const name = row?.[0] || ""
          const strength = row?.[1] || ""
          const weakness = row?.[2] || ""
          const position = row?.[3] || ""

          return `
  <div class="competition-card">
    <div class="competition-name">${esc(name)}</div>
    <div class="competition-meta">${esc(strength)}</div>
    <div class="competition-meta">${esc(weakness)}</div>
    <div class="competition-position">${esc(position)}</div>
  </div>`
      })
      .join("")}
</div>`
}

function riskHeatmap(rowsInput = [], locale = {}) {
    const items = safeArray(rowsInput, []).slice(0, 3)

    return `
<div class="risk-heatmap">
  ${items
      .map((row) => {
          const risk = row?.[0] || ""
          const impact = row?.[1] || ""
          const countermeasure = row?.[2] || ""

          return `
  <div class="risk-card">
    <div class="risk-name">${esc(risk)}</div>
    <div class="risk-impact">${esc(impact)}</div>
    <div class="risk-action">${esc(countermeasure)}</div>
  </div>`
      })
      .join("")}
</div>`
}

function executionTimeline(rowsInput = [], locale = {}) {
    const items = safeArray(rowsInput, []).slice(0, 3)

    return `
<div class="execution-timeline">
  ${items
      .map((row, idx) => {
          const phase = row?.[0] || `Phase ${idx + 1}`
          const action = row?.[1] || ""
          const kpi = row?.[2] || ""

          return `
  <div class="timeline-item">
    <div class="timeline-index">${idx + 1}</div>
    <div>
      <div class="timeline-title">${esc(phase)}</div>
      <div class="timeline-action">${esc(action)}</div>
      <div class="timeline-kpi">${esc(kpi)}</div>
    </div>
  </div>`
      })
      .join("")}
</div>`
}

function decisionSummaryBox(report = {}, locale = {}) {
    return `
<div class="decision-summary-box ${esc(getStatusClass(report?.cover?.decision))}">
  <div class="summary-kicker">FINAL DECISION</div>
  <div class="summary-decision">${esc(report?.cover?.decision || "HOLD")}</div>
  <div class="summary-score">Score: ${esc(report?.cover?.score || 0)} / 100</div>
  <p>${esc(report?.founderDecision || report?.cover?.oneLineVerdict || "")}</p>
</div>`
}
function buildFreeReportPrompt({ brandName, productService, targetCustomer, language }) {
    const languageName = getLanguageName(language)

    return `
You are GoNoGo, a business decision engine.

Generate a SHORT free business decision preview.

Final language: ${languageName}

Business Input:
- Business Idea Title: ${brandName}
- Product / Service: ${productService}
- Target Customer: ${targetCustomer}

Rules:
- Output VALID JSON only.
- No markdown.
- No explanation outside JSON.
- Keep all fields short.
- Max 2 sentences per text field.
- Do not use line breaks inside JSON string values.
- Do not use trailing commas.
- Escape all double quotes inside string values.
- Every string value must be JSON-safe.
- Be direct, conservative, and decision-oriented.
- This is a FREE preview, not a full report.
- All user-facing values must be written in ${languageName}.
- Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.
- Return every key in the exact JSON structure below.
- Do not return null.
- Do not return undefined.

Return ONLY this JSON structure:

{
  "cover": {
    "brandName": "${brandName}",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },
  "glossary": [
    { "term": "TAM", "meaning": "", "whyItMatters": "" },
    { "term": "SAM", "meaning": "", "whyItMatters": "" },
    { "term": "CAC", "meaning": "", "whyItMatters": "" },
    { "term": "LTV", "meaning": "", "whyItMatters": "" },
    { "term": "Conversion", "meaning": "", "whyItMatters": "" }
  ],
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
  "visualScores": {
    "market": 0,
    "profitability": 0,
    "execution": 0,
    "risk": 0
  },
  "decisionMatrix": [
    ["MARKET", "LOW | MEDIUM | HIGH"],
    ["PROFITABILITY", "LOW | MEDIUM | HIGH"],
    ["EXECUTION", "LOW | MEDIUM | HIGH"],
    ["RISK", "LOW | MEDIUM | HIGH"]
  ],
  "executiveDecision": [
    ["Why this works", ""],
    ["Why this fails", ""],
    ["What to do now", ""]
  ],
  "founderDecision": "",
  "marketCards": [
    ["TAM", ""],
    ["SAM", ""],
    ["SOM", ""],
    ["GROWTH", ""]
  ],
  "marketFunnel": [
    { "label": "TAM", "value": "", "score": 100 },
    { "label": "SAM", "value": "", "score": 60 },
    { "label": "SOM", "value": "", "score": 20 }
  ],
  "tamSamSom": [
    ["TAM", "", "", ""],
    ["SAM", "", "", ""],
    ["SOM", "", "", ""]
  ],
  "marketInsight": "",
  "customerTruth": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "customerOpportunity": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "buyingTrigger": "",
  "customerSummary": "",
  "competitionMap": [
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""],
    ["", "", "", ""]
  ],
  "competitionConclusion": "",
  "benchmarkRows": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "unitEconomicsCards": [
    ["CAC", ""],
    ["LTV", ""],
    ["AOV", ""],
    ["REPEAT", ""]
  ],
  "unitEconomicsScore": {
    "ltvToCac": "",
    "payback": "",
    "margin": "",
    "status": "PASS | WATCH | FAIL"
  },
  "unitEconomicsTable": [
    ["CAC", "", "", ""],
    ["LTV", "", "", ""],
    ["AOV", "", "", ""],
    ["Repeat", "", "", ""]
  ],
  "economicsJudgment": "",
  "marketingStrategy": {
    "channelFit": [
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""],
      ["", "LOW | MEDIUM | HIGH | WATCH", "", ""]
    ],
    "contentPlaybook": ["", "", "", "", ""],
    "thirtyDayMarketingTest": [
      ["Week 1", "", ""],
      ["Week 2", "", ""],
      ["Week 3", "", ""],
      ["Week 4", "", ""],
      ["Week 5", "", ""],
      ["Week 6", "", ""],
      ["Week 7", "", ""],
      ["Week 8", "", ""],
      ["Week 9", "", ""],
      ["Week 10", "", ""],
      ["Week 11", "", ""],
      ["Week 12", "", ""]
    ]
  },
  "businessModel": {
    "revenueLayers": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "modelJudgment": "",
    "modelDeepDive": ""
  },
  "riskSystem": [
    ["", "", ""],
    ["", "", ""],
    ["", "", ""]
  ],
  "executionPlan": [
    ["Phase 1", "", ""],
    ["Phase 2", "", ""],
    ["Phase 3", "", ""]
  ],
  "operatingRule": "",
  "goThreshold": [
    ["CAC", "", ""],
    ["Conversion", "", ""],
    ["Repeat", "", ""],
    ["Margin", "", ""]
  ],
  "goChecklist": [
    { "label": "CAC", "status": "PASS | WATCH | FAIL" },
    { "label": "Conversion", "status": "PASS | WATCH | FAIL" },
    { "label": "Repeat Purchase", "status": "PASS | WATCH | FAIL" },
    { "label": "Margin", "status": "PASS | WATCH | FAIL" }
  ],
  "finalRule": "",
  "dataConfidence": {
    "overallLevel": "LOW | MEDIUM | HIGH",
    "summary": "",
    "sourceQuality": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "limits": ["", "", ""]
  },
  "sensitivityAnalysis": {
    "cacLtvTable": [
      ["Low CAC", "", "", ""],
      ["Base CAC", "", "", ""],
      ["High CAC", "", "", ""]
    ],
    "criticalBreakPoint": "",
    "founderWarning": ""
  },
  "profitSimulation": {
    "monthlyScenarioTable": [
      ["Conservative", "", "", "", "", ""],
      ["Base", "", "", "", "", ""],
      ["Aggressive", "", "", "", "", ""]
    ],
    "breakEvenPoint": "",
    "profitJudgment": "",
    "cashRisk": ""
  },
  "killCriteria": {
    "rules": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "stopDecision": "",
    "pivotDecision": "",
    "scaleDecision": ""
  },
  "appendix": {
    "dataSources": [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""]
    ],
    "assumptions": ["", "", "", ""]
  },
  "referenceLinks": [
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""]
  ],
  "brandNaming": {
    "brandDirection": "",
    "namingStrategy": "",
    "keywords": ["", "", "", "", "", "", "", ""],
    "nameCandidates": [
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 },
      { "name": "", "meaning": "", "fit": "", "risk": "", "score": 0 }
    ],
    "recommendedName": {
      "name": "",
      "reason": "",
      "positioning": "",
      "expansionPotential": ""
    },
    "domainSuggestions": [
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" },
      { "domain": "", "reason": "", "availability": "HIGH | MEDIUM | LOW" }
    ]
  }
}
`
}

function buildPaidReportPrompt({ brandName, productService, targetCustomer, language }) {
    const languageName = getLanguageName(language)

    return `
You are GoNoGo, a ruthless business decision engine.

You are NOT a writer.
You are NOT a generic consultant.
You are a paid business decision report engine.

Your job:
Evaluate this business idea and generate a premium PDF-ready JSON report.

Final report language: ${languageName}

Business Input:
- Business Idea Title: ${brandName}
- Product / Service: ${productService}
- Target Customer: ${targetCustomer}
- Language / Market: ${language}

Critical rules:
1. Output VALID JSON only.
2. No markdown.
3. No explanation outside JSON.
4. Use the exact JSON shape provided below.
5. Do not use placeholders.
6. Every table cell must contain real content.
7. Use realistic assumptions when exact data is unavailable.
8. Clearly state assumptions in appendix.
9. Use country-specific market logic.
10. Be conservative, not optimistic.
11. If the business is weak, say it clearly.
12. All scores must be numbers from 0 to 100.
13. Keep table cells concise but meaningful.
14. Make the report directly useful for founder decision-making.
15. You must return every field in the exact JSON structure.
16. Never omit required keys.
17. Never rename keys.
18. Never add new top-level keys.
19. Every array must keep the required number of rows.
20. Every table row must keep the required number of columns.
21. If data is uncertain, write a conservative assumption instead of leaving it blank.
22. Do not use null.
23. Do not use undefined.
24. Do not use empty strings unless the field is truly impossible.
25. Keep all table cells short and layout-safe.
26. This rule applies ONLY to table cells.
27. Narrative fields must be deeper and more informative.
28. Escape all double quotes inside string values.
29. Do not use unescaped quotation marks inside any JSON string.
30. Do not use line breaks inside JSON string values.
31. Do not use trailing commas.
32. Every string value must be valid JSON-safe text.

Layout safety rules:
- Table cells must be short.
- Each table cell should be 8 to 18 words maximum in English.
- For Japanese, Chinese, and Mongolian, keep table cells shorter than English.
- Do not write full paragraphs inside table cells.
- Long explanations must go only into text fields such as marketInsight, buyingTrigger, economicsJudgment, modelJudgment, operatingRule, finalRule, founderWarning.
- Do not put line breaks inside table cells.
- Do not use very long compound phrases inside table cells.
- Avoid repeating the same sentence across multiple cells.
- Numbers, ranges, and decisions should be concise.
- Use clear, founder-friendly wording.
`
}
async function generateDeepReportJson(input) {
    const { brandName, productService, targetCustomer, language } = input

    const reportType = input.reportType === "paid" ? "paid" : "free"

    const systemPrompt =
        reportType === "free"
            ? buildFreeReportPrompt(input)
            : buildPaidReportPrompt(input)

    const userPrompt = JSON.stringify({
        brandName,
        productService,
        targetCustomer,
        language,
        reportType,
    })

    const model =
        reportType === "paid"
            ? process.env.OPENAI_PAID_MODEL || "gpt-4.1"
            : process.env.OPENAI_FREE_MODEL || "gpt-4.1-mini"

    console.log("[REPORT_TYPE]", reportType)
    console.log("[OPENAI_MODEL]", model)

    const completion = await openai.chat.completions.create({
        model,
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

    let parsed

    try {
        parsed = JSON.parse(raw)
    } catch (err) {
        console.error("[JSON_PARSE_ERROR]", err)
        console.error("[RAW_HEAD]", raw.slice(0, 1000))
        console.error("[RAW_TAIL]", raw.slice(-1000))
        throw new Error("OpenAI returned invalid JSON")
    }

    return normalizeDeepReport(parsed, input)
}
function normalizeDeepReport(report, input) {
    const isPaid = input.reportType === "paid"

    return {
        cover: {
            brandName: report?.cover?.brandName || input.brandName || "",
            decision: report?.cover?.decision || "HOLD",
            score: toScore(report?.cover?.score, 50),
            subtitle: report?.cover?.subtitle || input.productService || "",
            oneLineVerdict: report?.cover?.oneLineVerdict || "",
        },

        glossary: safeArray(report?.glossary, []).slice(0, 5),

        businessDiagnosis: {
            industryType: report?.businessDiagnosis?.industryType || "",
            businessModelType: report?.businessDiagnosis?.businessModelType || "",
            countryMarketBehavior: report?.businessDiagnosis?.countryMarketBehavior || "",
            marketEntryDifficulty: report?.businessDiagnosis?.marketEntryDifficulty || "MEDIUM",
            mainBottleneck: report?.businessDiagnosis?.mainBottleneck || "",
            bestFirstOffer: report?.businessDiagnosis?.bestFirstOffer || "",
            validationExperiment: report?.businessDiagnosis?.validationExperiment || "",
            goNoGoLogic: report?.businessDiagnosis?.goNoGoLogic || "",
            structureSummary: report?.businessDiagnosis?.structureSummary || "",
        },

        visualScores: {
            market: toScore(report?.visualScores?.market, 50),
            profitability: toScore(report?.visualScores?.profitability, 50),
            execution: toScore(report?.visualScores?.execution, 50),
            risk: toScore(report?.visualScores?.risk, 50),
        },

        decisionMatrix: safeArray(report?.decisionMatrix, []).slice(0, 4),

        executiveDecision: safeArray(report?.executiveDecision, []).slice(0, 3),

        founderDecision: report?.founderDecision || "",

        marketCards: safeArray(report?.marketCards, []).slice(0, 4),
        marketFunnel: safeArray(report?.marketFunnel, []).slice(0, 3),

        tamSamSom: safeArray(report?.tamSamSom, []).slice(0, 3),

        marketInsight: report?.marketInsight || "",

        customerTruth: safeArray(report?.customerTruth, []).slice(0, 3),
        customerOpportunity: safeArray(report?.customerOpportunity, []).slice(0, 4),

        buyingTrigger: report?.buyingTrigger || "",
        customerSummary: report?.customerSummary || "",

        competitionMap: safeArray(report?.competitionMap, []).slice(0, 4),
        competitionConclusion: report?.competitionConclusion || "",
        benchmarkRows: safeArray(report?.benchmarkRows, []).slice(0, 3),

        unitEconomicsCards: safeArray(report?.unitEconomicsCards, []).slice(0, 4),

        unitEconomicsScore: {
            ltvToCac: report?.unitEconomicsScore?.ltvToCac || "",
            payback: report?.unitEconomicsScore?.payback || "",
            margin: report?.unitEconomicsScore?.margin || "",
            status: report?.unitEconomicsScore?.status || "WATCH",
        },

        unitEconomicsTable: safeArray(report?.unitEconomicsTable, []).slice(0, 4),
        economicsJudgment: report?.economicsJudgment || "",

        marketingStrategy: {
            channelFit: safeArray(report?.marketingStrategy?.channelFit, []).slice(0, 4),
            contentPlaybook: safeArray(report?.marketingStrategy?.contentPlaybook, []).slice(0, 5),
            thirtyDayMarketingTest: safeArray(report?.marketingStrategy?.thirtyDayMarketingTest, []).slice(0, 12),
        },

        businessModel: {
            revenueLayers: safeArray(report?.businessModel?.revenueLayers, []).slice(0, 3),
            modelJudgment: report?.businessModel?.modelJudgment || "",
            modelDeepDive: report?.businessModel?.modelDeepDive || "",
        },

        riskSystem: safeArray(report?.riskSystem, []).slice(0, 3),
        executionPlan: safeArray(report?.executionPlan, []).slice(0, 3),

        operatingRule: report?.operatingRule || "",

        goThreshold: safeArray(report?.goThreshold, []).slice(0, 4),
        goChecklist: safeArray(report?.goChecklist, []).slice(0, 4),

        finalRule: report?.finalRule || "",

        dataConfidence: {
            overallLevel: report?.dataConfidence?.overallLevel || "MEDIUM",
            summary: report?.dataConfidence?.summary || "",
            sourceQuality: safeArray(report?.dataConfidence?.sourceQuality, []).slice(0, 3),
            limits: safeArray(report?.dataConfidence?.limits, []).slice(0, 3),
        },

        sensitivityAnalysis: {
            cacLtvTable: safeArray(report?.sensitivityAnalysis?.cacLtvTable, []).slice(0, 3),
            criticalBreakPoint: report?.sensitivityAnalysis?.criticalBreakPoint || "",
            founderWarning: report?.sensitivityAnalysis?.founderWarning || "",
        },

        profitSimulation: {
            monthlyScenarioTable: safeArray(report?.profitSimulation?.monthlyScenarioTable, []).slice(0, 3),
            breakEvenPoint: report?.profitSimulation?.breakEvenPoint || "",
            profitJudgment: report?.profitSimulation?.profitJudgment || "",
            cashRisk: report?.profitSimulation?.cashRisk || "",
        },

        killCriteria: {
            rules: safeArray(report?.killCriteria?.rules, []).slice(0, 4),
            stopDecision: report?.killCriteria?.stopDecision || "",
            pivotDecision: report?.killCriteria?.pivotDecision || "",
            scaleDecision: report?.killCriteria?.scaleDecision || "",
        },

        appendix: {
            dataSources: safeArray(report?.appendix?.dataSources, []).slice(0, 3),
            assumptions: safeArray(report?.appendix?.assumptions, []).slice(0, 4),
        },

        referenceLinks: safeArray(report?.referenceLinks, []).slice(0, 5),

        brandNaming: report?.brandNaming || {},

        reportMode: isPaid ? "paid" : "free",
        isPaid,
    }
}
function buildFreeReportFromPaidReport(report) {
    return {
        ...report,
        reportMode: "free",
        isPaid: false,
        lockedSections: {
            tamSamSom: true,
            competition: true,
            unitEconomics: true,
            marketing: true,
            risk: true,
            execution: true,
            goThreshold: true,
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

    const lockedMessage = t(
        locale,
        "locked.message",
        report?.lockedSections?.message ||
            "Core data and execution strategy are available in the paid report."
    )

    const lockedTitle = t(locale, "locked.title", "Paid report only")
    const lockedButton = t(locale, "locked.button", "Premium Report")

    const scoreGuideRows = getLocaleTable(locale, "tables.scoreGuideRows", [
        ["85~100", "Excellent", "Strong GO candidate. Scaling can be reviewed"],
        ["70~84", "Good", "GO is possible if the conditions fit"],
        ["50~69", "Average / Needs Validation", "HOLD. Decide after a small test"],
        ["30~49", "Risky", "High possibility of NO GO. Structural redesign needed"],
        ["0~29", "Very Risky", "Stop immediately or conduct a full review"],
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

    const brandKeywords = safeArray(report?.brandNaming?.keywords, []).slice(0, 8)
    const brandNameCandidates = safeArray(
        report?.brandNaming?.nameCandidates,
        []
    ).slice(0, 5)
    const brandDomainSuggestions = safeArray(
        report?.brandNaming?.domainSuggestions,
        []
    ).slice(0, 5)

    const data = {
        lang: locale.lang,
        fontFamily:
            locale.fontFamily ||
            "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",

        reportTitleSuffix: locale.reportTitleSuffix || "",
        scoreLabel: locale.scoreLabel || "Score",
        footerLeft: locale.footer?.left || "GoNoGo™ Business Decision Report",

        ...flattenLabels(locale.labels || {}),
        ...flattenNotes(locale.fixedNotes || {}),

        brandName: report.cover?.brandName || "",
        decision: report.cover?.decision || "HOLD",
        score: report.cover?.score || 0,
        decisionClass: getStatusClass(report.cover?.decision),
        subtitle: report.cover?.subtitle || "",
        oneLineVerdict: report.cover?.oneLineVerdict || "",

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

        marketLevel: matrix.MARKET || "",
        profitabilityLevel: matrix.PROFITABILITY || "",
        executionLevel: matrix.EXECUTION || "",
        riskLevel: matrix.RISK || "",

        marketScore: report.visualScores?.market || 0,
        profitabilityScore: report.visualScores?.profitability || 0,
        executionScore: report.visualScores?.execution || 0,
        riskScore: report.visualScores?.risk || 0,

        marketScoreClass: getScoreClass(report.visualScores?.market),
        profitabilityScoreClass: getScoreClass(
            report.visualScores?.profitability
        ),
        executionScoreClass: getScoreClass(report.visualScores?.execution),
        riskScoreClass: getRiskScoreClass(report.visualScores?.risk),

        ltvToCac: report.unitEconomicsScore?.ltvToCac || "",
        unitEconomicsStatus: report.unitEconomicsScore?.status || "",
        paybackValue: report.unitEconomicsScore?.payback || "",

        whyItWorks: execMap["Why this works"] || "",
        whyItFails: execMap["Why this fails"] || "",
        whatToDoNow: execMap["What to do now"] || "",
        founderDecision: report.founderDecision || "",

        tamValue: market.TAM || funnel.tam.value,
        samValue: market.SAM || funnel.sam.value,
        somValue: market.SOM || funnel.som.value,
        growthValue: market.GROWTH || "",

        tamScore: funnel.tam.score,
        samScore: funnel.sam.score,
        somScore: funnel.som.score,

        marketInsight: report.marketInsight || "",
        buyingTrigger: report.buyingTrigger || "",
        customerSummary: report.customerSummary || "",

        cacValue: unit.CAC || "",
        ltvValue: unit.LTV || "",
        aovValue: unit.AOV || "",
        repeatValue: unit.REPEAT || "",

        economicsJudgment: report.economicsJudgment || "",
        modelJudgment: report.businessModel?.modelJudgment || "",
        modelDeepDive: report.businessModel?.modelDeepDive || "",
        operatingRule: report.operatingRule || "",
        finalRule: report.finalRule || "",

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

        decisionChart: buildDecisionChart(report, locale),
        competitionPositionChart: competitionPositionChart(
            report.competitionMap,
            locale
        ),
        riskHeatmap: riskHeatmap(report.riskSystem, locale),
        executionTimeline: executionTimeline(report.executionPlan, locale),
        decisionSummaryBox: decisionSummaryBox(report, locale),

        brandDirection: report?.brandNaming?.brandDirection || "",
        namingStrategy: report?.brandNaming?.namingStrategy || "",

        brandKeywordCards: brandKeywords
            .map(
                (keyword) => `
        <div class="card">
            <div class="card-title">${esc(
                locale.brand_keyword_label || "Keyword"
            )}</div>
            <div class="card-value">${esc(keyword)}</div>
        </div>`
            )
            .join(""),

        brandNameCandidateRows: brandNameCandidates
            .map(
                (item) => `
        <tr>
            <td>${esc(item?.name || "")}</td>
            <td>${esc(item?.meaning || "")}</td>
            <td>${esc(item?.fit || "")}</td>
            <td>${esc(item?.risk || "")}</td>
            <td>${esc(item?.score || "")}</td>
        </tr>`
            )
            .join(""),

        recommendedBrandName:
            report?.brandNaming?.recommendedName?.name || "",

        recommendedBrandReason: [
            report?.brandNaming?.recommendedName?.reason || "",
            report?.brandNaming?.recommendedName?.positioning || "",
            report?.brandNaming?.recommendedName?.expansionPotential || "",
        ]
            .filter(Boolean)
            .join(" "),

        brandDomainRows: brandDomainSuggestions
            .map(
                (item) => `
        <tr>
            <td>${esc(item?.domain || "")}</td>
            <td>${esc(item?.reason || "")}</td>
            <td>${esc(item?.availability || "")}</td>
        </tr>`
            )
            .join(""),
    }
        const templateData = {
        ...locale,
        ...data,
    }

    html = html
        .replace("{{glossaryRows}}", glossaryRows(report.glossary))
        .replace("{{scoreGuideRows}}", rows(scoreGuideRows))
        .replace("{{marketFunnelChart}}", marketFunnelChart(report.marketFunnel))
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
        .replace("{{competitionPositionChart}}", competitionPositionChart(report.competitionMap, locale))
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
        .replace("{{businessModelRows}}", rows(report.businessModel.revenueLayers))
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
        .replace("{{sourceQualityRows}}", rows(report.dataConfidence?.sourceQuality))
        .replace("{{dataLimitItems}}", listItems(report.dataConfidence?.limits))
        .replace("{{cacLtvRows}}", rows(report.sensitivityAnalysis?.cacLtvTable))
        .replace(
            "{{cacLtvRiskChart}}",
            cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale)
        )
        .replace("{{profitSimulationRows}}", rows(report.profitSimulation?.monthlyScenarioTable))
        .replaceAll(
            "{{profitSimulationChart}}",
            profitSimulationChart(report.profitSimulation?.monthlyScenarioTable, locale)
        )
        .replace("{{killCriteriaRows}}", rows(report.killCriteria?.rules))
        .replace("{{dataSourceRows}}", rows(report.appendix.dataSources))
        .replace("{{assumptionItems}}", listItems(report.appendix.assumptions))
        .replace("{{referenceLinkRows}}", rows(referenceLinks))
        .replace("{{modelDeepDive}}", esc(report?.businessModel?.modelDeepDive || ""))

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
        "competitionPositionChart",
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

    html = injectReportBackButton(html, locale)
    html = html.replace(/{{[^}]+}}/g, "")

    return html
}
function keepFreeReportOnly(html, locale = {}, report = {}) {
    const splitPoint = "<!-- FREE_REPORT_END -->"
    const index = html.indexOf(splitPoint)

    if (index === -1) {
        console.log("[FREE_SPLIT_POINT_NOT_FOUND]")
        return html
    }

    const freePart = html.slice(0, index)

    const score = Number.isFinite(report?.cover?.score)
        ? report.cover.score
        : 0

    const decision = report?.cover?.decision || "HOLD"

    const checkoutParams = new URLSearchParams({
        lang: locale.lang || "ko",
        brandName: report?.cover?.brandName || "PaidReport",
        productService: report?.cover?.subtitle || "A paid business report",
        targetCustomer: report?.targetCustomer || "Target customers",
    })

    const checkoutUrl =
        process.env.PAYWALL_CHECKOUT_URL ||
        `/api/dev-create-paid-token?${checkoutParams.toString()}`

    return `
${freePart}

<section class="page section-cover">
  <div class="section-kicker">
    ${esc(t(locale, "premium.kicker", "PREMIUM REPORT"))}
  </div>

  <div class="section-cover-title">
    ${esc(t(locale, "premium.title", "The full analysis is available in the paid report"))}
  </div>

  <div class="section-cover-desc">
    ${esc(t(locale, "premium.desc", "Customer analysis, market size, competitive structure, profit simulation, marketing strategy, risk judgment, and execution plan are available in the full report."))}
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
          ${esc(t(locale, "premium.lockedLabel", "Locked Decision Layer"))}
        </div>

        <div style="
          font-size:22px;
          line-height:1.15;
          font-weight:900;
          letter-spacing:-0.04em;
        ">
          ${esc(t(locale, "premium.lockedTitle", "The part that decides failure is still hidden."))}
        </div>

        <div style="
          margin-top:10px;
          font-size:12px;
          line-height:1.55;
          opacity:0.86;
        ">
          ${esc(t(locale, "premium.lockedDesc", "Free shows direction. Paid shows whether this business can survive with real customer, market, and profit logic."))}
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
        <div>✓ Customer buying trigger and hesitation signals</div>
        <div>✓ Market size and competition reality</div>
        <div>✓ CAC, LTV, payback, and profit structure</div>
        <div>✓ Risk system and kill criteria</div>
        <div>✓ 12-week execution plan</div>
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
          ${esc(t(locale, "premium.lockedLayer", "Locked decision layer"))}
        </div>
      </div>
    </div>

    <div style="
      background:#fff3f3;
      border-left:4px solid #b42318;
      padding:14px;
      margin-bottom:14px;
      font-size:13px;
      font-weight:800;
      color:#7a1c1c;
      line-height:1.55;
    ">
      ${esc(t(locale, "premium.urgencyLine", "This analysis is incomplete. Unlock the full report before spending money on branding, product development, ads, inventory, or a website."))}
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
      ${esc(t(locale, "premium.ctaSub", "Unlock the full report to see the real failure points, profit structure, customer resistance, and execution strategy."))}
    </div>
  </div>
</section>
`
}

function injectReportBackButton(html, locale = {}) {
    const backText = t(locale, "report.backToSite", "Back to GoNoGo")

    const buttonHtml = `
<a href="https://gonogo.so/report" style="
  position:fixed;
  left:14px;
  bottom:14px;
  z-index:99999;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:12px 16px;
  border-radius:999px;
  background:#0D2418;
  color:#ffffff;
  font-size:13px;
  font-weight:900;
  text-decoration:none;
  box-shadow:0 12px 32px rgba(13,36,24,0.22);
">
  ← ${esc(backText)}
</a>
`

    if (html.includes("</body>")) {
        return html.replace("</body>", `${buttonHtml}</body>`)
    }

    return `${html}${buttonHtml}`
}

function buildLoadingHtml(req) {
    const lang = normalizeLanguage(req.query.lang || "ko")
    const reportType = req.query.reportType === "paid" ? "paid" : "free"

    const params = new URLSearchParams({
        lang,
        reportType,
        brandName: req.query.brandName || "",
        productService: req.query.productService || "",
        targetCustomer: req.query.targetCustomer || "",
    })

    const targetUrl = `/api/debug-html?${params.toString()}`

    const loadingCopy = {
        ko: {
            title: "보고서를 만들고 있어",
            desc: "시장 위험, 고객 구매 이유, 수익 구조, 실행 가능성을 분석하는 중이야.",
            steps: [
                "사업 아이디어 구조 분석 중",
                "고객 구매 가능성 계산 중",
                "시장·경쟁 리스크 확인 중",
                "수익 구조와 실행 조건 정리 중",
                "최종 Go / No-Go 판단 생성 중",
            ],
        },
        en: {
            title: "Building your decision report",
            desc: "Analyzing market risk, customer logic, profit structure, and execution signals.",
            steps: [
                "Reading your business idea",
                "Checking customer buying logic",
                "Mapping market and competition risk",
                "Calculating profit structure",
                "Generating your Go / No-Go decision",
            ],
        },
        ja: {
            title: "レポートを生成しています",
            desc: "市場リスク、顧客心理、収益構造、実行可能性を分析しています。",
            steps: [
                "事業アイデアを分析中",
                "顧客の購入理由を確認中",
                "市場と競合リスクを確認中",
                "収益構造を整理中",
                "Go / No-Go 判断を生成中",
            ],
        },
        zh: {
            title: "正在生成决策报告",
            desc: "正在分析市场风险、客户购买逻辑、盈利结构和执行条件。",
            steps: [
                "分析商业想法结构",
                "判断客户购买动机",
                "检查市场与竞争风险",
                "整理盈利结构",
                "生成 Go / No-Go 判断",
            ],
        },
        mn: {
            title: "Тайлан боловсруулж байна",
            desc: "Зах зээлийн эрсдэл, хэрэглэгчийн логик, ашигт ажиллагаа, хэрэгжүүлэх боломжийг шинжилж байна.",
            steps: [
                "Бизнес санааг шинжилж байна",
                "Хэрэглэгчийн худалдан авах шалтгааныг шалгаж байна",
                "Зах зээл ба өрсөлдөөний эрсдэлийг тооцож байна",
                "Ашгийн бүтцийг боловсруулж байна",
                "Go / No-Go шийдвэр гаргаж байна",
            ],
        },
    }

    const copy = loadingCopy[lang] || loadingCopy.en
    const stepsJson = JSON.stringify(copy.steps)

    return `
<!doctype html>
<html lang="${esc(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>GoNoGo™ Report Loading</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin:0;
      min-height:100vh;
      background:
        radial-gradient(circle at 20% 18%, rgba(182,255,90,0.18), transparent 28%),
        radial-gradient(circle at 80% 82%, rgba(13,36,24,0.08), transparent 32%),
        #ffffff;
      color:#0D2418;
      font-family:Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:28px;
      overflow:hidden;
    }
    .wrap { width:100%; max-width:430px; text-align:center; }
    .badge {
      display:inline-flex;
      align-items:center;
      gap:8px;
      padding:9px 13px;
      border:1px solid rgba(13,36,24,0.12);
      border-radius:999px;
      background:rgba(255,255,255,0.74);
      backdrop-filter:blur(12px);
      font-size:12px;
      font-weight:950;
      margin-bottom:30px;
      box-shadow:0 12px 32px rgba(13,36,24,0.05);
    }
    .dot {
      width:7px;
      height:7px;
      border-radius:50%;
      background:#B6FF5A;
      box-shadow:0 0 18px rgba(182,255,90,0.9);
    }
    .card {
      background:rgba(255,255,255,0.84);
      border:1px solid rgba(13,36,24,0.12);
      border-radius:30px;
      padding:34px 24px 28px;
      box-shadow:0 30px 90px rgba(13,36,24,0.10), inset 0 1px 0 rgba(255,255,255,0.9);
      backdrop-filter:blur(18px);
    }
    .spinner {
      width:52px;
      height:52px;
      border:4px solid rgba(13,36,24,0.12);
      border-top-color:#0D2418;
      border-radius:50%;
      margin:0 auto 24px;
      animation:spin 0.85s linear infinite;
    }
    h1 {
      margin:0 0 12px;
      font-size:31px;
      line-height:1.04;
      letter-spacing:-0.065em;
      font-weight:950;
    }
    .desc {
      margin:0 auto 26px;
      max-width:340px;
      color:#53645A;
      font-size:14px;
      line-height:1.65;
      font-weight:650;
    }
    .progress {
      height:10px;
      width:100%;
      background:#E5EDE8;
      border-radius:999px;
      overflow:hidden;
      margin-bottom:14px;
    }
    .bar {
      height:100%;
      width:8%;
      background:#0D2418;
      border-radius:999px;
      transition:width 0.45s ease;
    }
    .step {
      min-height:22px;
      color:#0D2418;
      font-size:13px;
      font-weight:900;
      letter-spacing:-0.02em;
    }
    .note {
      margin-top:22px;
      font-size:11px;
      line-height:1.5;
      color:#7B8B82;
      font-weight:700;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width:480px) {
      body { padding:18px; align-items:flex-start; padding-top:78px; }
      .card { border-radius:26px; padding:32px 20px 26px; }
      h1 { font-size:28px; }
      .desc { font-size:13px; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="badge">
      <span class="dot"></span>
      GONOGO™ DECISION ENGINE
    </div>

    <section class="card">
      <div class="spinner"></div>
      <h1>${esc(copy.title)}</h1>
      <p class="desc">${esc(copy.desc)}</p>

      <div class="progress">
        <div class="bar" id="bar"></div>
      </div>

      <div class="step" id="step">${esc(copy.steps[0])}</div>

      <div class="note">
        Do not close this page. Your report will open automatically.
      </div>
    </section>
  </main>

  <script>
    const steps = ${stepsJson};
    const stepEl = document.getElementById("step");
    const barEl = document.getElementById("bar");
    let index = 0;
    const widths = [18, 34, 52, 74, 92];

    const timer = setInterval(function () {
      index = Math.min(index + 1, steps.length - 1);
      stepEl.textContent = steps[index];
      barEl.style.width = widths[index] + "%";
      if (index >= steps.length - 1) clearInterval(timer);
    }, 1100);

    setTimeout(function () {
      window.location.replace(${JSON.stringify(targetUrl)});
    }, 5200);
  </script>
</body>
</html>`
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

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "0mm",
                right: "0mm",
                bottom: "0mm",
                left: "0mm",
            },
        })

        return pdfBuffer
    } finally {
        await browser.close()
    }
}

app.get("/", (req, res) => {
    return res.json({
        ok: true,
        service: "GoNoGo Report Server",
        version: "2.3.0-restored-template",
    })
})

app.get("/api/health", (req, res) => {
    return res.json({
        ok: true,
        status: "healthy",
    })
})

app.get("/api/report-loading", (req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8")
    return res.send(buildLoadingHtml(req))
})

app.get("/api/debug-html", async (req, res) => {
    try {
        const language = normalizeLanguage(
            req.query.lang || req.query.language || "ko"
        )

        const reportType = req.query.reportType === "paid" ? "paid" : "free"

        const brandName = req.query.brandName || "SampleBrand"
        const productService =
            req.query.productService || "A new product or service idea"
        const targetCustomer =
            req.query.targetCustomer || "Target customers for this business"

        const locale = loadLocale(language)

        const report = await generateDeepReportJson({
            brandName,
            productService,
            targetCustomer,
            language,
            reportType,
        })

        const finalReport =
            reportType === "free"
                ? buildFreeReportFromPaidReport(report)
                : {
                      ...report,
                      isPaid: true,
                      reportMode: "paid",
                  }

        const html = buildHtmlFromTemplate(finalReport, locale)

        console.log("🌍 LANG:", language)
        console.log("[REPORT_TYPE]", reportType)
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

        const report = await generateDeepReportJson({
            brandName,
            productService,
            targetCustomer,
            language: normalizedLanguage,
            reportType: normalizedReportType,
        })

        const finalReport =
            normalizedReportType === "paid"
                ? {
                      ...report,
                      isPaid: true,
                      reportMode: "paid",
                  }
                : buildFreeReportFromPaidReport(report)

        const html = buildHtmlFromTemplate(finalReport, locale)

        if (req.query.format === "html" || req.body?.format === "html") {
            res.setHeader("Content-Type", "text/html; charset=utf-8")
            return res.send(html)
        }

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
app.get("/api/dev-create-paid-token", (req, res) => {
    const language = normalizeLanguage(req.query.lang || "ko")

    const token = createPaidDownloadToken({
        language,
        brandName: req.query.brandName || "PaidReport",
        productService:
            req.query.productService || "A paid business report",
        targetCustomer: req.query.targetCustomer || "Target customers",
    })

    const downloadUrl = `${req.protocol}://${req.get(
        "host"
    )}/api/download-paid-pdf?token=${encodeURIComponent(token)}`

    res.setHeader("Content-Type", "text/html; charset=utf-8")
    return res.send(`
<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      margin:0;
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      font-family:Inter,system-ui,sans-serif;
      background:#f7faf8;
      color:#0D2418;
      padding:24px;
    }
    .box {
      max-width:420px;
      background:#fff;
      border:1px solid rgba(13,36,24,0.12);
      border-radius:28px;
      padding:28px;
      box-shadow:0 28px 80px rgba(13,36,24,0.10);
      text-align:center;
    }
    h1 {
      margin:0 0 12px;
      font-size:30px;
      line-height:1.05;
      letter-spacing:-0.05em;
    }
    p {
      margin:0 0 20px;
      color:#53645A;
      line-height:1.6;
      font-weight:650;
    }
    a {
      display:block;
      text-decoration:none;
      color:#fff;
      background:#0D2418;
      padding:16px 18px;
      border-radius:14px;
      font-weight:950;
    }
  </style>
</head>
<body>
  <div class="box">
    <h1>Paid token created</h1>
    <p>PayPal 연결 전 테스트용 다운로드 링크야. 다운로드 가능 횟수는 3회야.</p>
    <a href="${esc(downloadUrl)}">Download Paid PDF</a>
  </div>
</body>
</html>
`)
})

app.get("/api/download-paid-pdf", async (req, res) => {
    try {
        const token = req.query.token
        const validation = validatePaidDownloadToken(token)

        if (!validation.ok) {
            return res.status(validation.status).send(`
<!doctype html>
<html>
<body style="font-family:Arial;padding:40px;">
  <h1>Download unavailable</h1>
  <p>${esc(validation.message)}</p>
</body>
</html>
`)
        }

        validation.record.downloadCount += 1

        const payload = validation.record.payload || {}
        const language = normalizeLanguage(payload.language || "ko")
        const locale = loadLocale(language)

        const report = await generateDeepReportJson({
            brandName: payload.brandName || "PaidReport",
            productService:
                payload.productService || "A paid business report",
            targetCustomer: payload.targetCustomer || "Target customers",
            language,
            reportType: "paid",
        })

        const finalReport = {
            ...report,
            isPaid: true,
            reportMode: "paid",
        }

        const html = buildHtmlFromTemplate(finalReport, locale)
        const pdfBuffer = await htmlToPdf(html)

        const safeBrand = sanitizeFileName(
            finalReport?.cover?.brandName || "PaidReport"
        )

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Length", pdfBuffer.length)
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="GoNoGo_Paid_Report_${safeBrand}_${language}.pdf"`
        )

        return res.end(pdfBuffer)
    } catch (error) {
        console.error("[DOWNLOAD_PAID_PDF_ERROR]", error)
        return res.status(500).send("Failed to download paid PDF.")
    }
})

app.listen(PORT, () => {
    console.log(`GoNoGo server running on port ${PORT}`)
})
