// -------------------------------------------------------------------
// qaAnalysisAgent.js
// Phase 18 — AI QA Analysis Engine
//
// Uses Gemini to generate a business-focused QA risk analysis from
// execution traces, assertions, workflow coverage, and failure patterns.
//
// Output shape:
// {
//   businessRiskSummary:  string,
//   workflowGaps:         string[],
//   untestedCriticalFlows: string[],
//   flakyInteractions:    string[],
//   uxConcerns:           string[],
//   accessibilityConcerns: string[],
//   performanceConcerns:  string[],
//   analysedBy:           'llm' | 'deterministic',
// }
// -------------------------------------------------------------------

const { callGemini } = require('./geminiClient')

function buildQAAnalysisPrompt(report) {
  const s = report.summary || {}
  const patterns = (report.workflowPatterns || []).slice(0, 20)
  const failures = (report.executedChecks || []).filter(c => c.status === 'fail' || c.status === 'error').slice(0, 10)
  const assertions = (report.assertions || [])
  const missing = (report.missingWorkflows || []).slice(0, 10)

  const assertSummary = assertions.length > 0
    ? `${assertions.filter(a => a.passed).length}/${assertions.length} assertions passed. Failed: [${assertions.filter(a => !a.passed).map(a => a.assertion).join(', ')}]`
    : 'No business assertions recorded.'

  const patternSummary = patterns.map(p =>
    `  - "${p.pattern}" (×${p.occurrences}): ${p.status} [${p.outcomeCategory}]`
  ).join('\n')

  const failureSummary = failures.map(f =>
    `  - ${f.target}: ${f.outcome}`
  ).join('\n')

  return `You are a senior QA analyst reviewing automated test results for a web application.

APPLICATION TYPE: ${report.useCase?.applicationType || 'Unknown'}
BUSINESS DESCRIPTION: ${report.useCase?.businessDescription || 'Not available'}

EXECUTION SUMMARY:
- Pages crawled: ${s.pages || 0}
- Tests executed: ${s.executedTests || 0}
- Passed: ${s.passedTests || 0} | Failed: ${s.failedTests || 0} | No Change: ${s.noChangeTests || 0} | Errors: ${s.errorTests || 0}
- Workflow Coverage: ${s.workflowCoverage || 0}%
- Execution Quality Score: ${s.executionQualityScore || 0}/100 (${s.qualityCategory || 'Weak'})

BUSINESS ASSERTIONS:
${assertSummary}

WORKFLOW PATTERNS EXECUTED:
${patternSummary || '  (none)'}

MISSING WORKFLOWS (detected but not executed):
${missing.length > 0 ? missing.map(m => `  - ${m}`).join('\n') : '  (none)'}

TECHNICAL FAILURES:
${failureSummary || '  (none)'}

Based on this data, provide a QA risk analysis in this EXACT JSON format:
{
  "businessRiskSummary": "2-3 sentence summary of overall business risk",
  "workflowGaps": ["gap 1", "gap 2", "gap 3"],
  "untestedCriticalFlows": ["flow 1", "flow 2"],
  "flakyInteractions": ["interaction that appeared unstable", "..."],
  "uxConcerns": ["concern 1", "concern 2"],
  "accessibilityConcerns": ["concern 1"],
  "performanceConcerns": ["concern 1"]
}

Be specific and actionable. Base findings strictly on the data provided.`
}

function buildDeterministicQAResult(report) {
  const s = report.summary || {}
  const missing = report.missingWorkflows || []
  const failures = (report.executedChecks || []).filter(c => c.status === 'fail')
  const errors = (report.executedChecks || []).filter(c => c.status === 'error')

  const risk = s.failedTests > 0 || s.executionQualityScore < 40
    ? 'High risk: multiple test failures detected. Core workflows may be broken.'
    : s.workflowCoverage < 50
    ? 'Moderate risk: low workflow coverage. Many interactions were not validated.'
    : 'Low risk: execution quality is acceptable, continue monitoring.'

  return {
    businessRiskSummary:    risk,
    workflowGaps:           missing.slice(0, 5),
    untestedCriticalFlows:  missing.filter(m => /login|checkout|cart|payment/.test(m)).slice(0, 3),
    flakyInteractions:      errors.slice(0, 3).map(e => `${e.target}: ${(e.outcome || '').slice(0, 60)}`),
    uxConcerns:             s.noChangeTests > s.passedTests ? ['High no-change rate may indicate undetected UI state changes'] : [],
    accessibilityConcerns:  [],
    performanceConcerns:    [],
    analysedBy:             'deterministic',
  }
}

async function runQAAnalysisAgent(report, log) {
  const rawKey = process.env.GEMINI_API_KEY || ''
  const apiKey = rawKey.trim()

  log.usecase(0, `[QA-ANALYSIS] starting  key=${apiKey.length > 0 ? 'present' : 'absent'}`)

  if (!apiKey) {
    log.usecase(0, '[QA-ANALYSIS] no API key — using deterministic analysis')
    return buildDeterministicQAResult(report)
  }

  try {
    const prompt = buildQAAnalysisPrompt(report)
    log.llm(0, `[QA-ANALYSIS] prompt length=${prompt.length}`)
    const raw = await callGemini(prompt, log)

    const result = {
      businessRiskSummary:    typeof raw.businessRiskSummary    === 'string'  ? raw.businessRiskSummary    : '',
      workflowGaps:           Array.isArray(raw.workflowGaps)                 ? raw.workflowGaps           : [],
      untestedCriticalFlows:  Array.isArray(raw.untestedCriticalFlows)        ? raw.untestedCriticalFlows  : [],
      flakyInteractions:      Array.isArray(raw.flakyInteractions)            ? raw.flakyInteractions      : [],
      uxConcerns:             Array.isArray(raw.uxConcerns)                   ? raw.uxConcerns             : [],
      accessibilityConcerns:  Array.isArray(raw.accessibilityConcerns)        ? raw.accessibilityConcerns  : [],
      performanceConcerns:    Array.isArray(raw.performanceConcerns)          ? raw.performanceConcerns    : [],
      analysedBy:             'llm',
    }
    log.usecase(0, `[QA-ANALYSIS] complete  gaps=${result.workflowGaps.length}  risks=${result.untestedCriticalFlows.length}`)
    return result
  } catch (err) {
    log.fail(0, `[QA-ANALYSIS] LLM failed: ${err.message} — falling back to deterministic`)
    return buildDeterministicQAResult(report)
  }
}

module.exports = { runQAAnalysisAgent }
