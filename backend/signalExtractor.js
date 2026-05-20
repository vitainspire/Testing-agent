
// -------------------------------------------------------------------
// signalExtractor.js
//
// Pulls every meaningful text signal out of a crawl report and returns
// a flat array of normalized (lowercase, trimmed) strings.
//
// Signal sources, in priority order:
//   1. Button texts stored per page in report.components
//   2. Link texts stored per page in report.components
//   3. Heading texts stored per page in report.components
//   4. Page titles stored per page in report.components
//   5. Repeated workflow pattern labels
//   6. Executed-check target text (parsed from "role::text" format)
//   7. Detected test case action / pattern fields
//   8. URL path segments (stripped of numeric IDs)
//
// None of these sources require network calls — they all come from the
// in-memory report built by testingAgent.js.
// -------------------------------------------------------------------

// Words that carry no semantic meaning and would just add noise.
const NOISE_WORDS = new Set([
  'button', 'link', 'a', 'div', 'span', 'click', 'here', 'more',
  'ok', 'yes', 'no', 'cancel', 'close', 'open', 'go', 'next',
  'back', 'new', 'add', 'edit', 'delete', 'save', 'submit',
  'stale', 'undefined', 'null', 'true', 'false',
])

function normalize(text) {
  return (text || '').trim().toLowerCase()
}

function isUseful(text) {
  if (!text || text.length < 2 || text.length > 80) return false
  if (NOISE_WORDS.has(text))                          return false
  if (/^\d+$/.test(text))                             return false  // pure numbers
  return true
}

// Parse "role::text" format produced by getElementIdentifier()
function parseTargetText(target) {
  if (!target) return ''
  const parts = target.split('::')
  return parts.length >= 2 ? parts.slice(1).join('::') : ''
}

// Extract meaningful path segments from a URL string.
// Drops numeric IDs, UUIDs, and single-char segments.
function urlPathSegments(url) {
  try {
    return new URL(url).pathname
      .split('/')
      .map(s => s.replace(/-/g, ' ').replace(/_/g, ' ').trim())
      .filter(s =>
        s.length > 2 &&
        !s.match(/^[0-9a-f-]{8,}$/i) &&   // UUIDs
        !/^\d+$/.test(s)                   // pure numeric IDs
      )
  } catch {
    return []
  }
}

// -------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------
function extractSignals(report) {
  const raw = []

  // 1–4. Per-page component data (requires testingAgent to store these fields)
  for (const comp of Object.values(report.components || {})) {
    raw.push(...(comp.buttonTexts  || []))
    raw.push(...(comp.linkTexts    || []))
    raw.push(...(comp.headingTexts || []))
    if (comp.pageTitle) raw.push(comp.pageTitle)
  }

  // 5. Repeated workflow pattern labels — highest quality signal
  for (const wp of report.workflowPatterns || []) {
    if (wp.pattern) raw.push(wp.pattern)
  }

  // 6. All executed interaction targets
  for (const check of report.executedChecks || []) {
    const text = parseTargetText(check.target)
    if (text) raw.push(text)
  }

  // 7. Detected test case labels
  for (const tc of report.detectedTestCases || []) {
    if (tc.action)  raw.push(tc.action.replace('Validate button: ', ''))
    if (tc.pattern) raw.push(tc.pattern)
  }

  // 8. URL path segments from every page visited
  for (const url of Object.keys(report.components || {})) {
    raw.push(...urlPathSegments(url))
  }
  for (const wf of report.workflows || []) {
    if (wf.to) raw.push(...urlPathSegments(wf.to))
  }

  // Normalize and deduplicate
  const normalized = [
    ...new Set(raw.map(normalize).filter(isUseful))
  ]

  return normalized
}

module.exports = { extractSignals }
