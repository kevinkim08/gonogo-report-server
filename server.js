// =========================================================
// [01] IMPORTS
// =========================================================

import express from "express"
import cors from "cors"
import crypto from "crypto"
import OpenAI from "openai"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import puppeteer from "puppeteer-core"
import chromium from "@sparticuz/chromium"

// =========================================================
// [02] APP INITIALIZATION
// =========================================================

const app = express()
const PORT = process.env.PORT || 3000

app.set("trust proxy", true)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =========================================================
// [03] MIDDLEWARE
// =========================================================

app.use(express.json({ limit: "5mb" }))
app.use(
    "/fonts",
    express.static(path.join(__dirname, "fonts"))
)

app.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
)

// preflight 요청 처리
app.options("*", cors())

// =========================================================
// [04] OPENAI CLIENT
// =========================================================

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

// =========================================================
// [05] PAID DOWNLOAD TOKEN SYSTEM
// =========================================================

const paidDownloadTokens = new Map()

function createPaidDownloadToken() {
    const token = crypto.randomBytes(24).toString("hex")

    paidDownloadTokens.set(token, {
        paid: true,
        downloadLimit: 1,
        downloadCount: 0,
        used: false,
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })

    return token
}

function validatePaidDownloadToken(token) {
    if (!token) {
        return {
            ok: false,
            status: 401,
            message: "Missing download token.",
        }
    }

    const record = paidDownloadTokens.get(token)

    if (!record || !record.paid) {
        return {
            ok: false,
            status: 403,
            message: "Invalid payment token.",
        }
    }

    if (Date.now() > record.expiresAt) {
        return {
            ok: false,
            status: 403,
            message: "This download link has expired.",
        }
    }

    if (record.used === true) {
        return {
            ok: false,
            status: 403,
            message: "This download link has already been used.",
        }
    }

    if (record.downloadCount >= record.downloadLimit) {
        return {
            ok: false,
            status: 403,
            message: "Download limit exceeded.",
        }
    }

    return { ok: true, record }
}

// =========================================================
// [06] BASIC ROUTES
// =========================================================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "GoNoGo Report Server",
        version: "2.2.0-multilingual-pdf",
    })
})

app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        status: "healthy",
    })
})

// =========================================================
// [07] REPORT LOADING PAGE
// =========================================================

app.get("/api/report-loading", (req, res) => {
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
            note: "페이지를 닫지 마. 보고서가 자동으로 열릴 거야.",
            steps: [
                "입력값 분석 중",
                "사업 구조 판단 중",
                "고객 구매 가능성 계산 중",
                "시장·경쟁 리스크 확인 중",
                "수익 구조와 실행 조건 정리 중",
                "브랜딩 방향 생성 중",
                "최종 Go / No-Go 판단 생성 중",
            ],
        },
        en: {
            title: "Building your decision report",
            desc: "Analyzing market risk, customer logic, profit structure, and execution signals.",
            note: "Do not close this page. Your report will open automatically.",
            steps: [
                "Analyzing input",
                "Structuring business logic",
                "Checking customer buying logic",
                "Mapping market and competition risk",
                "Calculating profit structure",
                "Building brand direction",
                "Generating your Go / No-Go decision",
            ],
        },
        ja: {
            title: "レポートを生成しています",
            desc: "市場リスク、顧客心理、収益構造、実行可能性を分析しています。",
            note: "このページを閉じないでください。レポートは自動で開きます。",
            steps: [
                "入力内容を分析中",
                "事業構造を判断中",
                "顧客の購入理由を確認中",
                "市場と競合リスクを確認中",
                "収益構造を整理中",
                "ブランド方向性を生成中",
                "Go / No-Go 判断を生成中",
            ],
        },
        zh: {
            title: "正在生成决策报告",
            desc: "正在分析市场风险、客户购买逻辑、盈利结构和执行条件。",
            note: "请不要关闭此页面。报告将自动打开。",
            steps: [
                "正在分析输入内容",
                "正在判断商业结构",
                "正在检查客户购买逻辑",
                "正在检查市场与竞争风险",
                "正在整理盈利结构",
                "正在生成品牌方向",
                "正在生成 Go / No-Go 判断",
            ],
        },
        mn: {
            title: "Тайлан боловсруулж байна",
            desc: "Зах зээлийн эрсдэл, хэрэглэгчийн логик, ашигт ажиллагаа, хэрэгжүүлэх боломжийг шинжилж байна.",
            note: "Энэ хуудсыг битгий хаагаарай. Тайлан автоматаар нээгдэнэ.",
            steps: [
                "Оролтын мэдээллийг шинжилж байна",
                "Бизнесийн бүтцийг үнэлж байна",
                "Хэрэглэгчийн худалдан авах шалтгааныг шалгаж байна",
                "Зах зээл ба өрсөлдөөний эрсдэлийг тооцож байна",
                "Ашгийн бүтцийг боловсруулж байна",
                "Брэндийн чиглэлийг боловсруулж байна",
                "Go / No-Go шийдвэр гаргаж байна",
            ],
        },
    }

    const copy = loadingCopy[lang] || loadingCopy.en
    const stepsJson = JSON.stringify(copy.steps)

    res.setHeader("Content-Type", "text/html; charset=utf-8")

    return res.send(`
<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="UTF-8">
${getPdfFontLinks()}
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(copy.title)}</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    min-height: 100vh;
    background:
        radial-gradient(circle at 20% 18%, rgba(182,255,90,0.18), transparent 28%),
        radial-gradient(circle at 80% 82%, rgba(13,36,24,0.08), transparent 32%),
        #ffffff;
    color: #0D2418;
    font-family: ${getPdfFontFamily(lang)};
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px;
    overflow: hidden;
}

.wrap {
    width: 100%;
    max-width: 460px;
    text-align: center;
}

.badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 13px;
    border: 1px solid rgba(13,36,24,0.12);
    border-radius: 999px;
    background: rgba(255,255,255,0.74);
    backdrop-filter: blur(12px);
    font-size: 12px;
    font-weight: 950;
    margin-bottom: 30px;
    box-shadow: 0 12px 32px rgba(13,36,24,0.05);
}

.dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #B6FF5A;
    box-shadow: 0 0 18px rgba(182,255,90,0.9);
}

.card {
    background: rgba(255,255,255,0.84);
    border: 1px solid rgba(13,36,24,0.12);
    border-radius: 30px;
    padding: 34px 24px 28px;
    box-shadow:
        0 30px 90px rgba(13,36,24,0.10),
        inset 0 1px 0 rgba(255,255,255,0.9);
    backdrop-filter: blur(18px);
}

.spinner {
    width: 52px;
    height: 52px;
    border: 4px solid rgba(13,36,24,0.12);
    border-top-color: #0D2418;
    border-radius: 50%;
    margin: 0 auto 24px;
    animation: spin 0.85s linear infinite;
}

h1 {
    margin: 0 0 12px;
    font-size: 31px;
    line-height: 1.04;
    letter-spacing: -0.065em;
    font-weight: 950;
}

.desc {
    margin: 0 auto 26px;
    max-width: 350px;
    color: #53645A;
    font-size: 14px;
    line-height: 1.65;
    font-weight: 650;
}

.progress {
    height: 10px;
    width: 100%;
    background: #E5EDE8;
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 14px;
}

.bar {
    height: 100%;
    width: 8%;
    background: #0D2418;
    border-radius: 999px;
    transition: width 0.45s ease;
}

.progress-top {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 10px;
    font-size: 12px;
    font-weight: 900;
    color: #0D2418;
}

.step {
    min-height: 22px;
    color: #0D2418;
    font-size: 13px;
    font-weight: 900;
    letter-spacing: -0.02em;
}

.note {
    margin-top: 22px;
    font-size: 11px;
    line-height: 1.5;
    color: #7B8B82;
    font-weight: 700;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

@media (max-width: 480px) {
    body {
        padding: 18px;
        align-items: flex-start;
        padding-top: 78px;
    }

    .card {
        border-radius: 26px;
        padding: 32px 20px 26px;
    }

    h1 {
        font-size: 28px;
    }

    .desc {
        font-size: 13px;
    }
}
</style>
</head>

<body>
<div class="wrap">
    <div class="badge">
        <span class="dot"></span>
        GoNoGo™ Report Engine
    </div>

    <section class="card">
        <div class="spinner"></div>

        <h1>${esc(copy.title)}</h1>
        <p class="desc">${esc(copy.desc)}</p>

        <div class="progress-top">
            <span id="step">${esc(copy.steps[0])}</span>
            <span id="percent">0%</span>
        </div>

        <div class="progress">
            <div class="bar" id="bar"></div>
        </div>

        <div class="note">
            ${esc(copy.note)}
        </div>
    </section>
</div>

<script>
const steps = ${stepsJson};
const bar = document.getElementById("bar");
const step = document.getElementById("step");
const percent = document.getElementById("percent");

let index = 0;
let progress = 0;

const timer = setInterval(() => {
    progress = Math.min(progress + 14, 98);

    const nextIndex = Math.min(
        Math.floor((progress / 100) * steps.length),
        steps.length - 1
    );

    if (nextIndex !== index) {
        index = nextIndex;
        if (step) step.textContent = steps[index];
    }

    if (bar) bar.style.width = progress + "%";
    if (percent) percent.textContent = progress + "%";

    if (progress >= 98) {
        clearInterval(timer);

        setTimeout(() => {
            window.location.href = "${targetUrl}";
        }, 700);
    }
}, 650);
</script>
</body>
</html>
`)
})

// =========================================================
// [08] DEBUG HTML ROUTE
// =========================================================

app.get("/api/debug-html", async (req, res) => {
    try {
        const language = normalizeLanguage(req.query.lang || req.query.language || "ko")
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

        const finalReport = {
            ...paidReport,
            isPaid: reportType === "paid",
            reportMode: reportType === "free" ? "free" : "paid",
        }

        const html = buildHtmlFromTemplate(finalReport, locale)

        console.log("🌍 LANG:", language)
        console.log("[DEBUG_HTML_TYPE]", reportType)
        console.log("[DEBUG_HTML_MODE]", finalReport.reportMode)
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


function getPdfFontLinks() {
    return `
<style>

@font-face {
    font-family: "GoNoGoKR";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansKR-Regular.ttf") format("truetype");
    font-weight: 400;
}

@font-face {
    font-family: "GoNoGoKR";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansKR-Bold.ttf") format("truetype");
    font-weight: 700;
}

@font-face {
    font-family: "GoNoGoJP";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansJP-Regular.ttf") format("truetype");
    font-weight: 400;
}

@font-face {
    font-family: "GoNoGoJP";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansJP-Bold.ttf") format("truetype");
    font-weight: 700;
}

@font-face {
    font-family: "GoNoGoSC";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansSC-Regular.ttf") format("truetype");
    font-weight: 400;
}

@font-face {
    font-family: "GoNoGoSC";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansSC-Bold.ttf") format("truetype");
    font-weight: 700;
}

@font-face {
    font-family: "GoNoGoMN";
    src: url("https://gonogo-report-server.onrender.com/fonts/NotoSansMongolian-Regular.ttf") format("truetype");
    font-weight: 400;
}

</style>
`
}

function getPdfFontFamily(lang) {

    if (lang === "ko") {
        return `"GoNoGoKR", Arial, sans-serif`
    }

    if (lang === "ja") {
        return `"GoNoGoJP", Arial, sans-serif`
    }

    if (lang === "zh") {
        return `"GoNoGoSC", Arial, sans-serif`
    }

    if (lang === "mn") {
        return `"GoNoGoMN", Arial, sans-serif`
    }

    return `"GoNoGoKR", Arial, sans-serif`
}
// =========================================================
// [09] GENERATE REPORT PDF ROUTE
// =========================================================

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

        const finalReport = {
            ...paidReport,
            isPaid: normalizedReportType === "paid",
            reportMode: normalizedReportType === "free" ? "free" : "paid",
        }

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

// =========================================================
// [10] DEV PAID TOKEN ROUTE
// =========================================================

app.get("/api/dev-create-paid-token", async (req, res) => {
    try {
        const lang = normalizeLanguage(req.query.lang || "ko")

        const brandName = req.query.brandName || "TEST"
        const productService =
            req.query.productService || "AI Fashion Platform"

        const targetCustomer =
            req.query.targetCustomer || "Fashion Brands"

        const token = createPaidDownloadToken({
            brandName,
            productService,
            targetCustomer,
            lang,
        })

        const params = new URLSearchParams({
            token,
            lang,
            brandName,
            productService,
            targetCustomer,
        })

        const baseUrl =
            process.env.PUBLIC_BASE_URL ||
            `https://${req.get("host")}`

        const downloadUrl =
            `${baseUrl}/api/download-paid-pdf?${params.toString()}`

        const tokenPageCopy = {
            ko: {
                title: "유료 다운로드 토큰 생성 완료",
                desc: "테스트용 유료 PDF 다운로드 페이지야.",
                limit: "다운로드 가능 횟수: 1회",
                button: "유료 PDF 다운로드",
                loading: "PDF를 생성하고 있어. 잠시만 기다려줘.",
                complete: "PDF 다운로드가 시작됐어.",
                redirect: "사이트로 이동 중이야.",
                progressSteps: [
                    "입력값 분석 중",
                    "사업 구조 판단 중",
                    "브랜딩 전략 생성 중",
                    "시장·고객 분석 중",
                    "보고서 페이지 구성 중",
                    "PDF 렌더링 중",
                    "다운로드 준비 중",
                ],
            },

            en: {
                title: "Paid token created",
                desc: "This is a test paid PDF download page.",
                limit: "Download limit: 1 time",
                button: "Download Paid PDF",
                loading: "Creating your PDF. Please wait.",
                complete: "PDF download started.",
                redirect: "Redirecting to the site.",
                progressSteps: [
                    "Analyzing input",
                    "Structuring business logic",
                    "Building brand strategy",
                    "Analyzing market and customers",
                    "Composing report pages",
                    "Rendering PDF",
                    "Preparing download",
                ],
            },

            ja: {
                title: "有料ダウンロードトークン作成完了",
                desc: "テスト用の有料PDFダウンロードページです。",
                limit: "ダウンロード可能回数：1回",
                button: "有料PDFをダウンロード",
                loading: "PDFを生成しています。",
                complete: "PDFのダウンロードが開始されました。",
                redirect: "サイトへ移動しています。",
                progressSteps: [
                    "入力内容を分析中",
                    "事業構造を分析中",
                    "ブランド戦略を生成中",
                    "市場と顧客を分析中",
                    "レポートページを構成中",
                    "PDFをレンダリング中",
                    "ダウンロードを準備中",
                ],
            },

            zh: {
                title: "付费下载令牌已创建",
                desc: "这是测试用的付费 PDF 下载页面。",
                limit: "可下载次数：1次",
                button: "下载付费 PDF",
                loading: "正在生成 PDF，请稍候。",
                complete: "PDF 下载已开始。",
                redirect: "正在跳转到网站。",
                progressSteps: [
                    "正在分析输入内容",
                    "正在分析商业结构",
                    "正在生成品牌策略",
                    "正在分析市场与客户",
                    "正在构建报告页面",
                    "正在渲染 PDF",
                    "正在准备下载",
                ],
            },

            mn: {
                title: "Төлбөртэй татах токен үүслээ",
                desc: "Туршилтын төлбөртэй PDF татах хуудас.",
                limit: "Татах боломж: 1 удаа",
                button: "Төлбөртэй PDF татах",
                loading: "PDF үүсгэж байна.",
                complete: "PDF таталт эхэллээ.",
                redirect: "Сайт руу шилжиж байна.",
                progressSteps: [
                    "Оролтын мэдээллийг шинжилж байна",
                    "Бизнесийн бүтцийг шинжилж байна",
                    "Брэндийн стратеги боловсруулж байна",
                    "Зах зээл ба хэрэглэгчийг шинжилж байна",
                    "Тайлангийн хуудсуудыг бэлтгэж байна",
                    "PDF үүсгэж байна",
                    "Татахад бэлдэж байна",
                ],
            },
        }

        const copy =
            tokenPageCopy[lang] || tokenPageCopy.ko

        return res.send(`
<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />

<title>${esc(copy.title)}</title>

<style>

body{
    margin:0;
    background:#ffffff;
    color:#111111;
    font-family:${getPdfFontFamily(lang)};
    display:flex;
    align-items:center;
    justify-content:center;
    min-height:100vh;
}

.wrap{
    width:100%;
    max-width:560px;
    padding:40px;
    text-align:center;
}

h1{
    font-size:32px;
    margin-bottom:14px;
}

.desc{
    opacity:.7;
    line-height:1.6;
    margin-bottom:10px;
}

.limit{
    font-size:14px;
    opacity:.5;
    margin-bottom:28px;
}

button{
    width:100%;
    border:none;
    background:#111;
    color:#fff;
    padding:18px;
    border-radius:18px;
    font-size:16px;
    cursor:pointer;
}

button.loading{
    opacity:.7;
    cursor:wait;
}

.loading-note{
    margin-top:18px;
    font-size:14px;
    opacity:.65;
}

.progress-wrap{
    width:100%;
    margin-top:26px;
    display:none;
}

.progress-wrap.active{
    display:block;
}

.progress-bar{
    width:100%;
    height:12px;
    border-radius:999px;
    background:#ececec;
    overflow:hidden;
}

.progress-fill{
    width:0%;
    height:100%;
    background:#111;
    transition:width .4s ease;
}

.progress-info{
    display:flex;
    justify-content:space-between;
    margin-top:10px;
    font-size:13px;
    opacity:.65;
}

.progress-step{
    margin-top:12px;
    font-size:14px;
    opacity:.8;
}

</style>
</head>

<body>

<div class="wrap">

    <h1>${esc(copy.title)}</h1>

    <div class="desc">
        ${esc(copy.desc)}
    </div>

    <div class="limit">
        ${esc(copy.limit)}
    </div>

    <button id="downloadBtn">
        <span id="buttonText">
            ${esc(copy.button)}
        </span>
    </button>

    <div class="loading-note" id="loadingNote"></div>

    <div class="progress-wrap" id="progressWrap">

        <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
        </div>

        <div class="progress-info">
            <span id="progressPercent">0%</span>
        </div>

        <div class="progress-step" id="progressStep"></div>

    </div>

</div>

<script>

const downloadUrl = ${JSON.stringify(downloadUrl)};
const siteUrl = ${JSON.stringify(process.env.PUBLIC_SITE_URL || "https://gonogo.so")};

const loadingText = ${JSON.stringify(copy.loading)};
const completeText = ${JSON.stringify(copy.complete)};
const redirectText = ${JSON.stringify(copy.redirect)};
const progressSteps = ${JSON.stringify(copy.progressSteps)};
const defaultButtonText = ${JSON.stringify(copy.button)};

const fileName =
${JSON.stringify(`GoNoGo_Paid_Report_${lang}.pdf`)};

const btn = document.getElementById("downloadBtn");
const buttonText = document.getElementById("buttonText");
const loadingNote = document.getElementById("loadingNote");

const progressWrap =
document.getElementById("progressWrap");

const progressFill =
document.getElementById("progressFill");

const progressPercent =
document.getElementById("progressPercent");

const progressStep =
document.getElementById("progressStep");

let progress = 0;
let stepIndex = 0;
let timer = null;

function startFakeProgress(){

    progressWrap.classList.add("active");

    progressStep.textContent =
        progressSteps[0] || loadingText;

    progressPercent.textContent = "0%";
    progressFill.style.width = "0%";

    timer = setInterval(() => {

        if(progress < 92){
            progress +=
                Math.floor(Math.random() * 5) + 2

            progress = Math.min(progress, 92)
        }

        const nextStepIndex = Math.min(
            Math.floor(
                (progress / 100) * progressSteps.length
            ),
            progressSteps.length - 1
        )

        if(nextStepIndex !== stepIndex){
            stepIndex = nextStepIndex

            progressStep.textContent =
                progressSteps[stepIndex] || loadingText
        }

        progressPercent.textContent =
            progress + "%"

        progressFill.style.width =
            progress + "%"

    }, 800)
}

function completeProgress(){

    if(timer){
        clearInterval(timer)
    }

    progressPercent.textContent = "100%"
    progressFill.style.width = "100%"

    progressStep.textContent = completeText
    loadingNote.textContent = redirectText

    btn.classList.remove("loading")

    buttonText.textContent = completeText

    setTimeout(() => {
        window.location.href = siteUrl
    }, 1800)
}

function failProgress(message){

    if(timer){
        clearInterval(timer)
    }

    btn.disabled = false
    btn.classList.remove("loading")

    buttonText.textContent =
        defaultButtonText

    loadingNote.textContent =
        message || "PDF download failed."

    progressStep.textContent =
        message || "Download failed"
}

btn.addEventListener("click", async () => {

    try{

        btn.disabled = true
        btn.classList.add("loading")

        buttonText.textContent = loadingText
        loadingNote.textContent = loadingText

        startFakeProgress()

        const response = await fetch(downloadUrl,{
            method:"GET",
            cache:"no-store",
        })

        if(!response.ok){

            const errorText =
                await response.text()

            throw new Error(
                errorText || "Download failed"
            )
        }

        const blob =
            await response.blob()

        if(!blob || blob.size === 0){
            throw new Error("Empty PDF file.")
        }

        const blobUrl =
            window.URL.createObjectURL(blob)

        const a =
            document.createElement("a")

        a.href = blobUrl
        a.download = fileName

        document.body.appendChild(a)

        a.click()

        setTimeout(() => {

            a.remove()

            window.URL.revokeObjectURL(blobUrl)

            completeProgress()

        }, 300)

    }catch(error){

        console.error(
            "[PDF_DOWNLOAD_CLIENT_ERROR]",
            error
        )

        failProgress(
            "PDF download failed. Please try again."
        )
    }
})

</script>

</body>
</html>
`)
    } catch (error) {
        console.error("[DEV_CREATE_PAID_TOKEN_ERROR]", error)

        return res.status(500).send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Error</title>
</head>
<body style="font-family:Arial;padding:40px;">
<h1>Failed to create paid token</h1>
<pre>${esc(error?.message || String(error))}</pre>
</body>
</html>
`)
    }
})

// =========================================================
// [11] DOWNLOAD PAID PDF ROUTE
// =========================================================

app.get("/api/download-paid-pdf", async (req, res) => {
    try {
        const { token } = req.query
        const language = normalizeLanguage(req.query.lang || "ko")

        const validation = validatePaidDownloadToken(token)

        if (!validation.ok) {
            return res.status(validation.status).send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Download unavailable</title>
</head>
<body style="font-family:Arial;padding:40px;">
    <h1>Download unavailable</h1>
    <p>${esc(validation.message)}</p>
</body>
</html>
`)
        }

        const brandName = req.query.brandName || "PaidReport"
        const productService =
            req.query.productService || "A paid business report"
        const targetCustomer =
            req.query.targetCustomer || "Target customers"

        const locale = loadLocale(language)

        const paidReport = await generateDeepReportJson({
            brandName,
            productService,
            targetCustomer,
            language,
        })

        const finalReport = {
            ...paidReport,
            isPaid: true,
            reportMode: "paid",
        }

        const html = buildHtmlFromTemplate(finalReport, locale)
        const pdfBuffer = await htmlToPdf(html)

        validation.record.downloadCount += 1
        validation.record.used = true

        const safeBrand = sanitizeFileName(brandName)

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Length", pdfBuffer.length)
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="GoNoGo_Paid_Report_${safeBrand}_${language}.pdf"`
        )

        return res.end(pdfBuffer)
    } catch (error) {
        console.error("[DOWNLOAD_PAID_PDF_ERROR]", error)

        return res.status(500).send(`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Download failed</title>
</head>
<body style="font-family:Arial;padding:40px;">
    <h1>Download failed</h1>
    <p>Failed to download paid PDF.</p>
    <pre>${esc(error?.message || String(error))}</pre>
</body>
</html>
`)
    }
})
// =========================================================
// [13] PAID REPORT PROMPT JSON SHAPE
// =========================================================

const PAID_REPORT_JSON_SHAPE = `
{
  "cover": {
    "brandName": "",
    "decision": "GO | HOLD | NO GO",
    "score": 0,
    "subtitle": "",
    "oneLineVerdict": ""
  },

  "brandNaming": {
    "brandDirection": "",
    "namingStrategy": "",
    "keywords": ["", "", "", "", "", "", "", ""],
    "nameCandidates": [
      {
        "name": "",
        "meaning": "",
        "fit": "",
        "risk": "",
        "score": 0
      },
      {
        "name": "",
        "meaning": "",
        "fit": "",
        "risk": "",
        "score": 0
      },
      {
        "name": "",
        "meaning": "",
        "fit": "",
        "risk": "",
        "score": 0
      },
      {
        "name": "",
        "meaning": "",
        "fit": "",
        "risk": "",
        "score": 0
      },
      {
        "name": "",
        "meaning": "",
        "fit": "",
        "risk": "",
        "score": 0
      }
    ],
    "recommendedName": {
      "name": "",
      "reason": "",
      "positioning": "",
      "expansionPotential": ""
    },
    "domainSuggestions": [
      {
        "domain": "",
        "reason": "",
        "availability": "HIGH | MEDIUM | LOW"
      },
      {
        "domain": "",
        "reason": "",
        "availability": "HIGH | MEDIUM | LOW"
      },
      {
        "domain": "",
        "reason": "",
        "availability": "HIGH | MEDIUM | LOW"
      },
      {
        "domain": "",
        "reason": "",
        "availability": "HIGH | MEDIUM | LOW"
      },
      {
        "domain": "",
        "reason": "",
        "availability": "HIGH | MEDIUM | LOW"
      }
    ]
  },

  "glossary": [
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    },
    {
      "term": "",
      "meaning": "",
      "whyItMatters": ""
    }
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
    {
      "label": "TAM",
      "value": "",
      "score": 100
    },
    {
      "label": "SAM",
      "value": "",
      "score": 60
    },
    {
      "label": "SOM",
      "value": "",
      "score": 20
    }
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
    {
      "label": "CAC",
      "status": "PASS | WATCH | FAIL"
    },
    {
      "label": "Conversion",
      "status": "PASS | WATCH | FAIL"
    },
    {
      "label": "Repeat Purchase",
      "status": "PASS | WATCH | FAIL"
    },
    {
      "label": "Margin",
      "status": "PASS | WATCH | FAIL"
    }
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
  ]
}
`
// =========================================================
// [14] PAID REPORT PROMPT TAIL
// =========================================================

function buildPaidReportPromptTail() {
    return `
Glossary rules:

Explain important business terms used in the report.

Include terms such as TAM, SAM, SOM, CAC, LTV, AOV, Margin, Retention, Conversion when relevant.

Meanings must be simple enough for a non-expert founder.

whyItMatters must explain how the term affects the business decision.

Business diagnosis rules:

Classify the business industry type.

Classify the business model type.

Explain country-specific buying behavior.

Identify the biggest bottleneck.

Recommend the best first offer.

Define the first validation experiment.

Data confidence rules:

Explain how reliable the market and unit economics assumptions are.

Separate public data, platform observations, and assumptions.

Clearly state what is uncertain.

Do not pretend exact data exists when it does not.

Reference links rules:

referenceLinks must contain relevant sources for the selected country, industry, and business model.

Each row must contain: Source name, URL.

Use official statistics, market platforms, trend tools, or industry-specific sources when relevant.

Do not use fixed pet, food, ecommerce, or Korea-only sources unless they match the user's business input.

Sensitivity analysis rules:

Show how the business changes when CAC rises or LTV falls.

cacLtvTable columns must be: Scenario, CAC, LTV, Decision.

criticalBreakPoint must explain the point where the business becomes unprofitable.

founderWarning must be direct and practical.

Profit simulation rules:

monthlyScenarioTable columns must be: Scenario, Customers, Revenue, Marketing Cost, Estimated Profit, Judgment.

Use realistic monthly customer acquisition assumptions.

Include marketing cost, gross margin, fulfillment cost if relevant.

breakEvenPoint must explain when the business starts making money.

profitJudgment must clearly say whether this business can make money.

cashRisk must explain the cashflow risk for the founder.

Kill criteria rules:

Define measurable stop conditions.

Rules columns must be: Metric, Kill Line, Action.

Include CAC, conversion rate, repeat purchase, margin, refund/churn when relevant.

stopDecision must say when to stop.

pivotDecision must say when to change offer/model.

scaleDecision must say when to increase budget.

Calculation rules:

TAM must describe the total reachable category demand.

SAM must narrow TAM to the country/channel/customer segment.

SOM must be a realistic first 12-month obtainable market.

Unit economics must include CAC, AOV, LTV, repeat purchase, margin, and payback.

LTV/CAC must be calculated logically.

Marketing channels must match the selected country.

Execution plan must be actionable within 30 days.

GO threshold must define measurable pass/fail criteria.

Appendix must include assumed data sources and assumptions.

Scoring logic:

Market score: demand size + urgency + accessibility.

Profitability score: margin + LTV/CAC + repeat purchase potential.

Execution score: founder feasibility + launch cost + operational complexity.

Risk score: higher number means higher risk pressure.

Overall cover.score should reflect weighted judgment.

Decision logic:

GO: score 75+, strong demand, viable unit economics.

HOLD: score 50-74, needs validation.

NO GO: below 50, weak economics or market access.

Now generate the JSON report.
`
}
// =========================================================
// [15] FINAL PROMPT BUILDER MERGE
// =========================================================

function buildPaidReportPrompt({
    brandName,
    productService,
    targetCustomer,
    language,
}) {
    const languageName = getLanguageName(language)

    const promptHead = `
You are GoNoGo, a ruthless business decision engine.

You are NOT a writer.
You are NOT a generic consultant.
You are a paid business decision report engine.

Your job:
Evaluate this business idea and generate a premium PDF-ready JSON report.

Final report language: ${languageName}

Business Input:

Brand Name: ${brandName}

Product / Service: ${productService}

Target Customer: ${targetCustomer}

Language / Market: ${language}

Critical rules:

Output VALID JSON only.
No markdown.
No explanation outside JSON.
Use the exact JSON shape provided below.
Do not use placeholders.
Every table cell must contain real content.
Use realistic assumptions when exact data is unavailable.
Clearly state assumptions in appendix.
Use country-specific market logic.
Be conservative, not optimistic.
If the business is weak, say it clearly.
All scores must be numbers from 0 to 100.
Keep table cells concise but meaningful.
Make the report directly useful for founder decision-making.
You must return every field in the exact JSON structure.
Never omit required keys.
Never rename keys.
Never add new top-level keys.
Every array must keep the required number of rows.
Every table row must keep the required number of columns.
If data is uncertain, write a conservative assumption instead of leaving it blank.
Do not use null.
Do not use undefined.
Do not use empty strings unless the field is truly impossible.
Keep all table cells short and layout-safe.
This rule applies ONLY to table cells.
Narrative fields must be deeper and more informative.
Escape all double quotes inside string values.
Do not use unescaped quotation marks inside any JSON string.
Do not use line breaks inside JSON string values.
Do not use trailing commas.
Every string value must be valid JSON-safe text.

Layout safety rules:

Table cells must be short.
Each table cell should be 8 to 18 words maximum in English.
For Japanese, Chinese, and Mongolian, keep table cells shorter than English.
Do not write full paragraphs inside table cells.
Long explanations must go only into text fields such as marketInsight, buyingTrigger, economicsJudgment, modelJudgment, operatingRule, finalRule, founderWarning.
Do not put line breaks inside table cells.
Do not use very long compound phrases inside table cells.
Avoid repeating the same sentence across multiple cells.
Numbers, ranges, and decisions should be concise.
Use clear, founder-friendly wording.

Narrative depth rules (CRITICAL):

customerSummary:

3 to 4 sentences
Summarize both positive buying signals and negative hesitation signals.
Explain what actually makes the customer buy.
Explain what blocks the customer from buying.
End with the most important validation point.
The report must not feel shallow.
Narrative fields are the core of decision quality.

structureSummary:

3 to 4 sentences
Rewrite the business diagnosis table into a connected business story.
Explain how the business actually operates in reality.
Include business type, revenue model, entry difficulty, bottleneck, and validation logic.
For the following fields, write deeper, structured explanations:

marketInsight:

3 to 4 sentences
Explain: market structure → limitation → real opportunity → strategic implication

economicsJudgment:

3 to 4 sentences
Explain: cost structure → CAC pressure → margin reality → survival condition

modelJudgment:

3 to 4 sentences
Explain: why this model works or fails → structural weakness → how to fix

modelDeepDive:

3 to 5 sentences
Explain the deeper business model mechanics.
Cover revenue logic, repeat purchase or retention logic, margin pressure, operational weakness, and the best structural improvement.
This must not repeat modelJudgment.

operatingRule:

2 to 3 sentences
Must define a clear decision rule (what to track and when to stop)

profitJudgment:

3 to 4 sentences
Explain: scaling condition → risk → realistic expectation
breakEvenPoint:
2 to 3 sentences
Explain: when business becomes viable → key threshold → constraint

Additional rules:

Each explanation must include:
Cause
Business meaning
Action implication
Avoid generic phrases such as "this is important" or "this is needed"
Avoid repeating the same logic across sections
Each section must provide a different angle of insight

Brand naming rules:

brandNaming must be generated as a paid report section.
The brand name should be created from productService and targetCustomer, not only from the user's brandName input.
If brandName is empty, generic, temporary, or unclear, recommend a stronger brand name.
Generate names that are short, memorable, easy to pronounce, and commercially usable.
Avoid generic names such as Best, Smart, Premium, Global, Shop, Store, Solution, Service.
Avoid names that are too narrow unless the business requires a niche identity.
Prefer names that can expand into future products, categories, or markets.
Naming must reflect customer desire, category signal, trust, and differentiation.
For ko, names may be Korean, English, or hybrid depending on market fit.
For en, prefer globally pronounceable English-style names.
For ja, prefer compact, trust-oriented, easy-to-read names.
For zh, prefer names that can carry meaning and social commerce appeal.
For mn, prefer simple, practical, easy-to-remember names.
Domain suggestions are strategic recommendations only.
Do not claim real-time domain availability.
availability must mean estimated likelihood only: HIGH | MEDIUM | LOW.
domainSuggestions must avoid trademark-sensitive famous brand terms.

brandNaming:

brandDirection must explain the strategic naming direction in 3 to 4 sentences.
namingStrategy must explain the naming logic, positioning angle, and why it fits the customer.
keywords must contain exactly 8 short keywords.
nameCandidates must contain exactly 5 candidates.
Each nameCandidate must include name, meaning, fit, risk, and score.
score must be a number from 0 to 100.
recommendedName must choose exactly one best candidate.
domainSuggestions must contain exactly 5 domain ideas.
Each domain suggestion must include domain, reason, and availability.
domain availability is only an estimated likelihood, not a verified registration result.

Array stability rules:

glossary must contain exactly 5 items.
decisionMatrix must contain exactly 4 rows.
marketCards must contain exactly 4 rows.
marketFunnel must contain exactly 3 items: TAM, SAM, SOM.
tamSamSom must contain exactly 3 rows.
customerTruth must contain exactly 3 rows.
customerOpportunity must contain exactly 4 rows.
competitionMap must contain exactly 4 rows.
benchmarkRows must contain exactly 3 rows.
unitEconomicsCards must contain exactly 4 rows.
unitEconomicsTable must contain exactly 4 rows.
marketingStrategy.channelFit must contain exactly 4 rows.
marketingStrategy.contentPlaybook must contain exactly 5 items.
marketingStrategy.thirtyDayMarketingTest must contain exactly 12 rows and represent a 12-week / 3-month test plan.
businessModel.revenueLayers must contain exactly 3 rows.
riskSystem must contain exactly 3 rows.
executionPlan must contain exactly 3 rows.
goThreshold must contain exactly 4 rows.
goChecklist must contain exactly 4 items.
dataConfidence.sourceQuality must contain exactly 3 rows.
dataConfidence.limits must contain exactly 3 items.
sensitivityAnalysis.cacLtvTable must contain exactly 3 rows.
profitSimulation.monthlyScenarioTable must contain exactly 3 rows.
killCriteria.rules must contain exactly 4 rows.
appendix.dataSources must contain exactly 3 rows.
appendix.assumptions must contain exactly 4 items.
referenceLinks must contain exactly 5 rows.
brandNaming.keywords must contain exactly 8 items.
brandNaming.nameCandidates must contain exactly 5 items.
brandNaming.domainSuggestions must contain exactly 5 items.

Language output rules:

All user-facing values must be written in the final report language.
Do not mix Korean into English, Japanese, Chinese, or Mongolian reports.
Keep business terms such as CAC, LTV, TAM, SAM, SOM, AOV in English.
For Japanese, Chinese, and Mongolian, keep sentences compact to protect PDF layout.

Narrative tone rules:

Write like a strategy consultant, not a content writer
Be direct, specific, and decision-oriented
Avoid storytelling, focus on judgment
Each paragraph should help a founder decide "go / pivot / stop"

Country strategy rules:

ko: Korea-first. Consider Naver, Kakao, Coupang, SmartStore, Instagram, YouTube Shorts, local payment behavior, Korean price sensitivity.
en: Global / English market. Consider Google, Meta, Amazon, Shopify, TikTok, Reddit, creator ads, DTC funnel.
ja: Japan-first. Consider LINE, Rakuten, Yahoo Japan, Amazon JP, trust-heavy purchase behavior, conservative adoption.
zh: Chinese-speaking market. Consider WeChat, Xiaohongshu, Douyin, Tmall, group commerce, social proof, KOL/KOC.
mn: Mongolia-first. Consider Facebook commerce, bank transfer, offline trust, messenger sales, low-friction purchase behavior.

Important:
Your JSON must match the current HTML template structure exactly.

Return this exact JSON shape:
`

    return `${promptHead}

${PAID_REPORT_JSON_SHAPE}

${buildPaidReportPromptTail()}`
}
// =========================================================
// [16] GENERATE DEEP REPORT (OPENAI CALL)
// =========================================================


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

    let parsed

    try {
        parsed = JSON.parse(raw)
    } catch (parseError) {
        console.error("[OPENAI_JSON_PARSE_ERROR]", parseError)
        console.error("[OPENAI_JSON_RAW_START]", raw.slice(0, 1200))
        console.error("[OPENAI_JSON_RAW_ERROR_AREA]", raw.slice(8800, 9800))
        console.error("[OPENAI_JSON_RAW_END]", raw.slice(-1200))

        throw new Error(
            `OpenAI returned invalid JSON. ${String(parseError?.message || parseError)}`
        )
    }

    return normalizeDeepReport(parsed, input)
}

// =========================================================
// [17] FREE PREVIEW REPORT BUILDER
// =========================================================

// ---------------------------------------------------------
// [17-1] FREE PREVIEW PROMPT
// ---------------------------------------------------------

function buildFreePreviewPrompt(language) {
    const languageName = getLanguageName(language)

    return `
You are GoNoGo, a business decision report engine.

Create ONLY the free preview report.

Final report language: ${languageName}

The free report has exactly these pages:
1. Cover / decision board
2. Table of contents
3. How to read this report
4. Glossary and score guide
5. Business structure diagnosis
6. Paid upgrade CTA page

Return VALID JSON only.
No markdown.
Do not generate paid sections.
Do not generate marketing strategy, risk system, profit simulation, execution plan, sensitivity analysis, appendix, or full customer analysis.

Required JSON shape:

{
  "cover": {
    "brandName": "",
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
  "decisionMatrix": [
    ["MARKET", "LOW | MEDIUM | HIGH"],
    ["PROFITABILITY", "LOW | MEDIUM | HIGH"],
    ["EXECUTION", "LOW | MEDIUM | HIGH"],
    ["RISK", "LOW | MEDIUM | HIGH"]
  ],
  "unitEconomicsScore": {
    "ltvToCac": "",
    "payback": "",
    "margin": "",
    "status": "PASS | WATCH | FAIL"
  },
  "glossary": [
    { "term": "TAM", "meaning": "", "whyItMatters": "" },
    { "term": "SAM", "meaning": "", "whyItMatters": "" },
    { "term": "SOM", "meaning": "", "whyItMatters": "" },
    { "term": "CAC", "meaning": "", "whyItMatters": "" },
    { "term": "LTV", "meaning": "", "whyItMatters": "" }
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
  "freeCta": {
    "title": "",
    "message": "",
    "lockedItems": ["", "", "", "", "", ""],
    "buttonText": ""
  }
}

Rules:
- Keep the report useful and trustworthy.
- Do NOT summarize full paid sections.
- Focus on decision, glossary, and structure only.
- Be direct and conservative.
`
}

// ---------------------------------------------------------
// [17-2] GENERATE FREE PREVIEW REPORT (GPT CALL)
// ---------------------------------------------------------

async function generateFreePreviewReportJson(input) {
    const systemPrompt = buildFreePreviewPrompt(input.language)

    const userPrompt = JSON.stringify({
        brandName: input.brandName,
        productService: input.productService,
        targetCustomer: input.targetCustomer,
        language: input.language,
        reportType: "free-preview",
    })

    const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_FREE_MODEL || "gpt-4o-mini",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
    })

    const raw = completion.choices?.[0]?.message?.content

    if (!raw) throw new Error("Empty OpenAI free preview response.")

    let parsed

    try {
        parsed = JSON.parse(raw)
    } catch (parseError) {
        console.error("[FREE_PREVIEW_JSON_PARSE_ERROR]", parseError)
        console.error("[FREE_PREVIEW_JSON_RAW]", raw)

        throw new Error(
            `Invalid free preview JSON: ${String(parseError?.message || parseError)}`
        )
    }

    return normalizeFreePreviewReport(parsed, input)
}

// ---------------------------------------------------------
// [17-3] NORMALIZE FREE PREVIEW REPORT
// ---------------------------------------------------------

function normalizeFreePreviewReport(report, input) {
    return {
        cover: {
            brandName: report?.cover?.brandName || input.brandName || "",
            decision: report?.cover?.decision || "HOLD",
            score: toScore(report?.cover?.score, 50),
            subtitle: report?.cover?.subtitle || input.productService || "",
            oneLineVerdict: report?.cover?.oneLineVerdict || "",
        },

        visualScores: {
            market: toScore(report?.visualScores?.market, 50),
            profitability: toScore(report?.visualScores?.profitability, 50),
            execution: toScore(report?.visualScores?.execution, 50),
            risk: toScore(report?.visualScores?.risk, 50),
        },

        decisionMatrix: safeArray(report?.decisionMatrix, [
            ["MARKET", "MEDIUM"],
            ["PROFITABILITY", "MEDIUM"],
            ["EXECUTION", "MEDIUM"],
            ["RISK", "MEDIUM"],
        ]).slice(0, 4),

        unitEconomicsScore: {
            ltvToCac: report?.unitEconomicsScore?.ltvToCac || "",
            payback: report?.unitEconomicsScore?.payback || "",
            margin: report?.unitEconomicsScore?.margin || "",
            status: report?.unitEconomicsScore?.status || "WATCH",
        },

        glossary: safeArray(
            report?.glossary,
            getDefaultGlossary(input.language || "en")
        ).slice(0, 5),

        businessDiagnosis: {
            industryType: report?.businessDiagnosis?.industryType || "",
            businessModelType: report?.businessDiagnosis?.businessModelType || "",
            countryMarketBehavior:
                report?.businessDiagnosis?.countryMarketBehavior || "",
            marketEntryDifficulty:
                report?.businessDiagnosis?.marketEntryDifficulty || "MEDIUM",
            mainBottleneck: report?.businessDiagnosis?.mainBottleneck || "",
            bestFirstOffer: report?.businessDiagnosis?.bestFirstOffer || "",
            validationExperiment:
                report?.businessDiagnosis?.validationExperiment || "",
            goNoGoLogic: report?.businessDiagnosis?.goNoGoLogic || "",
            structureSummary:
                report?.businessDiagnosis?.structureSummary || "",
        },

        freeCta: {
            title:
                report?.freeCta?.title ||
                "Unlock the full decision report",

            message:
                report?.freeCta?.message ||
                "Full report includes customer, market, profit, execution, and risk analysis.",

            lockedItems: safeArray(report?.freeCta?.lockedItems, [
                "Customer analysis",
                "Market & competition",
                "Unit economics",
                "Marketing strategy",
                "Execution plan",
                "Risk system",
            ]).slice(0, 6),

            buttonText:
                report?.freeCta?.buttonText || "View full report",
        },

        isPaid: false,
        reportMode: "free-preview",
    }
}

// =========================================================
// [18] FREE REPORT FILTER (PAID → FREE)
// =========================================================

function buildFreeReportFromPaidReport(fullReport) {
    return {
        cover: fullReport.cover,

        businessDiagnosis: fullReport.businessDiagnosis,

        visualScores: fullReport.visualScores,

        decisionMatrix: fullReport.decisionMatrix,

        executiveDecision: fullReport.executiveDecision,

        marketCards: fullReport.marketCards,

        marketFunnel: fullReport.marketFunnel,

        unitEconomicsCards: fullReport.unitEconomicsCards,

        unitEconomicsScore: fullReport.unitEconomicsScore,

        customerSummary: fullReport.customerSummary,

        isPaid: false,
        reportMode: "free",

        lockedSections: {
            message:
                "Full analysis including market reality, customer behavior, profit structure, and execution strategy is available in the paid report.",
        },
    }
}
// =========================================================
// [19] NORMALIZE REPORT (안정화 핵심)
// =========================================================

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

        customerTruth: safeArray(report?.customerTruth, [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
        ]).slice(0, 3),

        customerOpportunity: safeArray(report?.customerOpportunity, [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
        ]).slice(0, 4),

        buyingTrigger: report?.buyingTrigger || "",
        customerSummary: report?.customerSummary || "",

        competitionMap: safeArray(report?.competitionMap, [
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "", "", ""],
            ["", "", "", ""],
        ]).slice(0, 4),

        competitionConclusion: report?.competitionConclusion || "",

        benchmarkRows: safeArray(report?.benchmarkRows, [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
        ]).slice(0, 3),

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

        unitEconomicsTable: safeArray(report?.unitEconomicsTable, [
            ["CAC", "", "", ""],
            ["LTV", "", "", ""],
            ["AOV", "", "", ""],
            ["Repeat", "", "", ""],
        ]).slice(0, 4),

        economicsJudgment: report?.economicsJudgment || "",

        marketingStrategy: {
            channelFit: safeArray(
                report?.marketingStrategy?.channelFit,
                [
                    ["", "WATCH", "", ""],
                    ["", "WATCH", "", ""],
                    ["", "WATCH", "", ""],
                    ["", "WATCH", "", ""],
                ]
            ).slice(0, 4),

            contentPlaybook: safeArray(
                report?.marketingStrategy?.contentPlaybook,
                ["", "", "", "", ""]
            ).slice(0, 5),

            thirtyDayMarketingTest: safeArray(
                report?.marketingStrategy?.thirtyDayMarketingTest,
                [
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
                    ["Week 12", "", ""],
                ]
            ).slice(0, 12),
        },

        businessModel: {
            revenueLayers: safeArray(
                report?.businessModel?.revenueLayers,
                [
                    ["", "", ""],
                    ["", "", ""],
                    ["", "", ""],
                ]
            ).slice(0, 3),

            modelJudgment: report?.businessModel?.modelJudgment || "",
            modelDeepDive: report?.businessModel?.modelDeepDive || "",
        },

        riskSystem: safeArray(report?.riskSystem, [
            ["", "", ""],
            ["", "", ""],
            ["", "", ""],
        ]).slice(0, 3),

        executionPlan: safeArray(report?.executionPlan, [
            ["Phase 1", "", ""],
            ["Phase 2", "", ""],
            ["Phase 3", "", ""],
        ]).slice(0, 3),

        operatingRule: report?.operatingRule || "",

        goThreshold: safeArray(report?.goThreshold, [
            ["CAC", "", ""],
            ["Conversion", "", ""],
            ["Repeat", "", ""],
            ["Margin", "", ""],
        ]).slice(0, 4),

        goChecklist: safeArray(report?.goChecklist, [
            { label: "CAC", status: "WATCH" },
            { label: "Conversion", status: "WATCH" },
            { label: "Repeat Purchase", status: "WATCH" },
            { label: "Margin", status: "WATCH" },
        ]).slice(0, 4),

        finalRule: report?.finalRule || "",

        dataConfidence: {
            overallLevel: report?.dataConfidence?.overallLevel || "MEDIUM",
            summary: report?.dataConfidence?.summary || "",
            sourceQuality: safeArray(
                report?.dataConfidence?.sourceQuality,
                [
                    ["", "", ""],
                    ["", "", ""],
                    ["", "", ""],
                ]
            ).slice(0, 3),
            limits: safeArray(report?.dataConfidence?.limits, [
                "",
                "",
                "",
            ]).slice(0, 3),
        },

        sensitivityAnalysis: {
            cacLtvTable: safeArray(
                report?.sensitivityAnalysis?.cacLtvTable,
                [
                    ["Low CAC", "", "", ""],
                    ["Base CAC", "", "", ""],
                    ["High CAC", "", "", ""],
                ]
            ).slice(0, 3),

            criticalBreakPoint:
                report?.sensitivityAnalysis?.criticalBreakPoint || "",

            founderWarning:
                report?.sensitivityAnalysis?.founderWarning || "",
        },

        profitSimulation: {
            monthlyScenarioTable: safeArray(
                report?.profitSimulation?.monthlyScenarioTable,
                [
                    ["Conservative", "", "", "", "", ""],
                    ["Base", "", "", "", "", ""],
                    ["Aggressive", "", "", "", "", ""],
                ]
            ).slice(0, 3),

            breakEvenPoint:
                report?.profitSimulation?.breakEvenPoint || "",

            profitJudgment:
                report?.profitSimulation?.profitJudgment || "",

            cashRisk:
                report?.profitSimulation?.cashRisk || "",
        },

        killCriteria: {
            rules: safeArray(report?.killCriteria?.rules, [
                ["", "", ""],
                ["", "", ""],
                ["", "", ""],
                ["", "", ""],
            ]).slice(0, 4),

            stopDecision:
                report?.killCriteria?.stopDecision || "",

            pivotDecision:
                report?.killCriteria?.pivotDecision || "",

            scaleDecision:
                report?.killCriteria?.scaleDecision || "",
        },

        appendix: {
            dataSources: safeArray(report?.appendix?.dataSources, [
                ["", "", ""],
                ["", "", ""],
                ["", "", ""],
            ]).slice(0, 3),

            assumptions: safeArray(report?.appendix?.assumptions, [
                "",
                "",
                "",
                "",
            ]).slice(0, 4),
        },

        referenceLinks: safeArray(report?.referenceLinks, [
            ["", ""],
            ["", ""],
            ["", ""],
            ["", ""],
            ["", ""],
        ]).slice(0, 5),
    }
}

// =========================================================
// [20-A] BUILD FREE PREVIEW HTML
// =========================================================

// =========================================================
// [20-A] BUILD FREE PREVIEW HTML
// =========================================================

function buildFreePreviewHtml(report, locale) {
    const matrix = objectFromPairs(report?.decisionMatrix || [])
    const glossary = Array.isArray(report?.glossary) ? report.glossary : []

    const decision = report?.cover?.decision || "HOLD"
    const score = toScore(report?.cover?.score, 50)

    const marketScore = toScore(report?.visualScores?.market, 50)
    const profitabilityScore = toScore(report?.visualScores?.profitability, 50)
    const executionScore = toScore(report?.visualScores?.execution, 50)
    const riskScore = toScore(report?.visualScores?.risk, 50)

    const ctaItems = Array.isArray(report?.freeCta?.lockedItems)
        ? report.freeCta.lockedItems
        : []

    const glossaryRows = glossary
        .slice(0, 5)
        .map(
            (item) => `
<tr>
    <td>${esc(item?.term || "")}</td>
    <td>${esc(item?.meaning || "")}</td>
    <td>${esc(item?.whyItMatters || "")}</td>
</tr>`
        )
        .join("")

    const ctaList = ctaItems
        .slice(0, 6)
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")

    return `
<!doctype html>
<html lang="${esc(locale?.lang || "ko")}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GoNoGo Free Preview Report</title>

<style>
* {
    box-sizing: border-box;
}

body {
    margin: 0;
    background: #f4f6f2;
    color: #0D2418;
    font-family: ${getPdfFontFamily(locale?.lang || "ko")};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

.page {
    width: 794px;
    min-height: 1123px;
    margin: 0 auto 24px;
    padding: 54px 56px;
    background: #ffffff;
    position: relative;
    overflow: hidden;
    page-break-after: always;
}

.page:last-child {
    page-break-after: auto;
}

.brand-mark {
    font-size: 18px;
    font-weight: 950;
    letter-spacing: -0.04em;
}

.muted {
    color: #6f7e75;
}

.big-decision {
    margin-top: 96px;
    font-size: 88px;
    line-height: 0.9;
    letter-spacing: -0.09em;
    font-weight: 950;
}

.score {
    margin-top: 26px;
    font-size: 26px;
    font-weight: 900;
}

.title {
    margin-top: 20px;
    font-size: 34px;
    line-height: 1.14;
    letter-spacing: -0.055em;
    font-weight: 950;
}

.subtitle {
    margin-top: 14px;
    font-size: 16px;
    line-height: 1.65;
    color: #53645A;
    font-weight: 700;
}

.grid-4 {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-top: 44px;
}

.card {
    border: 1px solid #dfe7e2;
    border-radius: 18px;
    padding: 16px 14px;
    background: #fbfcfa;
}

.card-label {
    font-size: 11px;
    color: #66766d;
    font-weight: 900;
    text-transform: uppercase;
}

.card-value {
    margin-top: 8px;
    font-size: 20px;
    font-weight: 950;
    letter-spacing: -0.04em;
}

.score-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
    margin-top: 34px;
}

.score-card {
    border: 1px solid #dfe7e2;
    border-radius: 22px;
    padding: 18px;
    background: #ffffff;
}

.score-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 14px;
    font-weight: 900;
}

.bar-bg {
    margin-top: 12px;
    height: 9px;
    background: #e8eee9;
    border-radius: 999px;
    overflow: hidden;
}

.bar-fill {
    height: 100%;
    background: #0D2418;
    border-radius: 999px;
}

.footer {
    position: absolute;
    left: 56px;
    right: 56px;
    bottom: 34px;
    display: flex;
    justify-content: space-between;
    color: #839087;
    font-size: 11px;
    font-weight: 700;
}

.section-kicker {
    font-size: 13px;
    font-weight: 950;
    color: #6f7e75;
    letter-spacing: 0.08em;
}

.section-title {
    margin-top: 16px;
    font-size: 48px;
    line-height: 1.04;
    letter-spacing: -0.075em;
    font-weight: 950;
}

.section-desc {
    margin-top: 20px;
    max-width: 580px;
    font-size: 17px;
    line-height: 1.75;
    color: #53645A;
    font-weight: 650;
}

.toc {
    margin-top: 54px;
    border-top: 2px solid #0D2418;
}

.toc-row {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 16px;
    padding: 18px 0;
    border-bottom: 1px solid #e2e9e4;
    align-items: center;
}

.toc-num {
    font-size: 13px;
    font-weight: 950;
    color: #839087;
}

.toc-title {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: -0.035em;
}

.badge {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 7px 10px;
    background: #eef4ef;
    color: #0D2418;
    font-size: 11px;
    font-weight: 950;
}

.badge.locked {
    background: #0D2418;
    color: #ffffff;
}

.table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 28px;
    font-size: 13px;
}

.table th {
    text-align: left;
    background: #0D2418;
    color: #ffffff;
    padding: 12px 12px;
    font-size: 12px;
}

.table td {
    border-bottom: 1px solid #e2e9e4;
    padding: 13px 12px;
    vertical-align: top;
    line-height: 1.55;
}

.table td:first-child {
    font-weight: 900;
    width: 120px;
}

.callout {
    margin-top: 34px;
    padding: 22px;
    border-radius: 24px;
    background: #f3f7f4;
    border: 1px solid #dde7df;
    font-size: 15px;
    line-height: 1.7;
    font-weight: 700;
    color: #314138;
}

.diagnosis {
    margin-top: 30px;
    display: grid;
    grid-template-columns: 190px 1fr;
    border: 1px solid #dfe7e2;
    border-radius: 24px;
    overflow: hidden;
}

.diagnosis div {
    padding: 14px 16px;
    border-bottom: 1px solid #e5ece7;
    line-height: 1.55;
    font-size: 13px;
}

.diagnosis div:nth-child(odd) {
    background: #f4f7f5;
    font-weight: 950;
}

.diagnosis div:nth-last-child(-n+2) {
    border-bottom: none;
}

.summary-box {
    margin-top: 28px;
    padding: 24px;
    border-radius: 26px;
    background: #0D2418;
    color: #ffffff;
}

.summary-box h3 {
    margin: 0 0 12px;
    font-size: 20px;
    letter-spacing: -0.04em;
}

.summary-box p {
    margin: 0;
    font-size: 14px;
    line-height: 1.75;
    color: rgba(255,255,255,0.82);
}

.cta-card {
    margin-top: 48px;
    padding: 34px;
    border-radius: 34px;
    background: #0D2418;
    color: #ffffff;
}

.cta-card h2 {
    margin: 0;
    font-size: 42px;
    line-height: 1.05;
    letter-spacing: -0.075em;
}

.cta-card p {
    margin: 18px 0 0;
    color: rgba(255,255,255,0.78);
    font-size: 16px;
    line-height: 1.7;
    font-weight: 650;
}

.lock-list {
    margin-top: 28px;
    display: grid;
    gap: 12px;
    padding: 0;
    list-style: none;
}

.lock-list li {
    padding: 15px 16px;
    border-radius: 16px;
    background: rgba(255,255,255,0.09);
    font-size: 14px;
    font-weight: 850;
}

.cta-button {
    display: inline-block;
    margin-top: 30px;
    padding: 16px 22px;
    border-radius: 999px;
    background: #B6FF5A;
    color: #0D2418;
    font-size: 14px;
    font-weight: 950;
    text-decoration: none;
}

/* =========================================================
   FREE CTA PAGE - UPGRADE CONVERSION
========================================================= */

.free-upgrade-page {
    background:
        radial-gradient(circle at 20% 16%, rgba(182,255,90,0.22), transparent 28%),
        linear-gradient(180deg, #eef7f1 0%, #ffffff 100%);
}

.free-upgrade-wrap {
    position: relative;
    z-index: 2;
}

.free-upgrade-kicker {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 9px 13px;
    border-radius: 999px;
    background: #0D2418;
    color: #ffffff;
    font-size: 11px;
    font-weight: 950;
    letter-spacing: 0.08em;
}

.free-upgrade-title {
    margin: 34px 0 0;
    font-size: 48px;
    line-height: 1.04;
    letter-spacing: -0.075em;
    font-weight: 950;
    color: #0D2418;
}

.free-upgrade-desc {
    margin-top: 18px;
    max-width: 610px;
    font-size: 16px;
    line-height: 1.75;
    color: #53645A;
    font-weight: 700;
}

.free-progress-card {
    margin-top: 28px;
    padding: 22px;
    border-radius: 26px;
    background: #ffffff;
    border: 1px solid #dfe7e2;
}

.free-progress-top {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 950;
    color: #0D2418;
    letter-spacing: 0.04em;
}

.free-progress-track {
    margin-top: 13px;
    height: 12px;
    border-radius: 999px;
    background: #e4ece7;
    overflow: hidden;
}

.free-progress-fill {
    height: 100%;
    width: 65%;
    border-radius: 999px;
    background: #0D2418;
}

.free-progress-note {
    margin-top: 10px;
    font-size: 12px;
    color: #6f7e75;
    font-weight: 800;
}

.free-upgrade-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin-top: 18px;
}

.free-decision-card,
.free-brand-preview-card {
    min-height: 170px;
    border-radius: 28px;
    padding: 22px;
    border: 1px solid #dfe7e2;
}

.free-decision-card {
    background: #ffffff;
}

.free-brand-preview-card {
    background: #0D2418;
    color: #ffffff;
}

.free-card-label {
    font-size: 11px;
    font-weight: 950;
    letter-spacing: 0.08em;
    color: #6f7e75;
    text-transform: uppercase;
}

.free-brand-preview-card .free-card-label {
    color: rgba(255,255,255,0.58);
}

.free-decision-value {
    margin-top: 16px;
    font-size: 42px;
    line-height: 0.95;
    letter-spacing: -0.08em;
    font-weight: 950;
}

.free-score-value {
    margin-top: 8px;
    font-size: 17px;
    font-weight: 950;
}

.free-card-text {
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.55;
    color: #53645A;
    font-weight: 700;
}

.free-brand-preview-card .free-card-text {
    color: rgba(255,255,255,0.76);
}

.free-locked-layer {
    position: relative;
    margin-top: 18px;
    height: 145px;
    border-radius: 30px;
    border: 1px solid #dfe7e2;
    overflow: hidden;
    background:
        linear-gradient(90deg, rgba(13,36,24,0.08), rgba(13,36,24,0.02)),
        repeating-linear-gradient(
            45deg,
            rgba(13,36,24,0.05),
            rgba(13,36,24,0.05) 10px,
            rgba(255,255,255,0.4) 10px,
            rgba(255,255,255,0.4) 20px
        );
}

.free-locked-layer::before {
    content: "";
    position: absolute;
    inset: 0;
    backdrop-filter: blur(7px);
    background: rgba(255,255,255,0.46);
}

.free-locked-pill {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px;
    border-radius: 999px;
    background: #ffffff;
    border: 1px solid #dfe7e2;
    font-size: 13px;
    font-weight: 950;
    color: #0D2418;
    box-shadow: 0 18px 45px rgba(13,36,24,0.10);
}

.free-lock-grid {
    margin-top: 18px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
}

.free-lock-item {
    min-height: 78px;
    padding: 14px;
    border-radius: 18px;
    background: #ffffff;
    border: 1px solid #dfe7e2;
}

.free-lock-item strong {
    display: block;
    font-size: 13px;
    line-height: 1.35;
    color: #0D2418;
    font-weight: 950;
}

.free-lock-item span {
    display: block;
    margin-top: 6px;
    font-size: 11px;
    color: #6f7e75;
    font-weight: 750;
}

.free-warning-box {
    margin-top: 18px;
    padding: 18px 20px;
    border-radius: 22px;
    background: #fff4ed;
    border: 1px solid #ffd9c7;
    color: #8a3b14;
}

.free-warning-box strong {
    display: block;
    font-size: 15px;
    font-weight: 950;
}

.free-warning-box p {
    margin: 7px 0 0;
    font-size: 13px;
    line-height: 1.55;
    font-weight: 750;
}

.free-danger-line {
    margin-top: 12px;
    padding: 15px 18px;
    border-radius: 18px;
    background: #0D2418;
    color: #ffffff;
    font-size: 13px;
    line-height: 1.55;
    font-weight: 850;
}

.free-upgrade-button {
    display: block;
    margin-top: 18px;
    width: 100%;
    text-align: center;
    padding: 19px 22px;
    border-radius: 999px;
    background: #B6FF5A;
    color: #0D2418;
    text-decoration: none;
    font-size: 16px;
    font-weight: 950;
    box-shadow: 0 18px 40px rgba(13,36,24,0.14);
}

@media print {
    body {
        background: #ffffff;
    }

    .page {
        margin: 0;
        width: 794px;
        min-height: 1123px;
        box-shadow: none;
    }
}
</style>
</head>

<body>

<!-- PAGE 1: COVER -->
<section class="page">
    <div class="brand-mark">GONOGO™</div>

    <div class="big-decision">${esc(decision)}</div>
    <div class="score">${esc(score)} / 100</div>

    <div class="title">
        ${esc(report?.cover?.brandName || "")}<br />
        Free Business Decision Report
    </div>

    <div class="subtitle">
        ${esc(report?.cover?.subtitle || "")}<br />
        ${esc(report?.cover?.oneLineVerdict || "")}
    </div>

    <div class="grid-4">
        <div class="card">
            <div class="card-label">Market</div>
            <div class="card-value">${esc(matrix.MARKET || "")}</div>
        </div>
        <div class="card">
            <div class="card-label">Profitability</div>
            <div class="card-value">${esc(matrix.PROFITABILITY || "")}</div>
        </div>
        <div class="card">
            <div class="card-label">Execution</div>
            <div class="card-value">${esc(matrix.EXECUTION || "")}</div>
        </div>
        <div class="card">
            <div class="card-label">Risk</div>
            <div class="card-value">${esc(matrix.RISK || "")}</div>
        </div>
    </div>

    <div class="score-grid">
        <div class="score-card">
            <div class="score-row"><span>Market score</span><span>${marketScore}/100</span></div>
            <div class="bar-bg"><div class="bar-fill" style="width:${marketScore}%"></div></div>
        </div>
        <div class="score-card">
            <div class="score-row"><span>Profitability score</span><span>${profitabilityScore}/100</span></div>
            <div class="bar-bg"><div class="bar-fill" style="width:${profitabilityScore}%"></div></div>
        </div>
        <div class="score-card">
            <div class="score-row"><span>Execution score</span><span>${executionScore}/100</span></div>
            <div class="bar-bg"><div class="bar-fill" style="width:${executionScore}%"></div></div>
        </div>
        <div class="score-card">
            <div class="score-row"><span>Risk pressure</span><span>${riskScore}/100</span></div>
            <div class="bar-bg"><div class="bar-fill" style="width:${riskScore}%"></div></div>
        </div>
    </div>

    <div class="footer">
        <span>GoNoGo™ Business Decision Report</span>
        <span>Page 1 / 6</span>
    </div>
</section>

<!-- PAGE 2: TABLE OF CONTENTS -->
<section class="page">
    <div class="section-kicker">FREE PREVIEW</div>
    <div class="section-title">Table of contents</div>
    <div class="section-desc">
        This free report provides the first decision layer only. The paid report unlocks the full customer, market, profit, execution, and risk analysis.
    </div>

    <div class="toc">
        <div class="toc-row">
            <div class="toc-num">01</div>
            <div class="toc-title">Cover / decision board</div>
            <div class="badge">FREE</div>
        </div>
        <div class="toc-row">
            <div class="toc-num">02</div>
            <div class="toc-title">Report structure and reading guide</div>
            <div class="badge">FREE</div>
        </div>
        <div class="toc-row">
            <div class="toc-num">03</div>
            <div class="toc-title">Key terms and score guide</div>
            <div class="badge">FREE</div>
        </div>
        <div class="toc-row">
            <div class="toc-num">04</div>
            <div class="toc-title">Business structure diagnosis</div>
            <div class="badge">FREE</div>
        </div>
        <div class="toc-row">
            <div class="toc-num">05</div>
            <div class="toc-title">Customer, market, profit, execution and risk analysis</div>
            <div class="badge locked">PAID</div>
        </div>
    </div>

    <div class="callout">
        The free report is designed to answer one question first: “Is this business idea worth deeper analysis?”
        The paid report answers the next question: “How should this be validated, executed, or stopped?”
    </div>

    <div class="footer">
        <span>GoNoGo™ Business Decision Report</span>
        <span>Page 2 / 6</span>
    </div>
</section>

<!-- PAGE 3: HOW TO READ -->
<section class="page">
    <div class="section-kicker">SECTION 01</div>
    <div class="section-title">How to read this report</div>
    <div class="section-desc">
        This section defines the core business terms and the judgment baseline. A business idea should not be judged only by how attractive it sounds. It should be judged by demand, margin, execution difficulty, and risk pressure.
    </div>

    <div class="callout">
        The score is not a prediction. It is a decision signal based on the current idea structure.
        A high score means the idea deserves validation. A low score means the structure needs redesign before spending money.
    </div>

    <div class="score-grid">
        <div class="score-card">
            <div class="card-label">Decision</div>
            <div class="card-value">${esc(decision)}</div>
        </div>
        <div class="score-card">
            <div class="card-label">LTV / CAC</div>
            <div class="card-value">${esc(report?.unitEconomicsScore?.ltvToCac || "")}</div>
        </div>
        <div class="score-card">
            <div class="card-label">Payback</div>
            <div class="card-value">${esc(report?.unitEconomicsScore?.payback || "")}</div>
        </div>
        <div class="score-card">
            <div class="card-label">Profit status</div>
            <div class="card-value">${esc(report?.unitEconomicsScore?.status || "")}</div>
        </div>
    </div>

    <div class="footer">
        <span>GoNoGo™ Business Decision Report</span>
        <span>Page 3 / 6</span>
    </div>
</section>

<!-- PAGE 4: GLOSSARY -->
<section class="page">
    <div class="section-kicker">1-1</div>
    <div class="section-title">Key terms and score guide</div>
    <div class="section-desc">
        These terms explain how the report reads the business idea. Understanding them helps separate a popular idea from a viable business.
    </div>

    <table class="table">
        <thead>
            <tr>
                <th>Term</th>
                <th>Meaning</th>
                <th>Why it matters</th>
            </tr>
        </thead>
        <tbody>
            ${glossaryRows}
        </tbody>
    </table>

    <table class="table">
        <thead>
            <tr>
                <th>Score range</th>
                <th>Judgment</th>
                <th>Meaning</th>
            </tr>
        </thead>
        <tbody>
            <tr><td>85~100</td><td>Excellent</td><td>Strong GO candidate. Scaling may be considered.</td></tr>
            <tr><td>70~84</td><td>Good</td><td>GO is possible if key conditions are met.</td></tr>
            <tr><td>50~69</td><td>Needs validation</td><td>HOLD. Decide after a small test.</td></tr>
            <tr><td>30~49</td><td>Risky</td><td>High NO GO probability. Redesign the structure.</td></tr>
            <tr><td>0~29</td><td>Very risky</td><td>Stop immediately or fully reconsider.</td></tr>
        </tbody>
    </table>

    <div class="footer">
        <span>GoNoGo™ Business Decision Report</span>
        <span>Page 4 / 6</span>
    </div>
</section>

<!-- PAGE 5: BUSINESS DIAGNOSIS -->
<section class="page">
    <div class="section-kicker">1-2</div>
    <div class="section-title">Business structure diagnosis</div>
    <div class="section-desc">
        This page classifies the business idea by industry, business model, customer behavior, entry difficulty, and first validation logic.
    </div>

    <div class="diagnosis">
        <div>Industry type</div>
        <div>${esc(report?.businessDiagnosis?.industryType || "")}</div>

        <div>Business model type</div>
        <div>${esc(report?.businessDiagnosis?.businessModelType || "")}</div>

        <div>Country market behavior</div>
        <div>${esc(report?.businessDiagnosis?.countryMarketBehavior || "")}</div>

        <div>Market entry difficulty</div>
        <div>${esc(report?.businessDiagnosis?.marketEntryDifficulty || "")}</div>

        <div>Main bottleneck</div>
        <div>${esc(report?.businessDiagnosis?.mainBottleneck || "")}</div>

        <div>Best first offer</div>
        <div>${esc(report?.businessDiagnosis?.bestFirstOffer || "")}</div>

        <div>Validation experiment</div>
        <div>${esc(report?.businessDiagnosis?.validationExperiment || "")}</div>

        <div>Go / No-Go logic</div>
        <div>${esc(report?.businessDiagnosis?.goNoGoLogic || "")}</div>
    </div>

    <div class="summary-box">
        <h3>Structure summary</h3>
        <p>${esc(report?.businessDiagnosis?.structureSummary || "")}</p>
    </div>

    <div class="footer">
        <span>GoNoGo™ Business Decision Report</span>
        <span>Page 5 / 6</span>
    </div>
</section>

<!-- PAGE 6: CTA -->
<!-- PAGE 6: CTA -->
<section class="page free-upgrade-page">
    <div class="free-upgrade-wrap">

        <div class="free-upgrade-kicker">
            🔒 FULL REPORT LOCKED
        </div>

        <h1 class="free-upgrade-title">
            ${esc(report?.freeCta?.title || "전체 분석은 유료 보고서에서 확인할 수 있습니다")}
        </h1>

        <p class="free-upgrade-desc">
            ${esc(
                report?.freeCta?.message ||
                "무료 보고서는 사업의 방향과 1차 판단까지만 제공합니다. 고객 분석, 수익 구조, 실행 전략, 리스크 대응은 전체 보고서에서 확인할 수 있습니다."
            )}
        </p>

        <div class="free-progress-card">
            <div class="free-progress-top">
                <span>REPORT COMPLETION</span>
                <span>65%</span>
            </div>

            <div class="free-progress-track">
                <div class="free-progress-fill"></div>
            </div>

            <div class="free-progress-note">
                Free judgment unlocked · Full execution layer locked
            </div>
        </div>

        <div class="free-upgrade-grid">
            <div class="free-decision-card">
                <div class="free-card-label">CURRENT DECISION SIGNAL</div>

                <div class="free-decision-value">
                    ${esc(decision)}
                </div>

                <div class="free-score-value">
                    Score: ${esc(score)} / 100
                </div>

                <div class="free-card-text">
                    ${esc(report?.cover?.oneLineVerdict || "현재 사업 구조는 추가 검증이 필요합니다.")}
                </div>
            </div>

            <div class="free-brand-preview-card">
                <div class="free-card-label">WHAT FULL REPORT ADDS</div>

                <div class="free-decision-value">
                    FULL
                </div>

                <div class="free-score-value">
                    Execution Strategy
                </div>

                <div class="free-card-text">
                    실행 순서, 수익 구조, 고객 저항, 마케팅 테스트, 리스크 대응까지 연결됩니다.
                </div>
            </div>
        </div>

        <div class="free-locked-layer">
            <div class="free-locked-pill">
                🔒 Locked decision layer
            </div>
        </div>

        <div class="free-lock-grid">
            ${ctaItems
                .slice(0, 6)
                .map(
                    (item) => `
                        <div class="free-lock-item">
                            <strong>🔒 ${esc(item)}</strong>
                            <span>Full report only</span>
                        </div>
                    `
                )
                .join("")}
        </div>

        <div class="free-warning-box">
            <strong>이 분석은 아직 완전하지 않습니다.</strong>
            <p>
                무료 보고서는 결정을 시작하게 해주는 미리보기입니다.
                실제 실패 지점, 수익 조건, 고객 저항, 실행 순서는 전체 보고서에서 확인해야 합니다.
            </p>
        </div>

        <div class="free-danger-line">
            지금 확인하지 않으면 잘못된 방향으로 몇 달의 시간과 마케팅 비용을 낭비할 수 있습니다.
        </div>

     <a
    class="free-upgrade-button"
    href="${process.env.PAYMENT_LINK || "#"}"
    target="_blank"
    rel="noopener noreferrer"
>
    ${esc(report?.freeCta?.buttonText || "전체 유료 보고서 열기")} — $49
</a>

    </div>

    <div class="footer">
        <span>GoNoGo™ Free Preview</span>
        <span>Upgrade Required</span>
    </div>
</section>

</body>
</html>
`
}
// =========================================================
// [20] BUILD HTML FROM TEMPLATE
// =========================================================

function buildHtmlFromTemplate(report, locale) {
        
    const isFree = report?.reportMode === "free"
    
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

        // Brand naming
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

    referenceLinkRows: rows(referenceLinks),
}
    
// =========================================================
// [21] TEMPLATE REPLACE
// =========================================================

html = html
    // Core charts
    .replaceAll("{{decisionChart}}", buildDecisionChart(report, locale))
    .replaceAll("{{ decisionChart }}", buildDecisionChart(report, locale))

    .replaceAll(
        "{{competitionPositionChart}}",
        report?.lockedSections?.competition
            ? ""
            : competitionPositionChart(report.competitionMap, locale)
    )
    .replaceAll(
        "{{ competitionPositionChart }}",
        report?.lockedSections?.competition
            ? ""
            : competitionPositionChart(report.competitionMap, locale)
    )

    .replaceAll(
        "{{executionTimeline}}",
        report?.lockedSections?.execution
            ? ""
            : executionTimeline(report.executionPlan, locale)
    )
    .replaceAll(
        "{{ executionTimeline }}",
        report?.lockedSections?.execution
            ? ""
            : executionTimeline(report.executionPlan, locale)
    )

    .replaceAll(
        "{{riskHeatmap}}",
        report?.lockedSections?.risk
            ? ""
            : riskHeatmap(report.riskSystem, locale)
    )
    .replaceAll(
        "{{ riskHeatmap }}",
        report?.lockedSections?.risk
            ? ""
            : riskHeatmap(report.riskSystem, locale)
    )

    .replaceAll("{{decisionSummaryBox}}", decisionSummaryBox(report, locale))
    .replaceAll("{{ decisionSummaryBox }}", decisionSummaryBox(report, locale))

    .replaceAll("{{finalDecisionSummaryBox}}", decisionSummaryBox(report, locale))
    .replaceAll("{{ finalDecisionSummaryBox }}", decisionSummaryBox(report, locale))

    // Special text / generated rows
    .replaceAll("{{modelDeepDive}}", report?.businessModel?.modelDeepDive || "")
    .replaceAll("{{ modelDeepDive }}", report?.businessModel?.modelDeepDive || "")

    .replaceAll("{{referenceLinkRows}}", rows(referenceLinks))
    .replaceAll("{{ referenceLinkRows }}", rows(referenceLinks))

    .replaceAll("{{glossaryRows}}", glossaryRows(report.glossary))
    .replaceAll("{{ glossaryRows }}", glossaryRows(report.glossary))

    .replaceAll("{{scoreGuideRows}}", rows(scoreGuideRows))
    .replaceAll("{{ scoreGuideRows }}", rows(scoreGuideRows))

    .replaceAll("{{marketFunnelChart}}", marketFunnelChart(report.marketFunnel))
    .replaceAll("{{ marketFunnelChart }}", marketFunnelChart(report.marketFunnel))

    .replaceAll(
        "{{profitSimulationChart}}",
        profitSimulationChart(report.profitSimulation?.monthlyScenarioTable, locale)
    )
    .replaceAll(
        "{{ profitSimulationChart }}",
        profitSimulationChart(report.profitSimulation?.monthlyScenarioTable, locale)
    )

    .replaceAll(
        "{{cacLtvRiskChart}}",
        cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale)
    )
    .replaceAll(
        "{{ cacLtvRiskChart }}",
        cacLtvRiskChart(report.sensitivityAnalysis?.cacLtvTable, locale)
    )

    // Tables
    .replaceAll(
        "{{tamSamSomRows}}",
        report?.lockedSections?.tamSamSom
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.tamSamSom)
    )
    .replaceAll(
        "{{ tamSamSomRows }}",
        report?.lockedSections?.tamSamSom
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.tamSamSom)
    )

    .replaceAll("{{customerTruthRows}}", rows(report.customerTruth))
    .replaceAll("{{ customerTruthRows }}", rows(report.customerTruth))

    .replaceAll("{{customerOpportunityRows}}", rows(customerOpportunityRows))
    .replaceAll("{{ customerOpportunityRows }}", rows(customerOpportunityRows))

    .replaceAll(
        "{{competitionRows}}",
        report?.lockedSections?.competition
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.competitionMap)
    )
    .replaceAll(
        "{{ competitionRows }}",
        report?.lockedSections?.competition
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.competitionMap)
    )

    .replaceAll(
        "{{competitionConclusion}}",
        report?.lockedSections?.competition
            ? esc(lockedMessage)
            : esc(report.competitionConclusion)
    )
    .replaceAll(
        "{{ competitionConclusion }}",
        report?.lockedSections?.competition
            ? esc(lockedMessage)
            : esc(report.competitionConclusion)
    )

    .replaceAll("{{benchmarkRows}}", rows(benchmarkRows))
    .replaceAll("{{ benchmarkRows }}", rows(benchmarkRows))

    .replaceAll(
        "{{unitEconomicsRows}}",
        report?.lockedSections?.unitEconomics
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.unitEconomicsTable)
    )
    .replaceAll(
        "{{ unitEconomicsRows }}",
        report?.lockedSections?.unitEconomics
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.unitEconomicsTable)
    )

    .replaceAll(
        "{{marketingChannelRows}}",
        report?.lockedSections?.marketing
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.marketingStrategy.channelFit)
    )
    .replaceAll(
        "{{ marketingChannelRows }}",
        report?.lockedSections?.marketing
            ? `<tr><td colspan="4">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.marketingStrategy.channelFit)
    )

    .replaceAll(
        "{{contentPlaybookItems}}",
        report?.lockedSections?.marketing
            ? `<li>${esc(lockedMessage)}</li>`
            : listItems(report.marketingStrategy.contentPlaybook)
    )
    .replaceAll(
        "{{ contentPlaybookItems }}",
        report?.lockedSections?.marketing
            ? `<li>${esc(lockedMessage)}</li>`
            : listItems(report.marketingStrategy.contentPlaybook)
    )

    .replaceAll(
        "{{marketingTestRows}}",
        report?.lockedSections?.marketing
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.marketingStrategy.thirtyDayMarketingTest)
    )
    .replaceAll(
        "{{ marketingTestRows }}",
        report?.lockedSections?.marketing
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.marketingStrategy.thirtyDayMarketingTest)
    )

    .replaceAll("{{businessModelRows}}", rows(report.businessModel.revenueLayers))
    .replaceAll("{{ businessModelRows }}", rows(report.businessModel.revenueLayers))

    .replaceAll(
        "{{riskRows}}",
        report?.lockedSections?.risk
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.riskSystem)
    )
    .replaceAll(
        "{{ riskRows }}",
        report?.lockedSections?.risk
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.riskSystem)
    )

    .replaceAll(
        "{{executionRows}}",
        report?.lockedSections?.execution
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.executionPlan)
    )
    .replaceAll(
        "{{ executionRows }}",
        report?.lockedSections?.execution
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.executionPlan)
    )

    .replaceAll(
        "{{goThresholdRows}}",
        report?.lockedSections?.goThreshold
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.goThreshold)
    )
    .replaceAll(
        "{{ goThresholdRows }}",
        report?.lockedSections?.goThreshold
            ? `<tr><td colspan="3">${lockedBox(lockedMessage, lockedTitle, lockedButton)}</td></tr>`
            : rows(report.goThreshold)
    )

    .replaceAll("{{goChecklistItems}}", checklistItems(report.goChecklist))
    .replaceAll("{{ goChecklistItems }}", checklistItems(report.goChecklist))

    .replaceAll("{{sourceQualityRows}}", rows(report.dataConfidence?.sourceQuality))
    .replaceAll("{{ sourceQualityRows }}", rows(report.dataConfidence?.sourceQuality))

    .replaceAll("{{dataLimitItems}}", listItems(report.dataConfidence?.limits))
    .replaceAll("{{ dataLimitItems }}", listItems(report.dataConfidence?.limits))

    .replaceAll("{{cacLtvRows}}", rows(report.sensitivityAnalysis?.cacLtvTable))
    .replaceAll("{{ cacLtvRows }}", rows(report.sensitivityAnalysis?.cacLtvTable))

    .replaceAll("{{profitSimulationRows}}", rows(report.profitSimulation?.monthlyScenarioTable))
    .replaceAll("{{ profitSimulationRows }}", rows(report.profitSimulation?.monthlyScenarioTable))

    .replaceAll("{{killCriteriaRows}}", rows(report.killCriteria?.rules))
    .replaceAll("{{ killCriteriaRows }}", rows(report.killCriteria?.rules))

    .replaceAll("{{dataSourceRows}}", rows(report.appendix.dataSources))
    .replaceAll("{{ dataSourceRows }}", rows(report.appendix.dataSources))

    .replaceAll("{{assumptionItems}}", listItems(report.appendix.assumptions))
    .replaceAll("{{ assumptionItems }}", listItems(report.appendix.assumptions))
    
    // =========================================================
    // [22] TEMPLATE VALIDATION
    // =========================================================

    validateTemplateKeys(html, templateData)

    html = applyTemplateVars(html, templateData)

    // =========================================================
    // [23] FREE REPORT CUT
    // =========================================================

    if (report?.reportMode === "free") {
        html = keepFreeReportOnly(html, locale, report)
    }
    
    // =========================================================
    // [24] BACK BUTTON
    // =========================================================

    html = injectReportBackButton(html, locale)

    html = html.replace(/{{[^}]+}}/g, "")

    return html
}
// =========================================================
// [25] FREE REPORT ONLY / PREMIUM LOCK UI
// =========================================================

function keepFreeReportOnly(html, locale = {}, report = {}) {
    const splitPoint = "<!-- FREE_REPORT_CUT_HERE -->"
    const index = html.indexOf(splitPoint)

    if (index === -1) {
        console.log("[FREE_SPLIT_POINT_NOT_FOUND]")
        return html
    }

    const freePart = html.slice(0, index)
    const decision = report?.cover?.decision || "HOLD"
    const score = Number.isFinite(report?.cover?.score) ? report.cover.score : 0
    const recommendedName =
        report?.brandNaming?.recommendedName?.name ||
        report?.brandNaming?.nameCandidates?.[0]?.name ||
        report?.cover?.brandName ||
        t(locale, "premium.defaultBrandName", "Recommended brand direction")

    const nameReason =
        report?.brandNaming?.recommendedName?.reason ||
        t(locale, "premium.defaultBrandReason", "This direction connects the offer, target customer, and market position.")

    const checkoutUrl =
        process.env.PAYMENT_LINK ||
        process.env.PAYWALL_CHECKOUT_URL ||
        "/api/dev-create-paid-token"

    return `
${freePart}

<section class="page free-paid-cta-page">
  <div class="free-paid-wrap">

    <div class="free-paid-kicker">
      ${esc(t(locale, "premium.kicker", "FULL REPORT LOCKED"))}
    </div>

    <h1 class="free-paid-title">
      ${esc(t(locale, "premium.title", "The full analysis is available in the paid report"))}
    </h1>

    <p class="free-paid-desc">
      ${esc(t(locale, "premium.desc", "Customer analysis, market size, competition, revenue simulation, marketing strategy, risk judgment, and execution planning are available in the full report."))}
    </p>

    <div class="free-paid-progress-card">
      <div class="free-paid-progress-head">
        <strong>${esc(t(locale, "premium.progressLabel", "REPORT COMPLETION"))}</strong>
        <span>65%</span>
      </div>
      <div class="free-paid-progress-track">
        <div class="free-paid-progress-fill"></div>
      </div>
      <div class="free-paid-progress-note">
        ${esc(t(locale, "premium.progressNote", "Free judgment unlocked"))}
      </div>
    </div>

    <div class="free-paid-grid">
      <div class="free-paid-signal-card">
        <p>${esc(t(locale, "premium.signalLabel", "CURRENT DECISION SIGNAL"))}</p>
        <h2>${esc(decision)}</h2>
        <strong>${esc(t(locale, "scoreLabel", "Score"))}: ${esc(score)} / 100</strong>
      </div>

      <div class="free-paid-dark-card">
        <p>${esc(t(locale, "premium.brandPreviewLabel", "RECOMMENDED BRAND PREVIEW"))}</p>
        <h2>${esc(recommendedName)}</h2>
        <span>${esc(nameReason)}</span>
      </div>
    </div>

    <div class="free-paid-locked-layer">
      <div class="free-paid-locked-pill">
        ${esc(t(locale, "premium.lockedLayer", "Locked decision layer"))}
      </div>
    </div>

    <div class="free-paid-lock-grid">
      <div class="free-paid-lock-item">
        <strong>${esc(t(locale, "premium.lockBrand", "Brand + Domain"))}</strong>
        <span>${esc(t(locale, "premium.lockBrandDesc", "Get the name, strategy, and domain direction."))}</span>
      </div>

      <div class="free-paid-lock-item">
        <strong>${esc(t(locale, "premium.lockCustomer", "Customer Truth"))}</strong>
        <span>${esc(t(locale, "premium.lockCustomerDesc", "See why customers buy and why they hesitate."))}</span>
      </div>

      <div class="free-paid-lock-item">
        <strong>${esc(t(locale, "premium.lockExecution", "Execution Plan"))}</strong>
        <span>${esc(t(locale, "premium.lockExecutionDesc", "Know what to test, when to stop, and when to scale."))}</span>
      </div>
    </div>

    <div class="free-paid-warning">
      <strong>${esc(t(locale, "premium.warningTitle", "This analysis is not complete yet."))}</strong>
      <p>${esc(t(locale, "premium.warningDesc", "Check actual failure points, revenue structure, customer resistance, and execution strategy in the full report."))}</p>
    </div>

    <a class="free-paid-button" href="${esc(checkoutUrl)}">
      ${esc(t(locale, "premium.ctaButton", "Open full paid report"))} — $49
    </a>

    <div class="free-paid-bottom-note">
      ${esc(t(locale, "premium.ctaSub", "Includes brand naming, domain strategy, customer analysis, market reality, revenue structure, execution plan, and risk judgment."))}
    </div>
  </div>

  <div class="footer">
    <span>${esc(t(locale, "footer.left", "GoNoGo™ Business Decision Report"))}</span>
    <span>${esc(t(locale, "premium.footer", "Paid Locked"))}</span>
  </div>
</section>

</body>
</html>
`
}
// =========================================================
// [26] REPORT BACK BUTTON
// =========================================================

function getBackToSiteText(lang = "en") {
    const map = {
        ko: "사이트로 돌아가기",
        en: "Back to site",
        ja: "サイトに戻る",
        zh: "返回网站",
        mn: "Сайт руу буцах",
    }

    return map[lang] || map.en
}

function injectReportBackButton(html, locale = {}) {
    const lang = locale?.lang || "en"
    const backText = getBackToSiteText(lang)
    const siteUrl = process.env.PUBLIC_SITE_URL || "https://gonogo.so"

    const buttonHtml = `
<a href="${esc(siteUrl)}" style="
  position:fixed;
  right:18px;
  bottom:18px;
  z-index:9999;
  background:#102018;
  color:#fff;
  text-decoration:none;
  padding:12px 15px;
  border-radius:999px;
  font-size:12px;
  font-weight:900;
  box-shadow:0 10px 30px rgba(0,0,0,0.18);
">
  ← ${esc(backText)}
</a>
`

    if (html.includes("</body>")) {
        return html.replace("</body>", `${buttonHtml}</body>`)
    }

    return `${html}${buttonHtml}`
}

// =========================================================
// [27] LOCKED BOX
// =========================================================

function lockedBox(
    message,
    title = "Premium Insights",
    buttonLabel = "Premium Report"
) {
    return `
<div style="
    padding:18px;
    border:1px solid #d8e7dc;
    background:#f6faf7;
    text-align:center;
">
    <div style="
        font-size:14px;
        font-weight:900;
        color:#102018;
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
// =========================================================
// [28] HTML TO PDF
// =========================================================

async function htmlToPdf(html) {
    const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
    })

    try {
        const page = await browser.newPage()

      await page.setContent(html, {
    waitUntil: ["load", "networkidle0"],
    timeout: 0,
})

// Google Fonts 로딩 대기
await page.evaluateHandle("document.fonts.ready")

// CJK 폰트 렌더 안정화 대기
await new Promise((resolve) => setTimeout(resolve, 3000))

// 폰트 로딩 상태 확인 로그
const loadedFonts = await page.evaluate(() => {
    return Array.from(document.fonts).map((font) => ({
        family: font.family,
        status: font.status,
    }))
})

console.log("[PDF_FONT_STATUS]", loadedFonts)

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

// =========================================================
// [29] LOCALE / TEMPLATE UTILS
// =========================================================

function loadLocale(lang) {
    const filePath = path.join(__dirname, "locales", `${lang}.json`)
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
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

    return map[lang] || "English"
}

function getByPath(obj, pathKey) {
    return String(pathKey)
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

function validateTemplateKeys(html, data = {}) {
    const matches = [...html.matchAll(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g)]
    const missing = []

    for (const match of matches) {
        const key = match[1]
        const value = getByPath(data, key)

        if (value === undefined || value === null) {
            missing.push(key)
        }
    }

    if (missing.length) {
        console.warn("[TEMPLATE_MISSING_KEYS]", [...new Set(missing)])
    }
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

// =========================================================
// [30] DATA UTILS
// =========================================================

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
    return Math.max(0, Math.min(100, n))
}

function sanitizeFileName(value) {
    return String(value || "Report")
        .replace(/[^\w가-힣ぁ-んァ-ン一-龥-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80) || "Report"
}

function objectFromPairs(rowsData = []) {
    const obj = {}

    if (!Array.isArray(rowsData)) return obj

    for (const row of rowsData) {
        if (Array.isArray(row) && row.length >= 2) {
            obj[String(row[0])] = row[1]
        }
    }

    return obj
}

function rows(items) {
    if (!Array.isArray(items)) return ""

    return items
        .map((row) => {
            const cells = Array.isArray(row) ? row : Object.values(row)

            return `<tr>${cells
                .map((cell) => `<td>${esc(cell)}</td>`)
                .join("")}</tr>`
        })
        .join("")
}

function listItems(items) {
    if (!Array.isArray(items)) return ""

    return items
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")
}

function glossaryRows(items) {
    if (!Array.isArray(items)) return ""

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

function getDefaultGlossary(language = "en") {
    return [
        {
            term: "TAM",
            meaning: "Total Addressable Market",
            whyItMatters: "Shows the maximum demand boundary.",
        },
        {
            term: "SAM",
            meaning: "Serviceable Available Market",
            whyItMatters: "Shows the realistic reachable market.",
        },
        {
            term: "SOM",
            meaning: "Serviceable Obtainable Market",
            whyItMatters: "Shows the first achievable market slice.",
        },
        {
            term: "CAC",
            meaning: "Customer Acquisition Cost",
            whyItMatters: "Shows how expensive growth becomes.",
        },
        {
            term: "LTV",
            meaning: "Lifetime Value",
            whyItMatters: "Shows how much one customer can generate.",
        },
    ]
}

// =========================================================
// [31] STATUS UTILS
// =========================================================

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

    if (
        v.includes("go") ||
        v.includes("pass") ||
        v.includes("가능")
    ) {
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

    // 리스크는 점수가 높을수록 위험
    if (n >= 70) return "status-red"
    if (n >= 50) return "status-yellow"
    return "status-green"
}

// =========================================================
// [32] MONEY PARSER
// =========================================================

function parseMoney(value) {
    if (typeof value === "number") return value

    const raw = String(value || "")
        .replace(/,/g, "")
        .replace(/[^\d.-]/g, "")

    const n = Number(raw)

    return Number.isFinite(n) ? n : 0
}

// =========================================================
// [33] FUNNEL NORMALIZER
// =========================================================

function normalizeFunnel(items = []) {
    const safe = Array.isArray(items) ? items : []

    const findByLabel = (label, fallbackScore) => {
        const found = safe.find(
            (item) => String(item?.label || "").toUpperCase() === label
        )

        return {
            value: found?.value || "",
            score: toScore(found?.score, fallbackScore),
        }
    }

    return {
        tam: findByLabel("TAM", 100),
        sam: findByLabel("SAM", 60),
        som: findByLabel("SOM", 20),
    }
}

// =========================================================
// [34] CHARTS
// =========================================================

function marketFunnelChart(items = [], locale = {}) {
    if (!Array.isArray(items) || items.length === 0) return ""

    const normalized = items.map((item) => {
        const label = item?.label || ""
        const value = item?.value || ""
        const score = Math.max(8, Math.min(100, Number(item?.score || 0)))

        return { label, value, score }
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
    <div class="market-funnel-label">${esc(item.label)}</div>
    <div class="market-funnel-track">
        <div class="market-funnel-fill" style="width:${item.score}%"></div>
    </div>
    <div class="market-funnel-value">${esc(item.value)}</div>
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
        chart.marketingCost || locale?.th_marketing_cost || "Marketing Cost"

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

            const max = Math.max(revenue, marketing, Math.abs(profit), 1)
            const revenueW = Math.max(5, Math.min(100, (revenue / max) * 100))
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
    <div class="scenario-title">${esc(scenario)}</div>

    <div class="mini-bar-row">
        <span>${esc(revenueLabel)}</span>
        <div class="chart-track">
            <div class="chart-fill" style="width:${revenueW}%"></div>
        </div>
        <b>${esc(row?.[2] || "")}</b>
    </div>

    <div class="mini-bar-row">
        <span>${esc(marketingCostLabel)}</span>
        <div class="chart-track">
            <div class="chart-fill light" style="width:${marketingW}%"></div>
        </div>
        <b>${esc(row?.[3] || "")}</b>
    </div>

    <div class="mini-bar-row">
        <span>${esc(profitLabel)}</span>
        <div class="chart-track">
            <div class="chart-fill ${profit < 0 ? "danger" : ""}" style="width:${profitW}%"></div>
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
            const width = Math.max(5, Math.min(100, ratio * 30))
            const statusClass =
                ratio >= 3 ? "" : ratio >= 1.5 ? "light" : "danger"

            return `
<div class="scenario-chart">
    <div class="scenario-title">${esc(scenario)}</div>
    <div class="mini-bar-row">
        <span>${esc(ratioLabel)}</span>
        <div class="chart-track">
            <div class="chart-fill ${statusClass}" style="width:${width}%"></div>
        </div>
        <b>${ratio.toFixed(1)}x</b>
    </div>
</div>
`
        })
        .join("")}
</div>
`
}

function buildDecisionChart(report, locale = {}) {
    const scores = report?.visualScores || {}
    const decision = report?.cover?.decision || "HOLD"
    const totalScore = toScore(report?.cover?.score, 50)
    const verdict = report?.cover?.oneLineVerdict || ""

    const items = [
        ["Market", scores.market],
        ["Profitability", scores.profitability],
        ["Execution", scores.execution],
        ["Risk Pressure", scores.risk],
    ]

    return `
<style>
.decision-chart {
    margin-top: 18px;
    padding: 18px;
    border: 1px solid #d8e7dc;
    background: #f6faf7;
}
.decision-chart-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
}
.decision-chart-title {
    font-size: 14px;
    font-weight: 900;
    line-height: 1.45;
}
.decision-chart-score {
    font-size: 28px;
    font-weight: 900;
    color: #2f7d57;
    white-space: nowrap;
}
.decision-chart-verdict {
    margin-top: 4px;
    font-size: 12px;
    line-height: 1.55;
    color: #4b5d53;
    font-weight: 700;
}
.decision-chart-row {
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr) 74px;
    gap: 10px;
    align-items: center;
    margin-bottom: 11px;
}
.decision-chart-row:last-child {
    margin-bottom: 0;
}
.decision-chart-label {
    font-size: 11px;
    font-weight: 900;
}
.decision-chart-track {
    height: 12px;
    background: #e1ebe5;
    border-radius: 999px;
    overflow: hidden;
}
.decision-chart-fill {
    height: 100%;
    background: #2f7d57;
    border-radius: 999px;
}
.decision-chart-fill.warn {
    background: #d8b85a;
}
.decision-chart-fill.danger {
    background: #b94a48;
}
.decision-chart-value {
    text-align: right;
    font-size: 10.5px;
    font-weight: 900;
}
</style>

<div class="decision-chart">
    <div class="decision-chart-head">
        <div>
            <div class="decision-chart-title">Founder decision signal</div>
            <div class="decision-chart-verdict">${esc(verdict)}</div>
        </div>
        <div class="decision-chart-score">${totalScore}/100<br><span style="font-size:12px;">${esc(decision)}</span></div>
    </div>

    ${items
        .map(([label, value]) => {
            const score = toScore(value, 50)
            const cls = score < 40 ? "danger" : score < 70 ? "warn" : ""

            return `
    <div class="decision-chart-row">
        <div class="decision-chart-label">${esc(label)}</div>
        <div class="decision-chart-track">
            <div class="decision-chart-fill ${cls}" style="width:${score}%"></div>
        </div>
        <div class="decision-chart-value">${score} / 100</div>
    </div>`
        })
        .join("")}
</div>
`
}

function competitionPositionChart(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    return `
<style>
.position-chart {
    position: relative;
    height: 360px;
    border: 1px solid #d9e5dd;
    border-radius: 16px;
    background: #f8fbf9;
    overflow: hidden;
    margin-top: 18px;
}
.position-chart::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    border-left: 1px dashed rgba(13,36,24,0.35);
}
.position-chart::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    border-top: 1px dashed rgba(13,36,24,0.35);
}
.axis-label {
    position: absolute;
    font-size: 10px;
    font-weight: 900;
    color: #4d6b5c;
    z-index: 2;
}
.axis-top {
    top: 12px;
    left: 14px;
}
.axis-bottom {
    bottom: 14px;
    left: 14px;
}
.axis-left {
    bottom: 34px;
    left: 14px;
}
.axis-right {
    bottom: 34px;
    right: 14px;
}
.position-dot {
    position: absolute;
    transform: translate(-50%, -50%);
    background: #2f7a4f;
    color: #fff;
    padding: 7px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    z-index: 3;
}
</style>

<div class="position-chart">
    <div class="axis-label axis-top">High Value</div>
    <div class="axis-label axis-bottom">Low Value</div>
    <div class="axis-label axis-left">Low Price</div>
    <div class="axis-label axis-right">High Price</div>

    ${rowsData
        .slice(0, 4)
        .map((row, index) => {
            const name = row?.[0] || `Competitor ${index + 1}`
            const x = [18, 38, 58, 78][index] || 50
            const y = [70, 58, 48, 34][index] || 50

            return `
    <div class="position-dot" style="left:${x}%; top:${y}%;">
        <span>${esc(name)}</span>
    </div>`
        })
        .join("")}
</div>
`
}

function riskHeatmap(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    return `
<style>
.risk-heatmap {
    margin-top: 18px;
    display: grid;
    gap: 10px;
}
.risk-cell {
    border: 1px solid #d8e7dc;
    background: #ffffff;
    padding: 13px 14px;
    border-left: 7px solid #2f7d57;
}
.risk-cell.high {
    border-left-color: #b94a48;
}
.risk-cell.medium {
    border-left-color: #d8b85a;
}
.risk-cell.low {
    border-left-color: #2f7d57;
}
.risk-cell-head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    font-weight: 900;
}
.risk-level {
    text-transform: uppercase;
    font-size: 10px;
}
.risk-cell.high .risk-level {
    color: #b94a48;
}
.risk-cell.medium .risk-level {
    color: #b58b16;
}
.risk-cell.low .risk-level {
    color: #2f7d57;
}
.risk-impact {
    margin-top: 8px;
    font-size: 11.5px;
    line-height: 1.55;
    color: #4b5d53;
    font-weight: 700;
}
.risk-action {
    margin-top: 6px;
    font-size: 11.5px;
    line-height: 1.55;
}
</style>

<div class="risk-heatmap">
    ${rowsData
        .slice(0, 3)
        .map((row, index) => {
            const risk = row?.[0] || ""
            const impact = row?.[1] || ""
            const action = row?.[2] || ""
            const level = index === 0 ? "high" : index === 1 ? "medium" : "low"
            const label = index === 0 ? "High" : index === 1 ? "Watch" : "Low"

            return `
    <div class="risk-cell ${level}">
        <div class="risk-cell-head">
            <span>${esc(risk)}</span>
            <span class="risk-level">${esc(label)}</span>
        </div>
        <div class="risk-impact">${esc(impact)}</div>
        <div class="risk-action">${esc(action)}</div>
    </div>`
        })
        .join("")}
</div>
`
}

function executionTimeline(rowsData = [], locale = {}) {
    if (!Array.isArray(rowsData)) return ""

    return `
<style>
.execution-timeline {
    margin-top: 18px;
    padding: 18px;
    border: 1px solid #d8e7dc;
    background: #f6faf7;
}
.execution-step {
    display: grid;
    grid-template-columns: 86px 1fr;
    gap: 14px;
    position: relative;
    padding-bottom: 18px;
}
.execution-step:last-child {
    padding-bottom: 0;
}
.execution-phase {
    width: 66px;
    height: 66px;
    border-radius: 50%;
    background: #163c2b;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 900;
}
.execution-body {
    border-left: 4px solid #2f7d57;
    background: #ffffff;
    padding: 14px 16px;
    min-height: 66px;
}
.execution-title {
    font-size: 13px;
    font-weight: 900;
    line-height: 1.45;
}
.execution-desc {
    margin-top: 6px;
    font-size: 12px;
    line-height: 1.55;
    color: #4b5d53;
    font-weight: 700;
}
</style>

<div class="execution-timeline">
    ${rowsData
        .slice(0, 3)
        .map((row, index) => {
            return `
    <div class="execution-step">
        <div class="execution-phase">${esc(row?.[0] || `P${index + 1}`)}</div>
        <div class="execution-body">
            <div class="execution-title">${esc(row?.[1] || "")}</div>
            <div class="execution-desc">${esc(row?.[2] || "")}</div>
        </div>
    </div>`
        })
        .join("")}
</div>
`
}

function decisionSummaryBox(report, locale = {}) {
    const decision = report?.cover?.decision || "HOLD"
    const score = toScore(report?.cover?.score, 0)
    const verdict = report?.cover?.oneLineVerdict || ""

    const cls =
        String(decision).toUpperCase().includes("NO")
            ? "danger"
            : String(decision).toUpperCase().includes("GO")
              ? "pass"
              : "watch"

    return `
<style>
.decision-summary-box {
    margin-top: 18px;
    padding: 20px;
    border: 2px solid #d8b85a;
    background: #fffdf3;
}
.decision-summary-box.pass {
    border-color: #2f7d57;
    background: #f4fbf6;
}
.decision-summary-box.danger {
    border-color: #b94a48;
    background: #fff7f6;
}
.decision-summary-top {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: flex-start;
}
.decision-summary-decision {
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.04em;
}
.decision-summary-score {
    font-size: 28px;
    font-weight: 900;
}
.decision-summary-verdict {
    margin-top: 12px;
    font-size: 13px;
    line-height: 1.65;
    font-weight: 750;
    color: #33443b;
}
.decision-summary-box.pass .decision-summary-score,
.decision-summary-box.pass .decision-summary-decision {
    color: #2f7d57;
}
.decision-summary-box.watch .decision-summary-score,
.decision-summary-box.watch .decision-summary-decision {
    color: #b58b16;
}
.decision-summary-box.danger .decision-summary-score,
.decision-summary-box.danger .decision-summary-decision {
    color: #b94a48;
}
</style>

<div class="decision-summary-box ${cls}">
    <div class="decision-summary-top">
        <div class="decision-summary-decision">${esc(decision)}</div>
        <div class="decision-summary-score">${score}/100</div>
    </div>
    <div class="decision-summary-verdict">${esc(verdict)}</div>
</div>
`
}


function checklistItems(items = []) {
    if (!Array.isArray(items)) return ""

    return items
        .slice(0, 4)
        .map((item) => {
            const label = item?.label || ""
            const status = item?.status || "WATCH"
            const cls = getStatusClass(status)

            return `
<div class="check-item">
    <span>${esc(label)}</span>
    <strong class="${esc(cls)}">${esc(status)}</strong>
</div>
`
        })
        .join("")
}

// =========================================================
// [35] SERVER START
// =========================================================

app.listen(PORT, () => {
    console.log(`🚀 GoNoGo Report Server running on port ${PORT}`)
})
