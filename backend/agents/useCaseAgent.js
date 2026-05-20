
// -------------------------------------------------------------------
// useCaseAgent.js
//
// Orchestrates the LLM-powered semantic application understanding engine.
//
// Flow:
//   1. Always run the deterministic classifier (for reliable fallback data)
//   2. Read and trim the API key — whitespace in .env is a silent killer
//   3. If no key: return deterministic result immediately, log why
//   4. Extract rich structured signals → build prompt → call Gemini
//   5. Validate and normalise the Gemini response
//   6. On ANY error: log the FULL error, then fall back deterministically
//   7. Print the final useCase object to stdout before returning
//
// Output shape:
// {
//   applicationType:     'E-Commerce Inventory Platform',
//   businessDescription: '...',
//   coreWorkflows:       ['Authentication', 'Cart Management', ...],
//   detectedRoles:       ['Customer', 'Admin', ...],
//   confidence:          0.92,
//   reasoning:           ['...', '...'],
//   classifiedBy:        'llm' | 'deterministic',
// }
// -------------------------------------------------------------------

const { extractRichSignals }        = require('./semanticSignalExtractor')
const { buildClassificationPrompt } = require('./llmPromptBuilder')
const { callGemini }                = require('./geminiClient')
const { classifyUseCase }           = require('../useCaseClassifier')

// ---------------------------------------------------------------------------
// Normalise Gemini response → canonical useCase shape
// ---------------------------------------------------------------------------
function normaliseGeminiResult(raw) {
  if (typeof raw.applicationType !== 'string' || raw.applicationType.trim() === '') {
    throw new Error('missing applicationType in Gemini response')
  }
  if (typeof raw.confidence !== 'number' || raw.confidence < 0 || raw.confidence > 1) {
    throw new Error(`invalid confidence value: ${raw.confidence}`)
  }
  if (typeof raw.businessDescription !== 'string') {
    throw new Error('missing businessDescription in Gemini response')
  }

  return {
    applicationType:     raw.applicationType.trim(),
    businessDescription: raw.businessDescription.trim(),
    coreWorkflows: Array.isArray(raw.coreWorkflows)
      ? raw.coreWorkflows.filter(w => typeof w === 'string' && w.trim())
      : [],
    detectedRoles: Array.isArray(raw.detectedRoles)
      ? raw.detectedRoles.filter(r => typeof r === 'string' && r.trim())
      : [],
    confidence: Math.round(raw.confidence * 100) / 100,
    reasoning: Array.isArray(raw.reasoning)
      ? raw.reasoning.filter(r => typeof r === 'string')
      : [],
    classifiedBy: 'llm',
  }
}

// ---------------------------------------------------------------------------
// Deterministic fallback — uses crawl data, no LLM
// ---------------------------------------------------------------------------
function buildDeterministicResult(deterministicResult, report) {
  const coreWorkflows = [
    ...(report.workflowPatterns  || []).map(w => w.pattern),
    ...(report.detectedTestCases || [])
      .filter(t => t.component === 'RepeatedRowAction' && t.pattern)
      .map(t => t.pattern),
  ].filter(Boolean).slice(0, 6)

  const detectedRoles = (report.workflowSessions || [])
    .map(s => s.name)
    .filter(n => n && n !== 'default')

  return {
    applicationType:     deterministicResult.label    || 'Unknown Application',
    businessDescription: '',
    coreWorkflows,
    detectedRoles,
    confidence:          deterministicResult.confidence ?? 0,
    reasoning:           (deterministicResult.signals || []).slice(0, 5),
    classifiedBy:        'deterministic',
  }
}

// ---------------------------------------------------------------------------
// Emits the final useCase object to stdout for debugging
// ---------------------------------------------------------------------------
function printFinalUseCase(useCase, source) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`[USECASE-FINAL] source = ${source}`)
  console.log(JSON.stringify(useCase, null, 2))
  console.log('═'.repeat(60) + '\n')
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------
async function runUseCaseAgent(report, log) {

  // ── Step 0: API key hygiene ───────────────────────────────────────────────
  // Trim is critical: .env values with accidental leading/trailing spaces
  // are truthy but rejected by the Google SDK with a 400 auth error.
  const rawKey = process.env.GEMINI_API_KEY || ''
  const apiKey = rawKey.trim()

  log.usecase(0, `[AGENT-INIT] rawKey length=${rawKey.length}  trimmedKey length=${apiKey.length}`)
  log.usecase(0, `[AGENT-INIT] key had leading/trailing whitespace: ${rawKey !== apiKey}`)
  log.usecase(0, `[AGENT-INIT] LLM path will be used: ${apiKey.length > 0}`)

  // ── Step 1: Deterministic classifier (always runs — needed for fallback) ──
  let deterministicResult
  try {
    deterministicResult = classifyUseCase(report)
    log.classify(0,
      `[DETERMINISTIC] type=${deterministicResult.applicationType}` +
      `  label="${deterministicResult.label}"` +
      `  confidence=${deterministicResult.confidence.toFixed(2)}` +
      `  signals=[${(deterministicResult.signals || []).slice(0, 3).join(', ')}]`
    )
  } catch (err) {
    log.fail(0, `[DETERMINISTIC] classifier threw: ${err.message}`)
    deterministicResult = {
      applicationType: 'unknown', label: 'Unknown Application',
      confidence: 0, signals: [],
    }
  }

  // ── Step 2: No API key → deterministic fallback ───────────────────────────
  if (!apiKey) {
    log.usecase(0, '[AGENT-PATH] GEMINI_API_KEY not set or empty after trim — using deterministic')
    const result = buildDeterministicResult(deterministicResult, report)
    printFinalUseCase(result, 'deterministic (no API key)')
    return result
  }

  // ── Step 3: LLM path ─────────────────────────────────────────────────────
  try {
    log.usecase(0, '[AGENT-PATH] LLM path active — extracting rich signals')
    const signals = extractRichSignals(report)
    log.usecase(0,
      `[SIGNALS] pages=${signals.summary.totalPages}` +
      `  forms=${signals.summary.totalForms}` +
      `  inputs=${signals.summary.totalInputs}` +
      `  buttons=${signals.summary.totalButtons}` +
      `  patterns=${signals.summary.repeatedPatterns}`
    )

    const prompt = buildClassificationPrompt(signals)
    log.llm(0, `[PROMPT] length=${prompt.length} chars`)

    log.usecase(0, '[AGENT-PATH] calling Gemini API…')
    const raw = await callGemini(prompt, log)
    log.usecase(0, '[AGENT-PATH] Gemini returned — normalising result')

    const result = normaliseGeminiResult(raw)

    log.classify(0,
      `[LLM-RESULT] type="${result.applicationType}"` +
      `  confidence=${result.confidence.toFixed(2)}` +
      `  workflows=${result.coreWorkflows.length}` +
      `  roles=${result.detectedRoles.length}` +
      `  reasoning=${result.reasoning.length}`
    )
    log.confidence(0,
      `classifiedBy=llm` +
      `  type="${result.applicationType}"` +
      `  confidence=${result.confidence.toFixed(2)}`
    )

    printFinalUseCase(result, 'llm')
    return result

  } catch (err) {
    // Full error — never truncate when diagnosing pipeline failures
    log.fail(0, `[AGENT-FALLBACK] LLM path failed — reason below`)
    log.fail(0, `[AGENT-FALLBACK] error class   : ${err.constructor?.name || 'Error'}`)
    log.fail(0, `[AGENT-FALLBACK] error message : ${err.message}`)
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1, 4)
      stackLines.forEach(l => log.fail(0, `[AGENT-FALLBACK] stack: ${l.trim()}`))
    }
    log.fail(0, '[AGENT-FALLBACK] activating deterministic fallback')

    const result = buildDeterministicResult(deterministicResult, report)
    printFinalUseCase(result, 'deterministic (LLM failed)')
    return result
  }
}

module.exports = { runUseCaseAgent }
