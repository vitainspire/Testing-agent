
import { useState } from 'react'
import axios from 'axios'

export default function App() {

  const [url, setUrl]           = useState('https://www.saucedemo.com')
  const [username, setUsername] = useState('standard_user')
  const [password, setPassword] = useState('secret_sauce')
  const [report, setReport]     = useState(null)
  const [loading, setLoading]   = useState(false)

  const startTesting = async () => {
    setLoading(true)
    try {
      const response = await axios.post('http://localhost:5000/api/start-test', {
        appUrl: url, username, password
      })
      setReport(response.data.report)
    } catch (error) {
      alert('Testing Failed')
      console.log(error)
    }
    setLoading(false)
  }

  const card = {
    background: '#fff',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.1)'
  }

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100vh', padding: '30px', fontFamily: 'Arial' }}>

      <h1 style={{ marginBottom: '20px' }}>AI Autonomous Testing Platform</h1>

      <div style={{ ...card, marginBottom: '20px' }}>
        <input
          placeholder='Application URL'
          value={url}
          onChange={e => setUrl(e.target.value)}
          style={inputStyle}
        />
        <input
          placeholder='Username (optional)'
          value={username}
          onChange={e => setUsername(e.target.value)}
          style={inputStyle}
        />
        <input
          type='password'
          placeholder='Password (optional)'
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={inputStyle}
        />
        <button
          onClick={startTesting}
          style={{
            padding: '12px 20px', border: 'none', borderRadius: '10px',
            background: '#2563eb', color: 'white', cursor: 'pointer',
            fontSize: '15px'
          }}
        >
          {loading ? 'Testing...' : 'Start Testing'}
        </button>
      </div>

      {report && (
        <>
          {/* Multi-workflow session breakdown — only rendered when > 1 session ran */}
          {report.workflowSessions && report.workflowSessions.length > 1 && (
            <WorkflowSessionsBar sessions={report.workflowSessions} />
          )}

          {/* Use-Case Classification — shown first so the user immediately
              understands what kind of app was detected */}
          {report.useCase && (
            <UseCaseCard useCase={report.useCase} />
          )}

          {/* Gemini Visual Analysis — shown when GEMINI_API_KEY was set */}
          {report.visualAnalysis && (
            <VisualAnalysisSection analysis={report.visualAnalysis} />
          )}

          {/*
            Summary bar — six distinct metrics so users immediately
            understand detected vs executed vs outcome breakdown.
            Uses auto-fit grid so it wraps cleanly on smaller screens.
          */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '16px',
            marginBottom: '24px'
          }}>
            <MetricCard
              title='Pages Crawled'
              value={report.summary.pages}
              color='#1e293b'
            />
            <MetricCard
              title='Detected Tests'
              value={report.summary.detectedTests}
              color='#2563eb'
              hint='Unique test scenarios discovered by crawling the DOM'
            />
            <MetricCard
              title='Executed'
              value={report.summary.executedTests}
              color='#7c3aed'
              hint='Tests that ran to completion: pass + fail + noChange + error (skipped excluded)'
            />
            <MetricCard
              title='Passed'
              value={report.summary.passedTests}
              color='#16a34a'
              hint='Test runs that produced a meaningful state change'
            />
            <MetricCard
              title='Failed'
              value={report.summary.failedTests}
              color='#dc2626'
              hint='Test runs with an application-level failure outcome'
            />
            <MetricCard
              title='No Change'
              value={report.summary.noChangeTests ?? 0}
              color='#7c3aed'
              hint='Test ran and completed — no observable state change detected (valid outcome)'
            />
            <MetricCard
              title='Skipped'
              value={report.summary.skippedTests}
              color='#d97706'
              hint='Tests not attempted: cap reached or element not found'
            />
            <MetricCard
              title='Errors'
              value={report.summary.errorTests ?? 0}
              color='#b45309'
              hint='Technical execution failures: timeout, element detached, or infrastructure error'
            />
            <MetricCard
              title='Workflow Patterns'
              value={report.summary.workflowPatterns}
              color='#0891b2'
              hint='Unique repeated interaction patterns detected (deduplicated)'
            />
            <MetricCard
              title='Crawl Actions'
              value={report.summary.crawlInteractions}
              color='#64748b'
              hint='General crawler interactions — exploration clicks, not test executions'
            />
            <MetricCard
              title='Accuracy'
              value={`${report.summary.executionAccuracy ?? 0}%`}
              color='#059669'
              hint='Percentage of executed tests that passed'
            />
            <MetricCard
              title='Workflow Coverage'
              value={`${report.summary.workflowCoverage ?? 0}%`}
              color='#0891b2'
              hint='Percentage of detected workflow patterns that produced a passing outcome'
            />
            <MetricCard
              title='Quality Score'
              value={`${report.summary.executionQualityScore ?? 0}`}
              color={
                (report.summary.executionQualityScore ?? 0) >= 80 ? '#16a34a' :
                (report.summary.executionQualityScore ?? 0) >= 60 ? '#d97706' : '#dc2626'
              }
              hint={`Execution quality: ${report.summary.qualityCategory ?? 'Weak'} (assertion rate, coverage, pass rate, error rate)`}
            />
            <MetricCard
              title='Assertions'
              value={`${report.summary.assertionPassCount ?? 0}/${report.summary.assertionCount ?? 0}`}
              color='#7c3aed'
              hint='Business assertions: passed / total'
            />
            <MetricCard
              title='Expected Workflows'
              value={report.summary.expectedWorkflowCount ?? 0}
              color='#0891b2'
              hint='Business workflows expected for this application type'
            />
            <MetricCard
              title='Completed Workflows'
              value={`${report.summary.completedWorkflowCount ?? 0}/${report.summary.expectedWorkflowCount ?? 0}`}
              color='#059669'
              hint='Business workflows with confirmed execution evidence / total expected'
            />
            <MetricCard
              title='Flaky Actions'
              value={report.summary.flakyActionCount ?? 0}
              color='#7c3aed'
              hint='Actions showing inconsistent outcomes or high retry counts'
            />
            <MetricCard
              title='Missing Workflows'
              value={report.missingWorkflows?.length ?? 0}
              color='#dc2626'
              hint='Expected business workflows not yet completed'
            />
          </div>

          {/* Coverage & Quality panel — data-driven, never static */}
          <CoverageQualityPanel
            summary={report.summary}
            recommendations={report.recommendations}
            assertions={report.assertions || []}
            missingWorkflows={report.missingWorkflows || []}
            qualityFactors={report.qualityFactors || []}
          />

          {/* Business Workflow Coverage */}
          {(report.completedWorkflows?.length > 0 || report.missingWorkflows?.length > 0) && (
            <BusinessWorkflowsPanel
              completed={report.completedWorkflows || []}
              missing={report.missingWorkflows || []}
              expected={report.expectedWorkflows || []}
              coverage={report.summary.workflowCoverage ?? 0}
            />
          )}

          {/* AI QA Risk Analysis */}
          {report.qaAnalysis && (
            <QAAnalysisPanel analysis={report.qaAnalysis} />
          )}

          {/* Assertion Results */}
          {report.assertions && report.assertions.length > 0 && (
            <Section title='Business Assertion Results'>
              <AssertionTable assertions={report.assertions} />
            </Section>
          )}

          {/* Navigation Graph */}
          {report.navigationGraph && report.navigationGraph.nodes.length > 0 && (
            <Section title='Navigation Graph'>
              <NavigationGraphPanel graph={report.navigationGraph} />
            </Section>
          )}

          {/* Flaky Actions */}
          {report.flakyActions && report.flakyActions.length > 0 && (
            <Section title='Flaky Actions'>
              <FlakyActionsPanel actions={report.flakyActions} />
            </Section>
          )}

          {/* Workflow Patterns — representative interaction results, the key new section */}
          <Section title='Workflow Patterns'>
            <WorkflowPatternsTable patterns={report.workflowPatterns} />
          </Section>

          {/* Execution Results — full interaction log */}
          <Section title='Execution Results'>
            <ExecutionTable checks={report.executedChecks} />
          </Section>

          {/* Detected test cases are opportunities, not outcomes */}
          <Section title='Detected Test Cases'>
            <DetectedTestCaseList cases={report.detectedTestCases} />
          </Section>

          <Section title='Components Detected'>
            <pre>{JSON.stringify(report.components, null, 2)}</pre>
          </Section>

          <Section title='Workflow Navigation'>
            <pre>{JSON.stringify(report.workflows, null, 2)}</pre>
          </Section>

          <Section title='Performance Metrics'>
            <pre>{JSON.stringify(report.performance, null, 2)}</pre>
          </Section>

          <Section title='Screenshots'>
            <pre>{JSON.stringify(report.screenshots, null, 2)}</pre>
          </Section>

          <Section title='Recommendations'>
            <pre>{JSON.stringify(report.recommendations, null, 2)}</pre>
          </Section>

          {report.crawlLog && report.crawlLog.length > 0 && (
            <Section title='Crawl Trace'>
              <CrawlTrace entries={report.crawlLog} />
            </Section>
          )}
        </>
      )}

    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const inputStyle = {
  width: '100%', padding: '12px', marginBottom: '12px',
  borderRadius: '8px', border: '1px solid #d1d5db', boxSizing: 'border-box'
}

// Status badge palette — covers every status value the backend can emit
const STATUS_BADGE = {
  pass:           { background: '#dcfce7', color: '#15803d' },
  fail:           { background: '#fee2e2', color: '#b91c1c' },
  noChange:       { background: '#f1f5f9', color: '#64748b' },
  error:          { background: '#fef3c7', color: '#b45309' },
  skipped:        { background: '#f3f4f6', color: '#9ca3af' },
  detected:       { background: '#eff6ff', color: '#1d4ed8' },
  representative: { background: '#fdf4ff', color: '#7e22ce' },
}

function statusBadgeStyle(status) {
  return STATUS_BADGE[status] || { background: '#f1f5f9', color: '#475569' }
}

// Outcome category badge palette — maps classifyOutcome categories to colors
// so the dashboard shows what KIND of state change each interaction caused.
const CATEGORY_BADGE = {
  // navigation
  'navigation':          { background: '#dbeafe', color: '#1d4ed8' },
  'hash-navigation':     { background: '#bfdbfe', color: '#1e40af' },
  'title-changed':       { background: '#dbeafe', color: '#1d4ed8' },
  // modals
  'modal-opened':        { background: '#fdf4ff', color: '#7e22ce' },
  'modal-closed':        { background: '#f3f4f6', color: '#374151' },
  // inline editing
  'inline-edit-opened':  { background: '#fef9c3', color: '#854d0e' },
  'inline-edit-closed':  { background: '#f3f4f6', color: '#374151' },
  // form reveal
  'form-revealed':       { background: '#fef9c3', color: '#854d0e' },
  'form-hidden':         { background: '#f3f4f6', color: '#374151' },
  // validation
  'validation-triggered':{ background: '#fee2e2', color: '#b91c1c' },
  'validation-cleared':  { background: '#dcfce7', color: '#15803d' },
  // table mutations
  'rows-added':          { background: '#d1fae5', color: '#065f46' },
  'rows-removed':        { background: '#fff7ed', color: '#c2410c' },
  // tabs & selection
  'tab-switched':        { background: '#ede9fe', color: '#5b21b6' },
  'selection-changed':   { background: '#ede9fe', color: '#5b21b6' },
  'checked-changed':     { background: '#f0fdf4', color: '#15803d' },
  // accordions
  'content-expanded':    { background: '#d1fae5', color: '#065f46' },
  'content-collapsed':   { background: '#f3f4f6', color: '#374151' },
  // structural / text
  'structure-changed':   { background: '#fef3c7', color: '#92400e' },
  'content-added':       { background: '#d1fae5', color: '#065f46' },
  'content-removed':     { background: '#fff7ed', color: '#c2410c' },
  // sidebar
  'sidebar-opened':      { background: '#ecfdf5', color: '#065f46' },
  'sidebar-closed':      { background: '#f3f4f6', color: '#374151' },
  // fine-grained UI diff signals
  'counter-update':      { background: '#fef9c3', color: '#854d0e' },
  'async-update':        { background: '#e0f2fe', color: '#0369a1' },
  'state-change':        { background: '#d1fae5', color: '#065f46' },
  'content-update':      { background: '#fdf4ff', color: '#7e22ce' },
  // boundary enforcement
  'external-blocked':    { background: '#fee2e2', color: '#b91c1c' },
  // fallbacks
  'dom-change':          { background: '#f3f4f6', color: '#374151' },
  'no-change':           { background: '#f3f4f6', color: '#9ca3af' },
  'error':               { background: '#fee2e2', color: '#b91c1c' },
}

function categoryBadgeStyle(category) {
  return CATEGORY_BADGE[category] || { background: '#f3f4f6', color: '#374151' }
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

// Derives an accent colour from the descriptive applicationType string returned by the LLM.
// Pure cosmetics — keyword matching only, no business logic.
function pickAccentColors(applicationType) {
  const t = (applicationType || '').toLowerCase()
  if (/e[- ]?commerce|shop|cart|inventory|retail|product|store/.test(t))   return { bg: '#eff6ff', accent: '#2563eb', text: '#1d4ed8' }
  if (/financ|bank|payment|invoice|billing|accounting|wallet/.test(t))      return { bg: '#f0fdf4', accent: '#16a34a', text: '#15803d' }
  if (/health|medical|clinic|patient|doctor|hospital|pharma/.test(t))       return { bg: '#fdf4ff', accent: '#9333ea', text: '#7e22ce' }
  if (/educat|learn|course|school|student|academic|lms/.test(t))            return { bg: '#fff7ed', accent: '#ea580c', text: '#c2410c' }
  if (/book|reserv|schedul|appointment|calendar|slot|availab/.test(t))      return { bg: '#f0fdf4', accent: '#0891b2', text: '#0e7490' }
  if (/social|communit|feed|post|follower|profile|network/.test(t))         return { bg: '#fdf4ff', accent: '#db2777', text: '#be185d' }
  if (/admin|dashboard|management|report|analytics|audit/.test(t))          return { bg: '#f8fafc', accent: '#475569', text: '#334155' }
  if (/crm|contact|lead|sales|customer relation|opportunit/.test(t))        return { bg: '#fffbeb', accent: '#d97706', text: '#b45309' }
  if (/project|task|sprint|kanban|milestone|backlog|issue/.test(t))         return { bg: '#eff6ff', accent: '#6366f1', text: '#4338ca' }
  return { bg: '#f0fdf4', accent: '#0f766e', text: '#0f766e' }
}

/**
 * Session breakdown bar — shown only when the crawler ran in multi-workflow mode.
 * Each session gets its own card showing name, page count, and pass/fail metrics.
 */
function WorkflowSessionsBar({ sessions = [] }) {
  if (!sessions || sessions.length <= 1) return null

  return (
    <div style={{ marginBottom: '20px' }}>
      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '10px' }}>
        Workflow Sessions
        <span style={{
          marginLeft: '8px', background: '#ede9fe', color: '#5b21b6',
          padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700'
        }}>
          {sessions.length} isolated contexts
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '12px',
      }}>
        {sessions.map((s, i) => {
          const passed = s.summary?.passedTests ?? 0
          const failed = s.summary?.failedTests ?? 0
          const pages  = s.summary?.pages       ?? 0
          const accent = failed > 0 ? '#dc2626' : passed > 0 ? '#16a34a' : '#94a3b8'
          return (
            <div key={i} style={{
              background: '#fff', borderRadius: '12px', padding: '14px 16px',
              boxShadow: '0 1px 6px rgba(0,0,0,0.07)', borderLeft: `4px solid ${accent}`,
            }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#1e293b', marginBottom: '6px' }}>
                {s.name}
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                <span style={{ color: '#64748b' }}>{pages} pages</span>
                <span style={{ color: '#15803d', fontWeight: '600' }}>{passed} pass</span>
                {failed > 0 && (
                  <span style={{ color: '#b91c1c', fontWeight: '600' }}>{failed} fail</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const sectionLabel = {
  fontSize: '10px', fontWeight: '700', color: '#64748b',
  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px',
}

/**
 * Semantic application understanding card.
 * Shown immediately after a crawl — summarises what the platform IS,
 * what it DOES, who uses it, what workflows were detected, and why
 * the AI reached its conclusion.
 */
function UseCaseCard({ useCase }) {
  const colors = pickAccentColors(useCase.applicationType)
  const pct    = Math.round((useCase.confidence || 0) * 100)

  return (
    <div style={{
      background:   colors.bg,
      borderRadius: '16px',
      padding:      '28px',
      marginBottom: '20px',
      boxShadow:    '0 2px 16px rgba(0,0,0,0.09)',
      borderLeft:   `6px solid ${colors.accent}`,
    }}>

      {/* ── Application Summary ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '20px' }}>
        <div style={{ flex: 1 }}>
          <div style={sectionLabel}>Application Summary</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: colors.text, lineHeight: 1.2 }}>
            {useCase.applicationType || 'Unknown Application'}
          </div>
        </div>

        {/* Confidence */}
        <div style={{ textAlign: 'right', minWidth: '72px' }}>
          <div style={sectionLabel}>Confidence</div>
          <div style={{ fontSize: '30px', fontWeight: '800', color: colors.accent, lineHeight: 1 }}>
            {pct}%
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div style={{ height: '5px', background: '#e2e8f0', borderRadius: '999px', marginBottom: '22px' }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: colors.accent, borderRadius: '999px',
          transition: 'width 0.7s ease',
        }} />
      </div>

      {/* ── Business Description ── */}
      {useCase.businessDescription && (
        <div style={{ marginBottom: '20px' }}>
          <div style={sectionLabel}>Business Description</div>
          <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: 1.65 }}>
            {useCase.businessDescription}
          </p>
        </div>
      )}

      {/* ── Core Workflows + Detected Roles (side by side) ── */}
      {((useCase.coreWorkflows && useCase.coreWorkflows.length > 0) ||
        (useCase.detectedRoles && useCase.detectedRoles.length > 0)) && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
          marginBottom: '20px',
        }}>

          {useCase.coreWorkflows && useCase.coreWorkflows.length > 0 && (
            <div>
              <div style={sectionLabel}>Core Workflows</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {useCase.coreWorkflows.map((w, i) => (
                  <span key={i} style={{
                    background: colors.accent, color: '#fff',
                    padding: '4px 12px', borderRadius: '999px',
                    fontSize: '12px', fontWeight: '600',
                  }}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}

          {useCase.detectedRoles && useCase.detectedRoles.length > 0 && (
            <div>
              <div style={sectionLabel}>Detected Roles</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {useCase.detectedRoles.map((r, i) => (
                  <span key={i} style={{
                    background: '#fff', border: `1.5px solid ${colors.accent}`,
                    color: colors.text, padding: '4px 12px', borderRadius: '999px',
                    fontSize: '12px', fontWeight: '600',
                  }}>
                    {r}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AI Reasoning ── */}
      {useCase.reasoning && useCase.reasoning.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.55)', borderRadius: '10px',
          padding: '14px 16px',
        }}>
          <div style={sectionLabel}>AI Reasoning</div>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {useCase.reasoning.map((r, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#334155', marginBottom: '5px', lineHeight: 1.55 }}>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

    </div>
  )
}

/**
 * Metric card with a colored top border and optional tooltip hint.
 * Color encodes meaning at a glance: blue=info, green=good, red=bad, amber=neutral.
 */
function MetricCard({ title, value, color = '#1e293b', hint }) {
  return (
    <div
      title={hint}
      style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '20px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        borderTop: `4px solid ${color}`,
        cursor: hint ? 'help' : 'default'
      }}
    >
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </div>
      <div style={{ fontSize: '38px', fontWeight: '700', color, lineHeight: 1 }}>
        {value ?? 0}
      </div>
    </div>
  )
}

/**
 * Table of every real Playwright interaction with its outcome.
 * Representative rows (from repeated patterns) are highlighted with a
 * purple left border so they stand out from regular clicks.
 */
function ExecutionTable({ checks = [] }) {
  if (checks.length === 0) {
    return (
      <p style={{ color: '#94a3b8', margin: 0 }}>
        No interactions were executed during this crawl.
      </p>
    )
  }

  const thStyle = {
    textAlign: 'left',
    padding: '10px 14px',
    background: '#f8fafc',
    borderBottom: '2px solid #e2e8f0',
    fontSize: '11px',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap'
  }

  const tdStyle = {
    padding: '10px 14px',
    borderBottom: '1px solid #f1f5f9',
    fontSize: '13px',
    verticalAlign: 'top'
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: '36px' }}>#</th>
            <th style={thStyle}>Session</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Target</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Outcome</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>ms</th>
            <th style={{ ...thStyle, textAlign: 'center' }}>Retries</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((check, i) => {
            const isRep    = check.type === 'representative'
            const rowBg    = isRep ? '#fdf4ff' : (i % 2 === 0 ? '#fff' : '#fafafa')
            const leftBorder = isRep ? '3px solid #7e22ce' : '3px solid transparent'
            return (
              <tr key={i} style={{ background: rowBg, borderLeft: leftBorder }}>
                <td style={{ ...tdStyle, color: '#94a3b8' }}>{i + 1}</td>
                <td style={{ ...tdStyle, color: '#64748b', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  {check.workflowName && check.workflowName !== 'default' ? (
                    <span style={{
                      background: '#ede9fe', color: '#5b21b6',
                      padding: '2px 7px', borderRadius: '999px',
                      fontSize: '11px', fontWeight: '600'
                    }}>
                      {check.workflowName}
                    </span>
                  ) : '—'}
                </td>
                <td style={{ ...tdStyle, color: '#475569' }}>
                  <span style={{
                    ...statusBadgeStyle(isRep ? 'representative' : check.type),
                    padding: '2px 8px',
                    borderRadius: '999px',
                    fontSize: '11px',
                    fontWeight: '600',
                    textTransform: 'capitalize'
                  }}>
                    {check.type}
                  </span>
                  {isRep && check.patternOccurrences && (
                    <div style={{ fontSize: '11px', color: '#9333ea', marginTop: '3px' }}>
                      ×{check.patternOccurrences} occurrences
                    </div>
                  )}
                </td>
                <td style={{
                  ...tdStyle,
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  maxWidth: '200px',
                  wordBreak: 'break-all',
                  color: '#1e293b'
                }}>
                  {check.target}
                </td>
                <td style={tdStyle}>
                  {check.outcomeCategory && (
                    <span style={{
                      ...categoryBadgeStyle(check.outcomeCategory),
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '11px',
                      fontWeight: '600'
                    }}>
                      {check.outcomeCategory}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  <span style={{
                    ...statusBadgeStyle(check.status),
                    padding: '3px 10px',
                    borderRadius: '999px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {check.status}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: '#475569' }}>{check.outcome}</td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' }}>
                  {check.durationMs != null ? check.durationMs : '—'}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {check.retryCount > 0 ? (
                    <span style={{
                      background: '#fef3c7', color: '#b45309',
                      padding: '1px 7px', borderRadius: '999px',
                      fontSize: '11px', fontWeight: '700'
                    }}>
                      {check.retryCount}
                    </span>
                  ) : (
                    <span style={{ color: '#d1d5db', fontSize: '11px' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Dedicated view for representative interaction results.
 * Shows which repeated patterns were found, which element was used
 * as the representative, and what state change it produced.
 * This is separate from ExecutionTable so the signal isn't buried
 * in general click noise.
 */
function WorkflowPatternsTable({ patterns = [] }) {
  if (patterns.length === 0) {
    return (
      <p style={{ color: '#94a3b8', margin: 0 }}>
        No repeated interaction patterns were detected on this crawl.
      </p>
    )
  }

  const thStyle = {
    textAlign: 'left',
    padding: '10px 14px',
    background: '#fdf4ff',
    borderBottom: '2px solid #e9d5ff',
    fontSize: '11px',
    color: '#7e22ce',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap'
  }

  const tdStyle = {
    padding: '10px 14px',
    borderBottom: '1px solid #faf5ff',
    fontSize: '13px',
    verticalAlign: 'top'
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Pattern</th>
            <th style={thStyle}>Occurrences</th>
            <th style={thStyle}>Representative Element</th>
            <th style={thStyle}>Outcome Category</th>
            <th style={thStyle}>Outcome</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {patterns.map((p, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fefbff' }}>
              <td style={{ ...tdStyle, fontWeight: '600', color: '#1e293b' }}>
                "{p.pattern}"
              </td>
              <td style={tdStyle}>
                <span style={{
                  background: '#ede9fe',
                  color: '#5b21b6',
                  padding: '2px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: '700'
                }}>
                  ×{p.occurrences}
                </span>
              </td>
              <td style={{
                ...tdStyle,
                fontFamily: 'monospace',
                fontSize: '12px',
                maxWidth: '200px',
                wordBreak: 'break-all',
                color: '#475569'
              }}>
                {p.representativeId}
              </td>
              <td style={tdStyle}>
                <span style={{
                  ...categoryBadgeStyle(p.outcomeCategory),
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: '600'
                }}>
                  {p.outcomeCategory}
                </span>
              </td>
              <td style={{ ...tdStyle, color: '#475569' }}>{p.outcome}</td>
              <td style={tdStyle}>
                <span style={{
                  ...statusBadgeStyle(p.status),
                  padding: '3px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Groups detected test cases by component type so the list is scannable.
 * Each entry shows what was found and what tests would validate it —
 * NOT whether those tests passed, because they were never run.
 */
function DetectedTestCaseList({ cases = [] }) {
  if (cases.length === 0) {
    return <p style={{ color: '#94a3b8', margin: 0 }}>No test cases were detected.</p>
  }

  // Group by component type for a cleaner read
  const groups = {}
  for (const tc of cases) {
    const key = tc.component || 'Other'
    if (!groups[key]) groups[key] = []
    groups[key].push(tc)
  }

  return (
    <div>
      {Object.entries(groups).map(([component, items]) => (
        <div key={component} style={{ marginBottom: '20px' }}>
          <div style={{
            fontSize: '13px',
            fontWeight: '700',
            color: '#1e293b',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span style={{
              background: '#eff6ff',
              color: '#1d4ed8',
              padding: '2px 10px',
              borderRadius: '999px',
              fontSize: '12px'
            }}>
              {component}
            </span>
            <span style={{ color: '#94a3b8', fontWeight: '400' }}>
              {items.length} {items.length === 1 ? 'case' : 'cases'}
            </span>
          </div>

          {items.map((tc, i) => (
            <div key={i} style={{
              background: '#f8fafc',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '6px',
              fontSize: '13px',
              color: '#475569'
            }}>
              <div style={{ color: '#1e293b', marginBottom: tc.tests ? '6px' : 0 }}>
                {tc.action || tc.pattern
                  ? (tc.action || `"${tc.pattern}" × ${tc.occurrences} occurrences`)
                  : tc.page}
              </div>
              {tc.tests && (
                <ul style={{ margin: '4px 0 0 16px', padding: 0, color: '#64748b' }}>
                  {tc.tests.map((t, j) => <li key={j}>{t}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Tag badge palette — mirrors the logger tags in testingAgent.js
const TAG_BADGE = {
  CRAWL:    { background: '#1e293b', color: '#f8fafc' },
  STATE:    { background: '#dbeafe', color: '#1d4ed8' },
  DETECT:   { background: '#d1fae5', color: '#065f46' },
  SCAN:     { background: '#f3f4f6', color: '#374151' },
  SELECT:   { background: '#ede9fe', color: '#5b21b6' },
  EXECUTE:  { background: '#fdf4ff', color: '#7e22ce' },
  WORKFLOW: { background: '#f0fdf4', color: '#15803d' },
  LOGIN:    { background: '#fff7ed', color: '#c2410c' },
  SHOT:     { background: '#f1f5f9', color: '#64748b' },
  CLICK:    { background: '#f1f5f9', color: '#475569' },
  PASS:     { background: '#dcfce7', color: '#15803d' },
  NOCHANGE: { background: '#f1f5f9', color: '#9ca3af' },
  FAIL:     { background: '#fee2e2', color: '#b91c1c' },
  SKIP:     { background: '#fef9c3', color: '#92400e' },
  LIMIT:    { background: '#fff7ed', color: '#c2410c' },
  RECURSE:  { background: '#dbeafe', color: '#1d4ed8' },
  BACK:     { background: '#f1f5f9', color: '#64748b' },
  PATTERN:  { background: '#ede9fe', color: '#5b21b6' },
  DISMISS:  { background: '#f1f5f9', color: '#64748b' },
  IGNORE:   { background: '#f3f4f6', color: '#9ca3af' },
  ALLOW:    { background: '#dcfce7', color: '#15803d' },
  BLOCK:    { background: '#fee2e2', color: '#b91c1c' },
  SCOPE:    { background: '#f0fdf4', color: '#166534' },
  WFLOW:    { background: '#ede9fe', color: '#5b21b6' },
  CTX:      { background: '#e0f2fe', color: '#0369a1' },
  AUTH:     { background: '#fff7ed', color: '#c2410c' },
  SWITCH:   { background: '#fdf4ff', color: '#7e22ce' },
  MERGE:    { background: '#f0fdf4', color: '#065f46' },
  ANALYZE:  { background: '#fef9c3', color: '#854d0e' },
  USECASE:  { background: '#eff6ff', color: '#2563eb' },
  LLM:      { background: '#fdf4ff', color: '#7e22ce' },
  CLASSIFY: { background: '#d1fae5', color: '#065f46' },
  CONF:     { background: '#fef9c3', color: '#854d0e' },
  DONE:      { background: '#1e293b', color: '#f8fafc' },
  RETRY:     { background: '#fef3c7', color: '#b45309' },
  RECOVER:   { background: '#fff7ed', color: '#c2410c' },
  'STATE-DIFF': { background: '#e0f2fe', color: '#0369a1' },
  EXECUTION: { background: '#fdf4ff', color: '#7e22ce' },
  METRICS:   { background: '#f0fdf4', color: '#15803d' },
  EXPLORE:   { background: '#ede9fe', color: '#5b21b6' },
  PLAN:      { background: '#fef9c3', color: '#854d0e' },
  WFEXEC:    { background: '#d1fae5', color: '#065f46' },
  ASSERT:    { background: '#fee2e2', color: '#b91c1c' },
  QUALITY:   { background: '#f0fdf4', color: '#15803d' },
  MEMORY:    { background: '#f3f4f6', color: '#64748b' },
  GRAPH:     { background: '#dbeafe', color: '#1d4ed8' },
  CART:      { background: '#fff7ed', color: '#c2410c' },
}

/**
 * Displays the full crawlLog as a terminal-style trace.
 * Each line is indented by depth, the tag is color-coded, and
 * the timestamp is shown on hover via the title attribute.
 * Collapsible so it doesn't dominate the page by default.
 */
function CrawlTrace({ entries = [] }) {
  const [expanded, setExpanded] = useState(false)

  const visible = expanded ? entries : entries.slice(0, 40)

  return (
    <div style={{ fontFamily: 'monospace', fontSize: '12px', lineHeight: '1.6' }}>
      <div
        style={{
          background: '#0f172a',
          borderRadius: '10px',
          padding: '16px',
          overflowX: 'auto',
          maxHeight: expanded ? 'none' : '480px',
          overflowY: expanded ? 'visible' : 'hidden',
          position: 'relative',
        }}
      >
        {visible.map((entry, i) => {
          const tagStyle = TAG_BADGE[entry.tag] || { background: '#334155', color: '#cbd5e1' }
          const indent   = entry.depth * 20

          return (
            <div
              key={i}
              title={entry.timestamp}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                paddingLeft: indent,
                marginBottom: '2px',
                color: '#cbd5e1',
              }}
            >
              <span style={{
                ...tagStyle,
                display: 'inline-block',
                padding: '1px 7px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: '700',
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                marginTop: '1px',
              }}>
                {entry.tag}
              </span>
              <span style={{ color: '#e2e8f0', wordBreak: 'break-word' }}>
                {entry.message}
              </span>
            </div>
          )
        })}

        {!expanded && entries.length > 40 && (
          <div style={{
            position: 'sticky',
            bottom: 0,
            background: 'linear-gradient(transparent, #0f172a)',
            padding: '20px 0 4px',
            textAlign: 'center',
          }}>
            <button
              onClick={() => setExpanded(true)}
              style={{
                background: '#1e293b',
                border: '1px solid #334155',
                color: '#94a3b8',
                borderRadius: '6px',
                padding: '4px 16px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Show all {entries.length} log entries
            </button>
          </div>
        )}
      </div>

      {expanded && entries.length > 40 && (
        <button
          onClick={() => setExpanded(false)}
          style={{
            marginTop: '8px',
            background: 'none',
            border: '1px solid #e2e8f0',
            color: '#64748b',
            borderRadius: '6px',
            padding: '4px 16px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Collapse trace
        </button>
      )}

      <div style={{ marginTop: '8px', color: '#94a3b8', fontSize: '11px' }}>
        {entries.length} log entries · hover a line for its timestamp
      </div>
    </div>
  )
}

/**
 * Gemini visual analysis results.
 * Shows the overall structured summary first (always visible),
 * then per-frame descriptions in an expandable accordion.
 * Only rendered when report.visualAnalysis is present.
 */
function VisualAnalysisSection({ analysis }) {
  const [openFrame, setOpenFrame] = useState(null)

  if (!analysis) return null

  if (analysis.error) {
    return (
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '24px',
        marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
        borderLeft: '6px solid #dc2626',
      }}>
        <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: '#b91c1c' }}>
          Gemini Visual Analysis
        </h2>
        <p style={{ color: '#dc2626', margin: 0 }}>Analysis failed: {analysis.error}</p>
      </div>
    )
  }

  // Split the overall summary into sections for structured display
  const sections = []
  const sectionHeaders = [
    'APPLICATION TYPE', 'OVERALL SUMMARY', 'KEY FEATURES', 'TARGET USERS', 'MAIN WORKFLOWS'
  ]
  let currentHeader = null
  let currentLines  = []

  for (const line of (analysis.overallSummary || '').split('\n')) {
    const trimmed = line.trim()
    const matchedHeader = sectionHeaders.find(h => trimmed.toUpperCase().startsWith(h + ':'))
    if (matchedHeader) {
      if (currentHeader) sections.push({ header: currentHeader, body: currentLines.join('\n').trim() })
      currentHeader = matchedHeader
      currentLines  = [trimmed.slice(matchedHeader.length + 1).trim()]
    } else if (currentHeader) {
      currentLines.push(trimmed)
    }
  }
  if (currentHeader) sections.push({ header: currentHeader, body: currentLines.join('\n').trim() })

  const appTypeSection = sections.find(s => s.header === 'APPLICATION TYPE')
  const appTypeText    = appTypeSection ? appTypeSection.body : ''

  return (
    <div style={{
      background: '#fff', borderRadius: '16px', padding: '24px',
      marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
      borderLeft: '6px solid #d97706',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Gemini Visual Analysis · {analysis.frameCount} frames
          </div>
          <h2 style={{ margin: 0, fontSize: '22px', color: '#1e293b' }}>
            {appTypeText || 'Visual Site Analysis'}
          </h2>
        </div>
        <span style={{
          marginLeft: 'auto', background: '#fef9c3', color: '#854d0e',
          padding: '4px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: '700'
        }}>
          AI Vision
        </span>
      </div>

      {/* Structured summary sections */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px', marginBottom: '24px'
      }}>
        {sections.filter(s => s.header !== 'APPLICATION TYPE').map((s, i) => (
          <div key={i} style={{
            background: '#f8fafc', borderRadius: '10px', padding: '14px 16px'
          }}>
            <div style={{
              fontSize: '10px', color: '#64748b', textTransform: 'uppercase',
              letterSpacing: '0.08em', marginBottom: '6px', fontWeight: '700'
            }}>
              {s.header}
            </div>
            <div style={{ fontSize: '13px', color: '#334155', lineHeight: '1.6', whiteSpace: 'pre-line' }}>
              {s.body}
            </div>
          </div>
        ))}
      </div>

      {/* Per-frame accordion */}
      <div>
        <div style={{
          fontSize: '12px', color: '#64748b', textTransform: 'uppercase',
          letterSpacing: '0.06em', fontWeight: '700', marginBottom: '10px'
        }}>
          Frame-by-frame descriptions ({analysis.frames.length})
        </div>

        {analysis.frames.map((frame, i) => {
          const isOpen = openFrame === i
          return (
            <div key={i} style={{
              border: '1px solid #e2e8f0', borderRadius: '8px',
              marginBottom: '6px', overflow: 'hidden'
            }}>
              <button
                onClick={() => setOpenFrame(isOpen ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', background: isOpen ? '#fef9c3' : '#f8fafc',
                  border: 'none', padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  fontSize: '13px', color: '#1e293b', fontWeight: '600',
                }}
              >
                <span style={{
                  background: '#d97706', color: '#fff',
                  padding: '1px 8px', borderRadius: '999px', fontSize: '11px',
                  flexShrink: 0
                }}>
                  Frame {frame.frame}
                </span>
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {frame.label}
                </span>
                <span style={{ color: '#94a3b8', fontSize: '16px' }}>
                  {isOpen ? '▲' : '▼'}
                </span>
              </button>

              {isOpen && (
                <div style={{ padding: '12px 14px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
                  <div style={{
                    fontSize: '11px', color: '#94a3b8', marginBottom: '8px',
                    fontFamily: 'monospace'
                  }}>
                    {frame.screenshot}
                  </div>
                  <div style={{
                    fontSize: '13px', color: '#334155', lineHeight: '1.7',
                    whiteSpace: 'pre-line'
                  }}>
                    {frame.description}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Coverage & Quality panel — shows a visual breakdown of execution outcomes
 * and renders deterministic recommendations as actionable items.
 */
function CoverageQualityPanel({ summary = {}, recommendations = [], assertions = [], missingWorkflows = [], qualityFactors = [] }) {
  const {
    executedTests         = 0,
    passedTests           = 0,
    failedTests           = 0,
    noChangeTests         = 0,
    errorTests            = 0,
    workflowCoverage      = 0,
    executionAccuracy     = 0,
    executionQualityScore = 0,
    qualityCategory       = 'Weak',
  } = summary

  const coverageColor = workflowCoverage >= 80 ? '#16a34a' : workflowCoverage >= 50 ? '#d97706' : '#dc2626'
  const accuracyColor = executionAccuracy >= 80 ? '#16a34a' : executionAccuracy >= 50 ? '#d97706' : '#dc2626'

  const bars = [
    { label: 'Passed',    value: passedTests,   total: executedTests, color: '#16a34a' },
    { label: 'Failed',    value: failedTests,   total: executedTests, color: '#dc2626' },
    { label: 'No Change', value: noChangeTests, total: executedTests, color: '#94a3b8' },
    { label: 'Errors',    value: errorTests,    total: executedTests, color: '#d97706' },
  ]

  return (
    <div style={{
      background: '#fff', borderRadius: '16px', padding: '24px',
      marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }}>
      <h2 style={{ marginTop: 0, marginBottom: '20px', fontSize: '18px', color: '#1e293b' }}>
        Coverage &amp; Quality
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px' }}>

        {/* Outcome breakdown bars */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Execution Breakdown
          </div>
          {executedTests === 0 ? (
            <p style={{ color: '#94a3b8', margin: 0, fontSize: '13px' }}>No tests executed yet.</p>
          ) : (
            bars.map(({ label, value, total, color }) => {
              const pct = total > 0 ? Math.round((value / total) * 100) : 0
              return (
                <div key={label} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>
                    <span>{label}</span>
                    <span style={{ fontWeight: '600' }}>{value} <span style={{ color: '#94a3b8', fontWeight: '400' }}>({pct}%)</span></span>
                  </div>
                  <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Coverage gauges */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Quality Scores
          </div>
          {[
            { label: 'Workflow Coverage', pct: workflowCoverage, color: coverageColor, hint: 'Patterns with a passing outcome / total patterns' },
            { label: 'Execution Accuracy', pct: executionAccuracy, color: accuracyColor, hint: 'Passed / executed tests' },
          ].map(({ label, pct, color, hint }) => (
            <div key={label} title={hint} style={{ marginBottom: '14px', cursor: 'help' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '4px' }}>
                <span>{label}</span>
                <span style={{ fontSize: '16px', fontWeight: '700', color }}>{pct}%</span>
              </div>
              <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.7s ease' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Missing Workflows */}
        {missingWorkflows.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Missing Workflows ({missingWorkflows.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {missingWorkflows.map((w, i) => (
                <span key={i} style={{
                  background: '#fee2e2', color: '#b91c1c',
                  padding: '3px 10px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: '600',
                }}>
                  {w}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Quality Score detail */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Quality Score: {executionQualityScore}/100 — {qualityCategory}
          </div>
          <div style={{ height: '10px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              height: '100%',
              width: `${executionQualityScore}%`,
              background: executionQualityScore >= 80 ? '#16a34a' : executionQualityScore >= 60 ? '#d97706' : '#dc2626',
              borderRadius: '999px',
              transition: 'width 0.7s ease',
            }} />
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            {assertions.length > 0
              ? `${assertions.filter(a => a.passed).length}/${assertions.length} business assertions passed`
              : 'No business assertions recorded'}
          </div>
        </div>

        {/* Quality Factors Breakdown */}
        {qualityFactors.length > 0 && (
          <div>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Quality Factor Breakdown
            </div>
            {qualityFactors.map((f, i) => {
              const pct = f.max > 0 ? Math.round((f.score / f.max) * 100) : 0
              const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626'
              return (
                <div key={i} style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#475569', marginBottom: '3px' }}>
                    <span>{f.name}</span>
                    <span style={{ fontWeight: '600', color }}>{f.score}<span style={{ color: '#94a3b8', fontWeight: '400' }}>/{f.max}</span></span>
                  </div>
                  <div style={{ height: '5px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Recommendations
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recommendations.map((r, i) => (
                <div key={i} style={{
                  background: '#f8fafc', borderRadius: '8px', padding: '10px 14px',
                  fontSize: '13px', color: '#334155', borderLeft: '3px solid #2563eb',
                  lineHeight: 1.5,
                }}>
                  {r}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

const SEVERITY_BADGE = {
  low:      { background: '#f1f5f9', color: '#64748b' },
  medium:   { background: '#fef9c3', color: '#854d0e' },
  high:     { background: '#fff7ed', color: '#c2410c' },
  critical: { background: '#fee2e2', color: '#b91c1c' },
}

function AssertionTable({ assertions = [] }) {
  if (assertions.length === 0) {
    return <p style={{ color: '#94a3b8', margin: 0 }}>No business assertions were recorded.</p>
  }

  const thStyle = {
    textAlign: 'left', padding: '10px 14px', background: '#f8fafc',
    borderBottom: '2px solid #e2e8f0', fontSize: '11px', color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  }
  const tdStyle = {
    padding: '10px 14px', borderBottom: '1px solid #f1f5f9',
    fontSize: '13px', verticalAlign: 'top',
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Result</th>
            <th style={thStyle}>Severity</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Conf</th>
            <th style={thStyle}>Assertion</th>
            <th style={thStyle}>Expected</th>
            <th style={thStyle}>Actual</th>
          </tr>
        </thead>
        <tbody>
          {assertions.map((a, i) => (
            <tr key={i} style={{ background: a.passed ? '#f0fdf4' : '#fff5f5' }}>
              <td style={tdStyle}>
                <span style={{
                  background: a.passed ? '#dcfce7' : '#fee2e2',
                  color:      a.passed ? '#15803d' : '#b91c1c',
                  padding: '2px 8px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: '700',
                }}>
                  {a.passed ? 'PASS' : 'FAIL'}
                </span>
              </td>
              <td style={tdStyle}>
                <span style={{
                  ...(SEVERITY_BADGE[a.severity] || SEVERITY_BADGE.low),
                  padding: '2px 8px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: '600',
                }}>
                  {a.severity}
                </span>
              </td>
              <td style={{ ...tdStyle, fontSize: '11px', color: '#475569' }}>{a.assertionType || '—'}</td>
              <td style={{ ...tdStyle, fontSize: '11px', fontWeight: '600', color: a.confidence >= 0.8 ? '#15803d' : a.confidence >= 0.5 ? '#b45309' : '#64748b' }}>
                {a.confidence != null ? `${Math.round(a.confidence * 100)}%` : '—'}
              </td>
              <td style={{ ...tdStyle, fontWeight: '600', color: '#1e293b' }}>{a.assertion}</td>
              <td style={{ ...tdStyle, color: '#475569', fontSize: '12px' }}>{a.expected}</td>
              <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '11px', color: '#64748b', maxWidth: '220px', wordBreak: 'break-all' }}>{a.actual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function QAAnalysisPanel({ analysis }) {
  if (!analysis) return null
  const sections = [
    { key: 'workflowGaps',           label: 'Workflow Gaps',              color: '#dc2626', bg: '#fee2e2' },
    { key: 'untestedCriticalFlows',  label: 'Untested Critical Flows',    color: '#b45309', bg: '#fef3c7' },
    { key: 'flakyInteractions',      label: 'Flaky Interactions',         color: '#7e22ce', bg: '#fdf4ff' },
    { key: 'uxConcerns',             label: 'UX Concerns',                color: '#0369a1', bg: '#e0f2fe' },
    { key: 'accessibilityConcerns',  label: 'Accessibility Concerns',     color: '#065f46', bg: '#dcfce7' },
    { key: 'performanceConcerns',    label: 'Performance Concerns',       color: '#6d28d9', bg: '#ede9fe' },
  ]

  return (
    <div style={{
      background: '#fff', borderRadius: '16px', padding: '24px',
      marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: '#1e293b' }}>AI QA Risk Analysis</h2>
        <span style={{
          background: analysis.analysedBy === 'llm' ? '#d1fae5' : '#f1f5f9',
          color:      analysis.analysedBy === 'llm' ? '#065f46' : '#64748b',
          padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: '600',
        }}>
          {analysis.analysedBy === 'llm' ? 'Gemini AI' : 'Deterministic'}
        </span>
      </div>

      {analysis.businessRiskSummary && (
        <div style={{
          background: '#f8fafc', borderRadius: '10px', padding: '14px 16px',
          marginBottom: '20px', fontSize: '14px', color: '#334155', lineHeight: 1.6,
          borderLeft: '4px solid #2563eb',
        }}>
          {analysis.businessRiskSummary}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {sections.map(({ key, label, color, bg }) => {
          const items = analysis[key] || []
          if (items.length === 0) return null
          return (
            <div key={key} style={{ background: bg, borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                {label} ({items.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '16px' }}>
                {items.map((item, i) => (
                  <li key={i} style={{ fontSize: '12px', color, marginBottom: '4px', lineHeight: 1.5 }}>{item}</li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NavigationGraphPanel({ graph }) {
  if (!graph || graph.nodes.length === 0) return null

  const passedUrls = new Set(
    graph.edges.filter(e => e.status === 'pass').map(e => e.to)
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: '8px 0' }}>
        {graph.nodes.map((node, i) => {
          const outgoing = graph.edges.filter(e => e.from === node.id)
          const isPassed = passedUrls.has(node.id)
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div style={{
                background: isPassed ? '#dcfce7' : '#f1f5f9',
                border: `2px solid ${isPassed ? '#16a34a' : '#cbd5e1'}`,
                borderRadius: '10px', padding: '8px 14px',
                fontSize: '12px', fontWeight: '600',
                color: isPassed ? '#15803d' : '#475569',
                whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden',
                textOverflow: 'ellipsis', textAlign: 'center',
              }}
              title={node.url}
              >
                {node.label}
              </div>
              {outgoing.length > 0 && (
                <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>
                  → {outgoing.length} link{outgoing.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8' }}>
        {graph.nodes.length} pages · {graph.edges.length} transitions · green = passed
      </div>
    </div>
  )
}

function BusinessWorkflowsPanel({ completed = [], missing = [], expected = [], coverage = 0 }) {
  const coverageColor = coverage >= 80 ? '#16a34a' : coverage >= 50 ? '#d97706' : '#dc2626'

  return (
    <div style={{
      background: '#fff', borderRadius: '16px', padding: '24px',
      marginBottom: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', color: '#1e293b' }}>Business Workflow Coverage</h2>
        <span style={{
          fontSize: '20px', fontWeight: '700', color: coverageColor,
          background: coverage >= 80 ? '#dcfce7' : coverage >= 50 ? '#fef9c3' : '#fee2e2',
          padding: '4px 14px', borderRadius: '999px',
        }}>
          {coverage}% — {completed.length}/{expected.length} workflows
        </span>
      </div>

      <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ height: '100%', width: `${coverage}%`, background: coverageColor, borderRadius: '999px', transition: 'width 0.7s ease' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* Completed */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Completed ({completed.length})
          </div>
          {completed.length === 0
            ? <p style={{ color: '#94a3b8', margin: 0, fontSize: '13px' }}>No workflows completed yet.</p>
            : completed.map((w, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '10px 12px', marginBottom: '8px',
                background: '#f0fdf4', borderRadius: '10px',
                borderLeft: '3px solid #16a34a',
              }}>
                <span style={{ fontSize: '16px', marginTop: '1px' }}>✓</span>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#15803d' }}>{w.label || w}</div>
                  {w.evidence && (
                    Array.isArray(w.evidence)
                      ? w.evidence.map((line, li) => (
                          <div key={li} style={{ fontSize: '11px', color: '#4ade80', marginTop: li === 0 ? '2px' : '1px', fontFamily: 'monospace' }}>{line}</div>
                        ))
                      : <div style={{ fontSize: '11px', color: '#4ade80', marginTop: '2px' }}>{w.evidence}</div>
                  )}
                </div>
              </div>
            ))
          }
        </div>

        {/* Missing */}
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#b91c1c', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Missing ({missing.length})
          </div>
          {missing.length === 0
            ? <p style={{ color: '#94a3b8', margin: 0, fontSize: '13px' }}>All workflows completed.</p>
            : missing.map((w, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px', marginBottom: '8px',
                background: '#fff5f5', borderRadius: '10px',
                borderLeft: '3px solid #dc2626',
              }}>
                <span style={{ fontSize: '16px' }}>✗</span>
                <div style={{ fontWeight: '600', fontSize: '13px', color: '#b91c1c' }}>
                  {typeof w === 'string' ? w : w.label}
                </div>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  )
}

const STABILITY_BADGE = {
  'stable':         { background: '#dcfce7', color: '#15803d' },
  'unstable':       { background: '#fef9c3', color: '#854d0e' },
  'flaky':          { background: '#fff7ed', color: '#c2410c' },
  'critical-flaky': { background: '#fee2e2', color: '#b91c1c' },
}

function FlakyActionsPanel({ actions = [] }) {
  if (actions.length === 0) {
    return <p style={{ color: '#94a3b8', margin: 0 }}>No flaky actions detected.</p>
  }

  const thStyle = {
    textAlign: 'left', padding: '10px 14px', background: '#f8fafc',
    borderBottom: '2px solid #e2e8f0', fontSize: '11px', color: '#64748b',
    textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  }
  const tdStyle = { padding: '10px 14px', borderBottom: '1px solid #f1f5f9', fontSize: '13px', verticalAlign: 'top' }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Stability</th>
            <th style={thStyle}>Target</th>
            <th style={thStyle}>Retries</th>
            <th style={thStyle}>Occurrences</th>
            <th style={thStyle}>Reasons</th>
            <th style={thStyle}>Pages</th>
          </tr>
        </thead>
        <tbody>
          {actions.map((a, i) => {
            const badge = STABILITY_BADGE[a.stability] || STABILITY_BADGE['unstable']
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={tdStyle}>
                  <span style={{ ...badge, padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '700' }}>
                    {a.stability}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px', color: '#1e293b', maxWidth: '200px', wordBreak: 'break-all' }}>
                  {a.target}
                </td>
                <td style={{ ...tdStyle, fontWeight: '700', color: a.retryCount >= 2 ? '#b91c1c' : '#d97706', textAlign: 'center' }}>
                  {a.retryCount}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center', color: '#475569' }}>{a.occurrences}</td>
                <td style={{ ...tdStyle, fontSize: '12px', color: '#475569' }}>
                  {(a.reasons || []).join(' · ')}
                </td>
                <td style={{ ...tdStyle, fontSize: '11px', color: '#64748b', maxWidth: '180px' }}>
                  {(a.pages || []).map((p, j) => (
                    <div key={j} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</div>
                  ))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: '16px',
      padding: '24px',
      marginBottom: '20px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.08)'
    }}>
      <h2 style={{ marginTop: 0, marginBottom: '16px', fontSize: '18px', color: '#1e293b' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}
