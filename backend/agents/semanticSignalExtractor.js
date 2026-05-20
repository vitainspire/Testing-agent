
// -------------------------------------------------------------------
// semanticSignalExtractor.js
//
// Extracts STRUCTURED semantic signals from a completed crawl report
// for LLM consumption. Unlike the flat-array signalExtractor.js used
// by the deterministic classifier, this module preserves per-page
// context so the LLM can reason about what appeared WHERE.
//
// Signal sources:
//   - Per-page buttonTexts, linkTexts, headingTexts, pageTitle
//   - Repeated workflow action labels (highest-signal data)
//   - URL path segments from every visited page
//   - Auth / portal labels from multi-session crawls
//   - Interaction targets from executed checks
// -------------------------------------------------------------------

const MAX_PAGES_IN_PROMPT     = 10   // keep prompt focused and within token limits
const MAX_ITEMS_PER_FIELD     = 12
const MAX_INTERACTION_TARGETS = 25

// Pages with more headings + buttons + links are more information-dense.
// We sort by this score and keep the top N before sending to the LLM.
function signalScore(comp) {
  return (comp.headingTexts || []).length +
         (comp.buttonTexts  || []).length +
         (comp.linkTexts    || []).length
}

function extractRichSignals(report) {

  // ---- Per-page contexts ----
  const allContexts = Object.entries(report.components || {}).map(([url, comp]) => ({
    url,
    title:           comp.pageTitle                                            || '',
    headings:        (comp.headingTexts    || []).slice(0, MAX_ITEMS_PER_FIELD),
    buttons:         (comp.buttonTexts     || []).slice(0, MAX_ITEMS_PER_FIELD),
    links:           (comp.linkTexts       || []).slice(0, MAX_ITEMS_PER_FIELD),
    repeatedActions: (comp.repeatedRowActions || []).map(r => r.label),
    formCount:       comp.forms  || 0,
    inputCount:      comp.inputs || 0,
    _score:          signalScore(comp),
  }))

  const pageContexts = allContexts
    .sort((a, b) => b._score - a._score)
    .slice(0, MAX_PAGES_IN_PROMPT)
    .map(({ _score, ...p }) => p)   // drop internal sort key

  // ---- URL path segments ----
  const rawPaths = [
    ...Object.keys(report.components || {}),
    ...(report.workflows || []).map(w => w.to).filter(Boolean),
  ]
  const workflowPaths = [...new Set(
    rawPaths
      .map(url => { try { return new URL(url).pathname } catch { return '' } })
      .filter(p => p && p !== '/' && p.length > 1)
      // normalise numeric / UUID segments so paths read as patterns, not IDs
      .map(p => p
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
        .replace(/\/\d+/g, '/{id}')
      )
  )].slice(0, 20)

  // ---- Auth / portal labels ----
  // Prefer the inferred role name over the raw session name —
  // "Doctor" is more meaningful to the LLM than "Doctor Console".
  // workflowSessions has both .role (from Phase 1 detection) and .name (raw label).
  const sessionRoles = (report.workflowSessions || [])
    .map(s => s.role || s.name)
    .filter(n => n && n !== 'default' && n !== 'User')

  // Full entry labels give additional context when role inference was lossy
  const sessionLabels = (report.workflowSessions || [])
    .map(s => s.name)
    .filter(n => n && n !== 'default' && n !== 'User' && !sessionRoles.includes(n))

  const loginPagePaths = (report.executedChecks || [])
    .filter(c => c.type === 'login')
    .map(c => { try { return new URL(c.page).pathname } catch { return '' } })
    .filter(Boolean)

  const authLabels = [...new Set([...sessionRoles, ...sessionLabels, ...loginPagePaths])]

  // ---- Repeated workflow actions (highest-signal data) ----
  const workflowActionLabels = [...new Set([
    ...(report.workflowPatterns  || []).map(w => w.pattern),
    ...(report.detectedTestCases || [])
      .filter(t => t.component === 'RepeatedRowAction' && t.pattern)
      .map(t => t.pattern),
  ])].slice(0, 20)

  // ---- Interaction targets (sampled from actual Playwright clicks) ----
  const interactionTargets = [...new Set(
    (report.executedChecks || [])
      .map(c => {
        const parts = (c.target || '').split('::')
        return parts.length >= 2 ? parts.slice(1).join('::').trim() : ''
      })
      .filter(t => t.length > 1 && !t.startsWith('stale') && !/^\d+$/.test(t))
  )].slice(0, MAX_INTERACTION_TARGETS)

  // ---- Summary stats ----
  const comps = Object.values(report.components || {})
  const summary = {
    totalPages:       comps.length,
    totalForms:       comps.reduce((s, c) => s + (c.forms         || 0), 0),
    totalInputs:      comps.reduce((s, c) => s + (c.inputs        || 0), 0),
    totalButtons:     comps.reduce((s, c) => s + (c.uniqueButtons || 0), 0),
    repeatedPatterns: workflowActionLabels.length,
  }

  return {
    pageContexts,
    workflowPaths,
    authLabels,
    workflowActionLabels,
    interactionTargets,
    summary,
  }
}

module.exports = { extractRichSignals }
