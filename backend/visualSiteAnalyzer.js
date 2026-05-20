
// -------------------------------------------------------------------
// visualSiteAnalyzer.js
//
// Visual site analysis pipeline using Gemini multimodal AI.
//
// Pipeline:
//   1. Deduplicate screenshot paths (multiple sessions may share paths)
//   2. For each screenshot → analyzeScreenshot() → frame description
//   3. Collect all descriptions → summarizeAllFrames() → overall summary
//   4. Parse APPLICATION TYPE from the structured summary text
//   5. Return { frames, overallSummary, applicationType, confidence }
//
// MAX_FRAMES caps the number of Gemini vision calls per crawl to avoid
// excessive latency or quota consumption on large crawls.
// -------------------------------------------------------------------

const { analyzeScreenshot, summarizeAllFrames } = require('./geminiAnalyzer')
const fs   = require('fs')
const path = require('path')

// Maximum number of screenshots to send to Gemini.
// If there are more, the first MAX_FRAMES unique ones are used.
const MAX_FRAMES = 12

// Delay between successive Gemini calls (ms) to respect rate limits.
const INTER_CALL_DELAY_MS = 600

// Map Gemini's free-text APPLICATION TYPE to the same machine-readable
// keys used by the keyword-based useCaseClassifier.
const TYPE_MAP = {
  'e-commerce':             'ecommerce',
  'ecommerce':              'ecommerce',
  'finance':                'finance',
  'finance/banking':        'finance',
  'banking':                'finance',
  'healthcare':             'healthcare',
  'education':              'education',
  'education/lms':          'education',
  'lms':                    'education',
  'booking':                'booking',
  'booking/reservations':   'booking',
  'reservations':           'booking',
  'social':                 'social',
  'social platform':        'social',
  'admin':                  'admin_dashboard',
  'admin dashboard':        'admin_dashboard',
  'crm':                    'crm',
  'project management':     'project_management',
  'saas':                   'saas',
  'saas/platform':          'saas',
}

function parseApplicationType(summaryText) {
  const match = summaryText.match(/APPLICATION TYPE:\s*([^\n]+)/i)
  if (!match) return 'unknown'
  // The model may include extra text like "| ..." — take only the first token
  const raw        = match[1].split('|')[0].trim().toLowerCase()
  return TYPE_MAP[raw] || 'other'
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// -------------------------------------------------------------------
// runVisualAnalysis
//
// Entry point called by testingAgent.js after crawling completes.
// apiKey   — GEMINI_API_KEY value
// screenshots — report.screenshots array (may include duplicates)
// log      — the shared logger instance from the crawl session
// -------------------------------------------------------------------
async function runVisualAnalysis(apiKey, screenshots, log) {
  // Step 1 — collect unique, existing screenshot paths (capped at MAX_FRAMES)
  const seen   = new Set()
  const unique = []

  for (const p of (screenshots || [])) {
    if (!p || seen.has(p)) continue
    seen.add(p)
    const absPath = path.resolve(p)
    if (fs.existsSync(absPath)) {
      unique.push(p)
      if (unique.length >= MAX_FRAMES) break
    }
  }

  if (unique.length === 0) {
    log.analyze(0, 'visual analysis: no valid screenshot files found — skipping')
    return null
  }

  log.analyze(0,
    `visual analysis starting  frames=${unique.length}  model=gemini-1.5-flash`
  )

  // Step 2 — analyze each frame
  const frames = []

  for (let i = 0; i < unique.length; i++) {
    const screenshotPath = unique[i]
    log.analyze(0, `frame ${i + 1}/${unique.length}  ${screenshotPath}`)

    try {
      const description = await analyzeScreenshot(apiKey, screenshotPath)

      frames.push({
        frame:       i + 1,
        screenshot:  screenshotPath,
        description,
        // First non-empty line of the description as a short label
        label: description.split('\n').find(l => l.trim().length > 0) || `Frame ${i + 1}`,
      })

      log.analyze(0,
        `frame ${i + 1} done  preview="${description.split('\n')[0].slice(0, 70)}"`
      )

    } catch (err) {
      const msg = (err.message || 'Gemini API error').split('\n')[0].slice(0, 100)
      log.fail(0, `frame ${i + 1} failed: ${msg}`)
    }

    // Brief pause between calls to respect API rate limits
    if (i < unique.length - 1) await sleep(INTER_CALL_DELAY_MS)
  }

  if (frames.length === 0) {
    return { error: 'All frame analyses failed', frames: [], overallSummary: '', applicationType: 'unknown' }
  }

  // Step 3 — summarize all frame descriptions into one structured report
  log.analyze(0, `summarizing ${frames.length} frame descriptions...`)

  let overallSummary = ''
  try {
    overallSummary = await summarizeAllFrames(apiKey, frames.map(f => f.description))
  } catch (err) {
    const msg = (err.message || 'summary call failed').split('\n')[0].slice(0, 100)
    log.fail(0, `summary generation failed: ${msg}`)
    overallSummary = frames.map((f, i) => `Frame ${i + 1}: ${f.description}`).join('\n\n')
  }

  // Step 4 — extract structured fields from the summary text
  const applicationType = parseApplicationType(overallSummary)

  log.analyze(0, `visual classification: ${applicationType}`)
  log.analyze(0, 'visual analysis complete')

  return {
    frameCount:      frames.length,
    frames,
    overallSummary,
    applicationType,
  }
}

module.exports = { runVisualAnalysis }
