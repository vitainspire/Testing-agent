
import { useState } from 'react'
import axios from 'axios'

export default function App() {

  const [url, setUrl]           = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
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
              hint='Intentional test runs: representative patterns + login'
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
              hint='Test runs that threw an error'
            />
            <MetricCard
              title='Skipped'
              value={report.summary.skippedTests}
              color='#d97706'
              hint='Tests attempted but skipped: element not found, cap reached, or no state change'
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
          </div>

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
  DONE:     { background: '#1e293b', color: '#f8fafc' },
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
