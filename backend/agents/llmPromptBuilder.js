
// -------------------------------------------------------------------
// llmPromptBuilder.js
//
// Formats structured crawl intelligence into the enterprise prompt
// template and returns a single string ready for Gemini.
//
// The prompt positions Gemini as a senior solutions architect / business
// analyst — not a UI classifier. It asks for operational understanding:
// what the platform does, who uses it, what workflows exist, and why.
//
// Signal injection strategy:
//   buildCrawlIntelligenceBlock(signals) → structured text
//   buildClassificationPrompt(signals)   → full prompt with block injected
// -------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Crawl intelligence formatter
// ---------------------------------------------------------------------------

function formatPageBlock(ctx, index) {
  const lines = [`[Page ${index + 1}]  ${ctx.url}`]
  if (ctx.title)                        lines.push(`  Title:            "${ctx.title}"`)
  if (ctx.headings.length)              lines.push(`  Headings:         ${ctx.headings.map(h => `"${h}"`).join(', ')}`)
  if (ctx.buttons.length)               lines.push(`  Buttons:          ${ctx.buttons.map(b => `"${b}"`).join(', ')}`)
  if (ctx.links.length)                 lines.push(`  Navigation links: ${ctx.links.map(l => `"${l}"`).join(', ')}`)
  if (ctx.repeatedActions.length)       lines.push(`  Repeated actions: ${ctx.repeatedActions.map(a => `"${a}"`).join(', ')}`)
  if (ctx.formCount || ctx.inputCount)  lines.push(`  Forms: ${ctx.formCount}   Inputs: ${ctx.inputCount}`)
  return lines.join('\n')
}

function buildCrawlIntelligenceBlock(signals) {
  const {
    pageContexts,
    workflowPaths,
    authLabels,
    workflowActionLabels,
    interactionTargets,
    summary,
  } = signals

  const sections = []

  // ── Summary stats ──
  sections.push(
    'CRAWL SUMMARY\n' +
    `  Pages visited:              ${summary.totalPages}\n` +
    `  Forms detected:             ${summary.totalForms}\n` +
    `  Input fields detected:      ${summary.totalInputs}\n` +
    `  Unique interactive buttons: ${summary.totalButtons}\n` +
    `  Repeated workflow patterns: ${summary.repeatedPatterns}`
  )

  // ── Per-page DOM intelligence ──
  sections.push(
    'PAGE INTELLIGENCE\n' +
    '(pages ranked by signal density — most information-rich shown first)\n\n' +
    (pageContexts.length
      ? pageContexts.map(formatPageBlock).join('\n\n')
      : '  (no page data available)')
  )

  // ── URL path patterns ──
  sections.push(
    'URL PATH PATTERNS\n' +
    '(numeric IDs and UUIDs normalised to {id})\n' +
    (workflowPaths.length
      ? workflowPaths.map(p => `  ${p}`).join('\n')
      : '  (none)')
  )

  // ── Auth / portal labels ──
  sections.push(
    'AUTHENTICATION PORTALS & SESSION LABELS\n' +
    (authLabels.length
      ? authLabels.map(l => `  "${l}"`).join('\n')
      : '  (none)')
  )

  // ── Repeated workflow actions — highest-signal data ──
  sections.push(
    'REPEATED WORKFLOW ACTIONS  [HIGHEST SIGNAL — these appear multiple times in list/table UIs]\n' +
    (workflowActionLabels.length
      ? workflowActionLabels.map(a => `  "${a}"`).join('\n')
      : '  (none)')
  )

  // ── Interaction targets ──
  sections.push(
    'INTERACTION TARGETS\n' +
    '(actual elements clicked by the crawler during exploration)\n' +
    (interactionTargets.length
      ? interactionTargets.map(t => `  "${t}"`).join('\n')
      : '  (none)')
  )

  return sections.join('\n\n')
}

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const PROMPT_TEMPLATE = `You are a senior software solutions architect and enterprise systems analyst.

Your task is to analyze a web application based ONLY on structured crawl intelligence collected by an autonomous testing engine.

You are NOT performing UI classification.

You are performing BUSINESS and OPERATIONAL UNDERSTANDING.

Your objective is to infer:

1. what this platform does
2. what business domain it serves
3. what workflows exist
4. what operational goals it fulfills
5. which user personas interact with it
6. what kind of software system this is

You must think like:
- a solutions architect
- a QA lead
- a business analyst
- a platform reviewer

--------------------------------------------------
CRAWL INTELLIGENCE
--------------------------------------------------

{{STRUCTURED_SIGNALS}}

--------------------------------------------------
ANALYSIS REQUIREMENTS
--------------------------------------------------

Infer the following:

### applicationType
Create a PROFESSIONAL platform name.

GOOD:
- E-Commerce Inventory Platform
- Multi-Role Admin Dashboard
- Healthcare Appointment Portal
- SaaS Project Management System
- CRM Sales Operations Platform

BAD:
- Website
- Web App
- Dashboard
- E-Commerce

--------------------------------------------------

### businessDescription

Write 2-4 sentences explaining:
- what the platform does
- who uses it
- what business process it supports
- what operational purpose it fulfills

The description should sound like an enterprise software assessment report.

--------------------------------------------------

### coreWorkflows

Infer the major operational workflows.

Examples:
- User Authentication
- Inventory Browsing
- Cart Management
- Order Processing
- Product Navigation
- Session Management
- Administrative Configuration

Use concise professional workflow names.

Return 3-7 workflows.

--------------------------------------------------

### detectedRoles

Infer likely user personas.

Examples:
- Customer
- Administrator
- Store Manager
- Patient
- Doctor
- Sales Representative

Only include roles supported by evidence.

--------------------------------------------------

### reasoning

Provide 4-6 evidence-based observations.

Each item must reference actual crawl intelligence.

GOOD:
- Repeated "add to cart" interactions indicate commerce workflows
- Inventory-oriented navigation detected on /inventory.html
- Login authentication flow detected before inventory access
- Product listing behavior suggests transactional browsing

BAD:
- This looks like e-commerce
- Buttons were detected

--------------------------------------------------

### confidence

Return a decimal between 0.0 and 1.0.

Confidence should reflect:
- signal consistency
- workflow clarity
- domain certainty

--------------------------------------------------
IMPORTANT RULES
--------------------------------------------------

- DO NOT hallucinate unsupported workflows
- DO NOT invent roles without evidence
- DO NOT return markdown
- DO NOT explain your reasoning outside JSON
- DO NOT use generic labels

Return ONLY valid JSON.

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------

{
  "applicationType": "",
  "businessDescription": "",
  "coreWorkflows": [],
  "detectedRoles": [],
  "reasoning": [],
  "confidence": 0.0
}`

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function buildClassificationPrompt(signals) {
  const intelligenceBlock = buildCrawlIntelligenceBlock(signals)
  return PROMPT_TEMPLATE.replace('{{STRUCTURED_SIGNALS}}', intelligenceBlock)
}

module.exports = { buildClassificationPrompt }
