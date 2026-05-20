
// -------------------------------------------------------------------
// geminiClient.js
//
// Thin wrapper around @google/generative-ai that adds:
//   - retry logic (configurable attempts with exponential back-off)
//   - JSON schema enforcement via responseMimeType + responseSchema
//   - deep observability logs at every stage
//   - graceful error surfaces (throws with full error details)
//
// Env vars:
//   GEMINI_API_KEY  — required (leading/trailing whitespace is trimmed)
//   GEMINI_MODEL    — optional, defaults to gemini-2.0-flash
// -------------------------------------------------------------------

const { GoogleGenerativeAI } = require('@google/generative-ai')
const { version: SDK_VERSION } = require('@google/generative-ai/package.json')

const DEFAULT_MODEL = 'gemini-2.0-flash'
const MAX_RETRIES   = 2
const RETRY_DELAY   = 1500   // ms, doubled each attempt

// NOTE: responseSchema is intentionally NOT used here.
// When combined with newer Gemini models (2.5+) and SDK 0.24.x it causes
// the model to emit a truncated response — the JSON is cut off mid-string
// before the closing brace arrives.
// The JSON contract is enforced entirely through:
//   1. responseMimeType: 'application/json'  — forces JSON mode
//   2. The OUTPUT FORMAT section of the prompt — specifies exact keys
//   3. normaliseGeminiResult() in useCaseAgent.js — validates and coerces

async function callGemini(prompt, log) {
  // ── Key hygiene ──────────────────────────────────────────────────
  const rawKey    = process.env.GEMINI_API_KEY || ''
  const apiKey    = rawKey.trim()                        // strip any accidental whitespace
  const modelName = (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim()

  log.llm(0, `[GEMINI-INIT] SDK version      : ${SDK_VERSION}`)
  log.llm(0, `[GEMINI-INIT] model            : ${modelName}`)
  log.llm(0, `[GEMINI-INIT] API key present  : ${apiKey.length > 0}`)
  log.llm(0, `[GEMINI-INIT] API key length   : ${apiKey.length}`)
  log.llm(0, `[GEMINI-INIT] key had whitespace: ${rawKey !== apiKey}`)

  if (!apiKey) {
    throw new Error('[GEMINI] GEMINI_API_KEY is empty or not set after trimming')
  }

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',  // JSON mode — no schema enforcement
      temperature:      0.1,                 // low = consistent output
      maxOutputTokens:  4096,                // generous headroom for full JSON
    },
  })

  log.llm(0, `[GEMINI-INIT] prompt length   : ${prompt.length} chars`)

  let lastError
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log.llm(0, `[GEMINI-REQ] attempt ${attempt}/${MAX_RETRIES} — sending request`)

      const result = await model.generateContent(prompt)

      // ── Raw response surface ─────────────────────────────────────
      const text = result.response.text()
      log.llm(0, `[GEMINI-RAW] response length : ${text.length} chars`)
      log.llm(0, `[GEMINI-RAW] response text   : ${text.slice(0, 500)}${text.length > 500 ? '…' : ''}`)

      // ── Parse ────────────────────────────────────────────────────
      let parsed
      try {
        parsed = JSON.parse(text)
        log.llm(0, `[GEMINI-PARSE] JSON parsed successfully`)
        log.llm(0, `[GEMINI-PARSE] keys in response: ${Object.keys(parsed).join(', ')}`)
        log.llm(0, `[GEMINI-PARSE] applicationType : ${parsed.applicationType}`)
        log.llm(0, `[GEMINI-PARSE] confidence      : ${parsed.confidence}`)
        log.llm(0, `[GEMINI-PARSE] coreWorkflows   : ${JSON.stringify(parsed.coreWorkflows)}`)
        log.llm(0, `[GEMINI-PARSE] detectedRoles   : ${JSON.stringify(parsed.detectedRoles)}`)
        log.llm(0, `[GEMINI-PARSE] reasoning count : ${Array.isArray(parsed.reasoning) ? parsed.reasoning.length : 'N/A'}`)
        log.llm(0, `[GEMINI-PARSE] businessDesc len: ${typeof parsed.businessDescription === 'string' ? parsed.businessDescription.length : 'N/A'}`)
      } catch (parseErr) {
        log.fail(0, `[GEMINI-PARSE] JSON parse failed: ${parseErr.message}`)
        log.fail(0, `[GEMINI-PARSE] raw text was: ${text.slice(0, 300)}`)
        throw new Error(`JSON parse error: ${parseErr.message}`)
      }

      // ── Schema validation ────────────────────────────────────────
      if (typeof parsed.applicationType !== 'string' || parsed.applicationType.trim() === '') {
        throw new Error(`[GEMINI-VALIDATE] applicationType missing or empty — got: ${JSON.stringify(parsed.applicationType)}`)
      }
      if (typeof parsed.confidence !== 'number') {
        throw new Error(`[GEMINI-VALIDATE] confidence is not a number — got: ${JSON.stringify(parsed.confidence)}`)
      }
      if (typeof parsed.businessDescription !== 'string') {
        throw new Error(`[GEMINI-VALIDATE] businessDescription missing — got: ${JSON.stringify(parsed.businessDescription)}`)
      }

      log.llm(0, `[GEMINI-VALIDATE] schema validation passed`)
      log.llm(0, `[GEMINI-OK] type="${parsed.applicationType}"  confidence=${parsed.confidence}`)

      return parsed

    } catch (err) {
      lastError = err

      // Full error surface — don't truncate
      log.fail(0, `[GEMINI-ERR] attempt ${attempt} failed`)
      log.fail(0, `[GEMINI-ERR] error class   : ${err.constructor?.name || 'Error'}`)
      log.fail(0, `[GEMINI-ERR] error message : ${err.message}`)
      if (err.status)      log.fail(0, `[GEMINI-ERR] HTTP status   : ${err.status}`)
      if (err.statusText)  log.fail(0, `[GEMINI-ERR] HTTP statusText: ${err.statusText}`)
      if (err.errorDetails) log.fail(0, `[GEMINI-ERR] error details : ${JSON.stringify(err.errorDetails)}`)

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY * attempt
        log.llm(0, `[GEMINI-RETRY] waiting ${delay}ms before attempt ${attempt + 1}`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

module.exports = { callGemini }
