
const { chromium }         = require('playwright')
const fs                   = require('fs')
const { runUseCaseAgent }  = require('./agents/useCaseAgent')

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  'summary',
  '[aria-expanded]',
  '[data-toggle]',
  '[data-bs-toggle]',
].join(',')

const MAX_INTERACTIONS_PER_STATE = 8
const REPEAT_THRESHOLD           = 2
const MAX_DEPTH                  = 2

// Scope policy for domain boundary enforcement.
// 'origin' — strict: scheme + hostname + port must match exactly.
// 'domain' — relaxed: same base domain allows cross-subdomain navigation
//            (e.g. app.example.com ↔ auth.example.com are both allowed).
// Start with 'domain' so auth subdomains are not blocked.
const SCOPE_MODE = 'domain'

// -------------------------------------------------------------------
// Logger
// -------------------------------------------------------------------
function createLogger(crawlLog) {
  const TAG_PAD = 10

  function emit(depth, tag, message) {
    const timestamp = new Date().toISOString()
    const indent    = '  '.repeat(depth)
    const label     = `[${tag}]`.padEnd(TAG_PAD)
    console.log(`${indent}${label} ${message}`)
    crawlLog.push({ depth, tag, message, timestamp })
  }

  return {
    crawl:    (d, msg) => emit(d, 'CRAWL',    msg),
    state:    (d, msg) => emit(d, 'STATE',    msg),
    ignore:   (d, msg) => emit(d, 'IGNORE',   msg),
    detect:   (d, msg) => emit(d, 'DETECT',   msg),
    scan:     (d, msg) => emit(d, 'SCAN',     msg),
    select:   (d, msg) => emit(d, 'SELECT',   msg),   // representative pattern announced
    execute:  (d, msg) => emit(d, 'EXECUTE',  msg),   // representative element clicked
    workflow: (d, msg) => emit(d, 'WORKFLOW', msg),   // representative outcome recorded
    login:    (d, msg) => emit(d, 'LOGIN',    msg),
    shot:     (d, msg) => emit(d, 'SHOT',     msg),
    click:    (d, msg) => emit(d, 'CLICK',    msg),   // general (non-representative) click
    pass:     (d, msg) => emit(d, 'PASS',     msg),
    nochange: (d, msg) => emit(d, 'NOCHANGE', msg),
    fail:     (d, msg) => emit(d, 'FAIL',     msg),
    skip:     (d, msg) => emit(d, 'SKIP',     msg),
    limit:    (d, msg) => emit(d, 'LIMIT',    msg),
    recurse:  (d, msg) => emit(d, 'RECURSE',  msg),
    back:     (d, msg) => emit(d, 'BACK',     msg),
    pattern:  (d, msg) => emit(d, 'PATTERN',  msg),
    dismiss:  (d, msg) => emit(d, 'DISMISS',  msg),
    allow:    (d, msg) => emit(d, 'ALLOW',    msg),   // in-scope navigation permitted
    block:    (d, msg) => emit(d, 'BLOCK',    msg),   // out-of-scope navigation stopped
    scope:    (d, msg) => emit(d, 'SCOPE',    msg),   // boundary announcement
    wflow:    (d, msg) => emit(d, 'WFLOW',    msg),   // workflow entry detection / session lifecycle
    ctx:      (d, msg) => emit(d, 'CTX',      msg),   // browser context creation / teardown
    auth:     (d, msg) => emit(d, 'AUTH',     msg),   // authentication attempt within a session
    switch_:  (d, msg) => emit(d, 'SWITCH',   msg),   // switching between workflow sessions
    merge:    (d, msg) => emit(d, 'MERGE',    msg),   // merging session reports into one
    done:     (d, msg) => emit(d, 'DONE',     msg),
    usecase:  (d, msg) => emit(d, 'USECASE',  msg),   // use-case agent lifecycle
    llm:      (d, msg) => emit(d, 'LLM',      msg),   // LLM call details
    classify: (d, msg) => emit(d, 'CLASSIFY', msg),   // classification result
    confidence:(d,msg) => emit(d, 'CONF',     msg),   // final confidence score
  }
}

// -------------------------------------------------------------------
// shortUrl
// -------------------------------------------------------------------
function shortUrl(url) {
  try {
    const u  = new URL(url)
    const qs = u.search.length > 1 ? u.search.slice(0, 20) + (u.search.length > 20 ? '…' : '') : ''
    return (u.pathname || '/') + qs
  } catch {
    return url.slice(0, 60)
  }
}

// -------------------------------------------------------------------
// Domain boundary utilities
// -------------------------------------------------------------------

// "app.example.com" → "example.com"  |  "localhost" → "localhost"
// Handles the common case where apps span subdomains (auth.x.com, api.x.com).
// Not a full public-suffix-list lookup — good enough for the vast majority
// of real deployments that don't sit on country-code eTLDs like .co.uk.
function extractBaseDomain(hostname) {
  const parts = hostname.split('.')
  return parts.length <= 2 ? hostname : parts.slice(-2).join('.')
}

// Returns true when targetUrl is within the application's crawl boundary.
// Relative URLs (no scheme) are always considered in-scope.
// SCOPE_MODE='origin' → exact scheme+host+port match.
// SCOPE_MODE='domain' → same base domain (allows cross-subdomain links).
function isSameAppDomain(baseOrigin, targetUrl) {
  try {
    const target = new URL(targetUrl)
    if (target.origin === baseOrigin) return true          // fast path
    if (SCOPE_MODE === 'domain') {
      const base = new URL(baseOrigin)
      return extractBaseDomain(target.hostname) === extractBaseDomain(base.hostname)
    }
    return false
  } catch {
    return true  // non-absolute URL or parse error → treat as in-scope
  }
}

// -------------------------------------------------------------------
// Pure utility functions
// -------------------------------------------------------------------

function normalizeLabel(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 40)
}

function normalizeUrlPattern(url) {
  try {
    const u        = new URL(url)
    const pathname = u.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
      .replace(/\/\d+/g, '/{id}')
    return u.origin + pathname
  } catch {
    return url
  }
}

function countLabelFrequency(textArray) {
  const freq = {}
  for (const text of textArray) {
    const label = normalizeLabel(text)
    if (label) freq[label] = (freq[label] || 0) + 1
  }
  return freq
}

function buildButtonTestCases(buttonTexts, pageUrl) {
  const freq  = countLabelFrequency(buttonTexts)
  const seen  = new Set()
  const cases = []
  for (const text of buttonTexts) {
    const label = normalizeLabel(text)
    if (!label || seen.has(label)) continue
    seen.add(label)
    const count = freq[label]
    if (count >= REPEAT_THRESHOLD) {
      cases.push({
        component:   'RepeatedRowAction',
        page:        pageUrl,
        pattern:     label,
        occurrences: count,
        tests: [
          `Verify "${label}" is clickable on a representative row`,
          `Verify "${label}" triggers expected state change (modal or navigation)`,
          `Verify "${label}" handles error state gracefully`,
        ]
      })
    } else {
      cases.push({ component: 'Button', page: pageUrl, action: `Validate button: ${text.trim()}` })
    }
  }
  return cases
}

// -------------------------------------------------------------------
// classifyOutcome
// Returns { category, description } describing what changed after a click.
// category is machine-readable; description is for human display.
// -------------------------------------------------------------------
function classifyOutcome(before, after) {
  if (!hasStateChanged(before, after)) {
    return { category: 'no-change', description: 'no state change detected' }
  }

  let category    = 'dom-change'
  let description = 'state changed'

  if (before.url !== after.url) {
    // Highest priority — full page navigation
    category    = 'navigation'
    try   { description = `navigated to ${new URL(after.url).pathname}` }
    catch { description = `navigated to ${after.url}` }
  } else if (before.openDialogs < after.openDialogs) {
    category    = 'modal-opened'
    description = 'dialog or modal opened'
  } else if (before.openDialogs > after.openDialogs) {
    category    = 'modal-closed'
    description = 'dialog or modal closed'
  } else if (before.editableCount < after.editableCount) {
    // Inline editing activated — row edit, cell edit, contenteditable revealed
    category    = 'inline-edit-opened'
    description = `${after.editableCount - before.editableCount} element(s) entered edit mode`
  } else if (before.editableCount > after.editableCount) {
    category    = 'inline-edit-closed'
    description = 'inline editing mode exited'
  } else if (before.visibleInputs < after.visibleInputs) {
    // Inline form revealed — search panel, filter bar, add row, etc.
    const delta = after.visibleInputs - before.visibleInputs
    category    = 'form-revealed'
    description = `${delta} input field(s) appeared`
  } else if (before.visibleInputs > after.visibleInputs) {
    category    = 'form-hidden'
    description = `${before.visibleInputs - after.visibleInputs} input field(s) hidden`
  } else if (before.errorCount < after.errorCount) {
    // Validation feedback appeared — inline error, alert, status message
    category    = 'validation-triggered'
    description = 'validation message or alert appeared'
  } else if (before.errorCount > after.errorCount) {
    category    = 'validation-cleared'
    description = 'validation message cleared'
  } else if (before.rowCount !== after.rowCount) {
    // Table row mutation — CRUD add/delete, filter, pagination
    const delta = after.rowCount - before.rowCount
    category    = delta > 0 ? 'rows-added' : 'rows-removed'
    description = `${Math.abs(delta)} table row(s) ${delta > 0 ? 'added' : 'removed'}`
  } else if (before.activePanels !== after.activePanels) {
    // Tab content switched — SPA tab navigation without URL change
    category    = 'tab-switched'
    description = 'active tab panel changed'
  } else if (before.selectedCount !== after.selectedCount) {
    // Selection state changed — listbox, combobox, data grid row selection
    const delta = after.selectedCount - before.selectedCount
    category    = 'selection-changed'
    description = `${Math.abs(delta)} item(s) ${delta > 0 ? 'selected' : 'deselected'}`
  } else if (before.checkedCount !== after.checkedCount) {
    // Checkbox/radio/toggle state changed
    const delta = after.checkedCount - before.checkedCount
    category    = 'checked-changed'
    description = `${Math.abs(delta)} item(s) ${delta > 0 ? 'checked' : 'unchecked'}`
  } else if (before.expandedCount < after.expandedCount) {
    category    = 'content-expanded'
    description = 'accordion or disclosure expanded'
  } else if (before.expandedCount > after.expandedCount) {
    category    = 'content-collapsed'
    description = 'accordion or disclosure collapsed'
  } else if (before.childCount !== after.childCount) {
    // Structural DOM change — section added/removed, dynamic content swap
    const delta = after.childCount - before.childCount
    category    = 'structure-changed'
    description = `${Math.abs(delta)} DOM section(s) ${delta > 0 ? 'added' : 'removed'}`
  } else if (before.textBucket < after.textBucket) {
    category    = 'content-added'
    description = 'new content loaded'
  } else if (before.textBucket > after.textBucket) {
    category    = 'content-removed'
    description = 'content removed or filtered'
  } else if (before.title !== after.title) {
    category    = 'title-changed'
    description = `page title changed to "${after.title}"`
  }

  return { category, description }
}

// -------------------------------------------------------------------
// Playwright helpers
// -------------------------------------------------------------------

async function capturePageState(page) {
  try {
    return await page.evaluate(() => {
      // --- existing coarse signals ---
      const openDialogs = [...document.querySelectorAll(
        '[role="dialog"], [role="alertdialog"], .modal, .drawer'
      )].filter(el => {
        const s = window.getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
      }).length

      const expandedCount = document.querySelectorAll('[aria-expanded="true"]').length

      // --- new fine-grained signals ---

      // Visible text inputs and textareas — detects inline edit forms, row editing
      const visibleInputs = [...document.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea'
      )].filter(el => {
        const s = window.getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
      }).length

      // Contenteditable elements — detects rows or cells entering edit mode
      const editableCount = document.querySelectorAll('[contenteditable="true"]').length

      // aria-selected items — detects tab switches, listbox selections, row selection
      const selectedCount = document.querySelectorAll('[aria-selected="true"]').length

      // Checked inputs — detects checkbox/radio/toggle state changes
      const checkedCount = document.querySelectorAll('input:checked').length

      // Validation signals — detects inline errors, warnings, live alerts
      // Uses aria attributes only (reliable, no CSS class guessing)
      const errorCount = document.querySelectorAll(
        '[aria-invalid="true"], [role="alert"]:not([hidden]), [role="status"]:not([hidden])'
      ).length

      // Table rows — detects CRUD add/delete, pagination, filtered results
      const rowCount = document.querySelectorAll('table tr').length

      // Visible tab panels — detects tab content switching in SPAs
      const activePanels = document.querySelectorAll(
        '[role="tabpanel"]:not([hidden]):not([aria-hidden="true"])'
      ).length

      // Direct children of the primary content container — lightweight structural signal.
      // Detects sections/cards/drawers appearing or disappearing without full DOM diff.
      const mainEl    = document.querySelector('main, [role="main"], #root > *, #app > *, body')
      const childCount = mainEl ? mainEl.children.length : document.body.children.length

      return {
        url:          location.href,
        title:        document.title,
        textBucket:   Math.floor(document.body.innerText.length / 200),
        openDialogs,
        expandedCount,
        visibleInputs,
        editableCount,
        selectedCount,
        checkedCount,
        errorCount,
        rowCount,
        activePanels,
        childCount,
      }
    })
  } catch {
    return {
      url: page.url(), title: '', textBucket: 0, openDialogs: 0, expandedCount: 0,
      visibleInputs: 0, editableCount: 0, selectedCount: 0, checkedCount: 0,
      errorCount: 0, rowCount: 0, activePanels: 0, childCount: 0,
    }
  }
}

function hasStateChanged(before, after) {
  if (before.url           !== after.url)           return true
  if (before.title         !== after.title)         return true
  if (before.openDialogs   !== after.openDialogs)   return true
  if (before.expandedCount !== after.expandedCount) return true
  if (before.textBucket    !== after.textBucket)    return true
  if (before.visibleInputs !== after.visibleInputs) return true
  if (before.editableCount !== after.editableCount) return true
  if (before.selectedCount !== after.selectedCount) return true
  if (before.checkedCount  !== after.checkedCount)  return true
  if (before.errorCount    !== after.errorCount)    return true
  if (before.rowCount      !== after.rowCount)      return true
  if (before.activePanels  !== after.activePanels)  return true
  if (before.childCount    !== after.childCount)    return true
  return false
}

function getStateKey(state) {
  return [
    state.url,
    `dlg:${state.openDialogs}`,
    `exp:${state.expandedCount}`,
    `txt:${state.textBucket}`,
    `inp:${state.visibleInputs}`,
    `edt:${state.editableCount}`,
    `sel:${state.selectedCount}`,
    `row:${state.rowCount}`,
    `pnl:${state.activePanels}`,
    `dom:${state.childCount}`,
  ].join('|')
}

async function waitForStability(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 3000 }) } catch {}
  await page.waitForTimeout(500)
}

async function tryDismissOverlay(page) {
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(400) } catch {}
}

async function getElementIdentifier(element) {
  try {
    const ariaLabel = await element.getAttribute('aria-label') || ''
    const text      = (await element.textContent() || '').trim().slice(0, 60)
    const href      = await element.getAttribute('href') || ''
    const role      = await element.getAttribute('role')
                   || await element.evaluate(el => el.tagName.toLowerCase())
    return `${role}::${ariaLabel || text || href}`
  } catch {
    return `stale::${Math.random()}`
  }
}

// -------------------------------------------------------------------
// handleClickOutcome
//
// Shared helper used by both Phase B (representative clicks) and
// Phase C (general clicks). After a click has already been performed,
// this function captures the new state, classifies the outcome,
// and drives recursive exploration if the state changed.
//
// Returns the final clickCheck object so the caller can push it.
// -------------------------------------------------------------------
async function handleClickOutcome(
  page,
  beforeState,
  clickCheck,
  depth,
  currentUrl,
  log,
  report,
  exploredUrlPatterns,
  explore,
  baseOrigin
) {
  let afterState = beforeState

  try {
    await waitForStability(page)
    afterState = await capturePageState(page)

    const outcome = classifyOutcome(beforeState, afterState)
    clickCheck.outcome         = outcome.description
    clickCheck.outcomeCategory = outcome.category

    if (outcome.category !== 'no-change') {
      clickCheck.status = 'pass'
      log.pass(depth, `[${outcome.category}]  ${outcome.description}`)
    } else {
      log.nochange(depth, `${clickCheck.target}  no visible state change detected`)
    }

  } catch (err) {
    const message = (err.message || 'interaction failed').split('\n')[0].slice(0, 120)
    clickCheck.status          = 'fail'
    clickCheck.outcomeCategory = 'error'
    clickCheck.outcome         = message
    log.fail(depth, `${clickCheck.target}  ${message}`)
  }

  // Recurse if the interaction produced a meaningful state change
  if (clickCheck.status === 'pass') {
    const urlChanged = beforeState.url !== afterState.url

    try {
      if (urlChanged) {
        if (!isSameAppDomain(baseOrigin, afterState.url)) {
          // Navigated outside the application boundary — revert immediately.
          // The click is still recorded as 'pass' (it did something) but
          // the outcome category flags it as blocked so the report is clear.
          log.block(depth,
            `external domain  ${shortUrl(afterState.url)}  ` +
            `(outside ${baseOrigin}) — going back`
          )
          clickCheck.outcomeCategory = 'external-blocked'
          clickCheck.outcome         = `navigated outside app boundary to ${shortUrl(afterState.url)}`
          await page.goBack()
          await waitForStability(page)
        } else {
          log.allow(depth, `internal navigation → ${shortUrl(afterState.url)}`)
          const pattern = normalizeUrlPattern(afterState.url)
          if (exploredUrlPatterns.has(pattern)) {
            log.pattern(depth, `pattern="${pattern}"  already explored — recording link, skipping recursion`)
            report.workflows.push({ from: beforeState.url, to: afterState.url, note: 'skipped — same URL pattern already explored' })
            await page.goBack()
            await waitForStability(page)
          } else {
            exploredUrlPatterns.add(pattern)
            report.workflows.push({ from: beforeState.url, to: afterState.url })
            log.recurse(depth, `URL change → ${shortUrl(afterState.url)}  depth=${depth}→${depth + 1}`)
            await explore(page, depth + 1)
            log.back(depth, `returned to ${shortUrl(currentUrl)}  depth=${depth + 1}→${depth}`)
            await page.goBack()
            await waitForStability(page)
          }
        }
      } else {
        log.recurse(depth, `DOM state change (${clickCheck.outcomeCategory})  depth=${depth}→${depth + 1}`)
        await explore(page, depth + 1)
        log.dismiss(depth, 'pressing Escape to restore previous overlay state')
        await tryDismissOverlay(page)
        log.back(depth, `returned from DOM state  depth=${depth + 1}→${depth}`)
        await waitForStability(page)
      }
    } catch {
      // Navigation or nested explore failure — continue with next element
    }
  }

  return clickCheck
}

// -------------------------------------------------------------------
// -------------------------------------------------------------------
// Role inference helpers — pure string utilities, no hardcoded domains.
// -------------------------------------------------------------------

// Strip common UI portal-suffix words to surface the underlying role name.
// "Doctor Console" → "Doctor"  |  "Admin Portal" → "Admin"
// "Coordinator Terminal" → "Coordinator"  |  "Patient Dashboard" → "Patient"
function inferRoleFromLabel(label) {
  const UI_SUFFIXES = /\s+(console|portal|terminal|dashboard|panel|module|hub|center|suite|management|system|platform|access|login|signin|workspace|app|site|view|screen)\s*$/gi
  const stripped    = label.replace(UI_SUFFIXES, '').trim()
  // Keep at most 4 words; fall back to full label if stripping removed everything
  const words = (stripped.length > 1 ? stripped : label).split(/\s+/).slice(0, 4)
  return words.join(' ') || 'User'
}

// Stable lowercase slug — used as the sessionId key throughout the pipeline
function toSessionId(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'session'
}

// -------------------------------------------------------------------
// detectWorkflowEntryPoints
//
// Phase 1 of the Multi-Workflow Discovery Engine.
//
// Scans the landing page for distinct authentication portals, role
// consoles, and workflow entry tiles WITHOUT any hardcoded domain logic.
//
// Three generic strategies:
//   1. Card/panel — container with a heading PLUS an anchor or button.
//      Covers role-card UIs (Doctor Console, Coordinator Terminal, etc.)
//   2. Anchor — standalone <a href> whose URL or text contains a
//      workflow/portal keyword.
//   3. Button — standalone buttons with an explicit data-href / data-url
//      navigation target.
//
// Returns [] when only one entry point is found → caller uses
// single-session mode.  Returns the full array otherwise.
//
// Output shape:
//   [{ sessionId, entryLabel, role, url, source }, ...]
// -------------------------------------------------------------------
async function detectWorkflowEntryPoints(page, baseOrigin, log) {
  log.wflow(0, '[WFLOW] scanning landing page for workflow entry points...')

  // Broad, domain-agnostic keywords that signal a distinct workflow entry.
  // Intentionally covers auth, role, portal, and operational patterns.
  const ENTRY_PATTERN = [
    'login', 'signin', 'sign-in', 'sign_in',
    'auth', 'portal', 'console', 'terminal', 'dashboard', 'access',
    'admin', 'coordinator', 'manager', 'operator', 'supervisor', 'director',
    'panel', 'module', 'workspace', 'hub',
    'staff', 'employee', 'vendor', 'partner', 'agent', 'provider', 'client',
  ].join('|')

  const rawEntries = await page.evaluate((patternSource) => {
    const results = []
    const seen    = new Set()
    const re      = new RegExp(patternSource, 'i')

    function addEntry(label, href, source) {
      const cleanLabel = (label || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!href || href === '#' || href.startsWith('javascript:')) return
      if (seen.has(href))             return
      if (cleanLabel.length < 2)      return
      seen.add(href)
      results.push({ label: cleanLabel, href, source })
    }

    // ── Strategy 1: Card / panel containers ────────────────────────────────
    // Covers role-card UIs: each card has a heading (the role name) and
    // either a link or a button that leads to that workflow.
    const CARD_SELECTOR = [
      'article', 'section', 'li',
      '[class*="card"]', '[class*="tile"]', '[class*="portal"]', '[class*="entry"]',
      '[class*="panel"]', '[class*="module"]', '[class*="widget"]', '[class*="console"]',
      '[class*="workspace"]', '[role="article"]', '[role="listitem"]',
    ].join(',')

    for (const el of document.querySelectorAll(CARD_SELECTOR)) {
      const heading = el.querySelector(
        'h1,h2,h3,h4,h5,[class*="title"],[class*="label"],[class*="heading"],[class*="name"]'
      )
      if (!heading) continue
      const headingText = heading.textContent.trim()

      const link   = el.querySelector('a[href]')
      const button = el.querySelector('button,[role="button"]')

      if (link) {
        if (re.test(headingText) || re.test(link.href) || re.test(link.textContent)) {
          addEntry(headingText, link.href, 'card-link')
        }
      } else if (button) {
        if (re.test(headingText) || re.test(button.textContent)) {
          // Buttons: check explicit navigation attributes before falling back
          const target = button.getAttribute('data-href') ||
                         button.getAttribute('data-url')  ||
                         button.getAttribute('formaction') ||
                         window.location.href
          addEntry(headingText, target, 'card-button')
        }
      }
    }

    // ── Strategy 2: Standalone anchor tags ─────────────────────────────────
    for (const a of document.querySelectorAll('a[href]')) {
      const text = (
        a.textContent.trim() ||
        a.getAttribute('aria-label') ||
        a.getAttribute('title') || ''
      ).trim()
      if (text.length < 2) continue
      if (re.test(a.href) || re.test(text)) addEntry(text, a.href, 'link')
    }

    // ── Strategy 3: Buttons with explicit navigation targets ────────────────
    for (const btn of document.querySelectorAll('button,[role="button"]')) {
      const text = btn.textContent.trim()
      if (!re.test(text) || text.length < 3) continue
      const target = btn.getAttribute('data-href') ||
                     btn.getAttribute('data-url')  ||
                     btn.getAttribute('formaction')
      if (target && target !== '#' && !target.startsWith('javascript:')) {
        addEntry(text, target, 'button')
      }
    }

    return results
  }, ENTRY_PATTERN)

  // ── Filter to same-domain, deduplicate by URL pattern ───────────────────
  const patternSeen = new Set()
  const entries     = []

  for (const raw of rawEntries) {
    try {
      if (!isSameAppDomain(baseOrigin, raw.href)) continue
      const pattern = normalizeUrlPattern(raw.href)
      if (patternSeen.has(pattern)) continue
      patternSeen.add(pattern)

      const role      = inferRoleFromLabel(raw.label)
      const sessionId = toSessionId(raw.label)

      entries.push({ sessionId, entryLabel: raw.label, role, url: raw.href, source: raw.source })
    } catch { /* skip unparseable URLs */ }
  }

  if (entries.length < 2) {
    log.wflow(0, '[WFLOW] single entry point detected — standard single-session crawl')
    return []
  }

  log.wflow(0, `[WFLOW] discovered ${entries.length} workflow entry points`)
  for (const e of entries) {
    log.wflow(0,
      `  [CTX]  session="${e.sessionId}"  role="${e.role}"` +
      `  label="${e.entryLabel}"  source=${e.source}  url=${shortUrl(e.url)}`
    )
  }

  return entries
}

// -------------------------------------------------------------------
// mergeReports
//
// Combines an array of per-session sub-reports into one unified report.
// Arrays are concatenated; objects are shallow-merged (later sessions win
// on key collisions, which is fine for URL-keyed maps like components).
// The shared crawlLog is injected directly — it was already written to
// by all sessions in real-time.
// -------------------------------------------------------------------
function mergeReports(sessionReports, sharedCrawlLog) {
  const merged = {
    summary: {
      pages:            0,
      detectedTestCases:0,
      executed:         0,
      passed:           0,
      failed:           0,
      skipped:          0,
      workflowPatterns: 0,
      sessions:         sessionReports.length,
    },
    detectedTestCases: [],
    executedChecks:    [],
    workflowPatterns:  [],
    crawlLog:          sharedCrawlLog,
    components:        {},
    workflows:         [],
    performance:       {},
    screenshots:       [],
    recommendations:   [],
    useCase:           null,

    // Per-session summary cards — shown in the dashboard WorkflowSessionsBar.
    // role is carried from the detection phase; falls back to the session name.
    workflowSessions: sessionReports.map(r => ({
      name:    r.workflowName,
      role:    r.workflowRole || r.workflowName,
      summary: r.summary,
    })),

    // Full per-session breakdown for role-aware semantic understanding and reporting.
    sessions: sessionReports.map(r => ({
      name:             r.workflowName,
      role:             r.workflowRole || r.workflowName,
      summary:          r.summary,
      pagesVisited:     Object.keys(r.components || {}).length,
      workflowPatterns: (r.workflowPatterns || []).map(w => w.pattern).slice(0, 10),
      detectedTests:    (r.detectedTestCases || []).length,
      executedChecks:   (r.executedChecks    || []).length,
    })),
  }

  for (const sub of sessionReports) {
    merged.detectedTestCases.push(...sub.detectedTestCases)
    merged.executedChecks.push(...sub.executedChecks)
    merged.workflowPatterns.push(...sub.workflowPatterns)
    Object.assign(merged.components,  sub.components)
    Object.assign(merged.performance, sub.performance)
    merged.workflows.push(...sub.workflows)
    merged.screenshots.push(...sub.screenshots)
    merged.recommendations.push(...sub.recommendations)

    merged.summary.pages             += sub.summary.pages
    merged.summary.detectedTestCases += sub.summary.detectedTestCases
    merged.summary.executed          += sub.summary.executed
    merged.summary.passed            += sub.summary.passed
    merged.summary.failed            += sub.summary.failed
    merged.summary.skipped           += sub.summary.skipped
    merged.summary.workflowPatterns  += sub.summary.workflowPatterns
  }

  // Deduplicate recommendations
  merged.recommendations = [...new Set(merged.recommendations)]

  return merged
}

// -------------------------------------------------------------------
// Per-session crawler — called once per detected workflow entry.
// Contains its own explore() closure with fully isolated state:
// visited set, interacted set, URL-pattern set, and sub-report.
// Sessions share only the sharedCrawlLog (for unified terminal output).
// -------------------------------------------------------------------
// role — the inferred user persona for this session (e.g. "Doctor", "Admin").
// Falls back to sessionName when the detection phase ran in single-session mode.
async function crawlSession(context, startUrl, username, password, baseOrigin, sessionName, role, sharedCrawlLog) {
  role = role || sessionName   // defensive fallback — role must never be undefined

  const page = await context.newPage()

  const report = {
    summary: {
      pages:             0,
      detectedTestCases: 0,
      executed:          0,
      passed:            0,
      failed:            0,
      skipped:           0,
      workflowPatterns:  0,
    },
    detectedTestCases: [],
    executedChecks:    [],
    workflowPatterns:  [],
    crawlLog:          [],   // schema placeholder; sharedCrawlLog is the live target
    components:        {},
    workflows:         [],
    performance:       {},
    screenshots:       [],
    recommendations:   [],
    useCase:           null
  }

  const log = createLogger(sharedCrawlLog)
  log.ctx(0, `[CTX] context created  session="${sessionName}"  role="${role}"`)
  log.wflow(0, `[WFLOW] session="${sessionName}"  role="${role}"  url=${startUrl}`)
  log.scope(0, `boundary  origin=${baseOrigin}  mode=${SCOPE_MODE}`)

  const visited             = new Set()
  const interacted          = new Set()
  const exploredUrlPatterns = new Set()

  // -----------------------------------------------------------------
  async function explore(currentPage, depth = 0) {
  // -----------------------------------------------------------------

    if (depth > MAX_DEPTH) {
      log.limit(depth, `max depth (${MAX_DEPTH}) reached — not exploring further`)
      return
    }

    const currentState = await capturePageState(currentPage)
    const stateKey     = getStateKey(currentState)
    const currentUrl   = currentState.url

    if (visited.has(stateKey)) {
      log.ignore(depth, `url=${shortUrl(currentUrl)} — state already fully explored`)
      return
    }
    visited.add(stateKey)

    log.state(depth,
      `depth=${depth}  url=${shortUrl(currentUrl)}  ` +
      `title="${currentState.title}"  ` +
      `dialogs=${currentState.openDialogs}  expanded=${currentState.expandedCount}`
    )
    log.scope(depth, `in-app=${isSameAppDomain(baseOrigin, currentUrl)}  boundary=${baseOrigin}`)

    await waitForStability(currentPage)

    const start = Date.now()

    // ---- Component inventory ----
    const buttons    = await currentPage.locator('button').allTextContents()
    const links      = await currentPage.locator('a').allTextContents()
    const headings   = await currentPage.locator('h1, h2, h3').allTextContents()
    const forms      = await currentPage.locator('form').count()
    const inputs     = await currentPage.locator('input').count()
    const dropdowns  = await currentPage.locator('select').count()
    const uploads    = await currentPage.locator('input[type=file]').count()
    const searchBars = await currentPage.locator(
      'input[type=search], input[placeholder*=search i]'
    ).count()

    const uniqueButtons = [...new Set(buttons.map(b => normalizeLabel(b)).filter(Boolean))].length
    const uniqueLinks   = [...new Set(links.map(l => normalizeLabel(l)).filter(Boolean))].length

    const buttonFreq         = countLabelFrequency(buttons)
    const repeatedRowActions = Object.entries(buttonFreq)
      .filter(([, count]) => count >= REPEAT_THRESHOLD)
      .map(([label, count]) => ({ label, occurrences: count }))

    report.performance[currentUrl] = { loadTime: Date.now() - start }
    report.components[currentUrl]  = {
      uniqueButtons, uniqueLinks,
      forms, inputs, dropdowns, uploads, searchBars,
      repeatedRowActions,
      // Raw text arrays consumed by the use-case classifier's signal extractor
      pageTitle:    currentState.title,
      buttonTexts:  [...new Set(buttons.map(b => b.trim().toLowerCase()).filter(Boolean))],
      linkTexts:    [...new Set(links.map(l => l.trim().toLowerCase()).filter(Boolean))],
      headingTexts: [...new Set(headings.map(h => h.trim().toLowerCase()).filter(Boolean))],
    }

    log.detect(depth,
      `buttons=${uniqueButtons}  links=${uniqueLinks}  ` +
      `forms=${forms}  inputs=${inputs}  dropdowns=${dropdowns}` +
      (repeatedRowActions.length
        ? `  repeatedActions=[${repeatedRowActions.map(r => r.label).join(', ')}]`
        : '')
    )

    // Announce detected patterns so logs show what will be executed
    for (const ra of repeatedRowActions) {
      log.select(depth,
        `pattern detected: "${ra.label}" × ${ra.occurrences} occurrences — will execute one representative`
      )
    }

    // ---- Detected test case generation ----
    if (forms > 0) {
      report.detectedTestCases.push({
        component: 'Forms', page: currentUrl, status: 'detected',
        tests: ['Validate required fields', 'Validate invalid input', 'Validate empty form']
      })
    }
    if (searchBars > 0) {
      report.detectedTestCases.push({
        component: 'Search', page: currentUrl, status: 'detected',
        tests: ['Search valid keyword', 'Search invalid keyword', 'Search empty input']
      })
    }
    if (dropdowns > 0) {
      report.detectedTestCases.push({
        component: 'Dropdown', page: currentUrl, status: 'detected',
        tests: ['Validate selection', 'Validate default option']
      })
    }
    const buttonCases = buildButtonTestCases(buttons, currentUrl)
    report.detectedTestCases.push(...buttonCases.map(c => ({ ...c, status: 'detected' })))

    // ---- Login ----
    const passwordFields = await currentPage.locator('input[type=password]').count()
    if (passwordFields > 0 && username && password) {
      log.login(depth, 'password field detected — attempting login form interaction')
      const loginCheck = {
        type: 'login', page: currentUrl, target: 'login form',
        status: 'fail', outcomeCategory: 'error', outcome: '',
        isRepresentative: false, patternOccurrences: null,
        timestamp: new Date().toISOString()
      }
      try {
        await currentPage.locator('input[type=text], input[type=email]').first().fill(username)
        await currentPage.locator('input[type=password]').fill(password)
        await currentPage.locator('button, input[type=submit]').first().click()
        await currentPage.waitForTimeout(3000)
        loginCheck.status          = 'pass'
        loginCheck.outcomeCategory = 'navigation'
        loginCheck.outcome         = 'login form submitted successfully'
      } catch (err) {
        loginCheck.outcome = (err.message || 'login interaction failed').split('\n')[0].slice(0, 120)
      }
      report.executedChecks.push(loginCheck)
      log.login(depth, `${loginCheck.status}  ${loginCheck.outcome}`)
    }

    // ---- Screenshot ----
    const safeName       = currentUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '_')
    const screenshotPath = `screenshots/${safeName}.png`
    await currentPage.screenshot({ path: screenshotPath, fullPage: true })
    report.screenshots.push(screenshotPath)
    log.shot(depth, screenshotPath)

    // ---- Collect all clickable elements once ----
    const clickable = await currentPage.locator(INTERACTIVE_SELECTOR).elementHandles()
    log.scan(depth,
      `found ${clickable.length} clickable elements — attempting up to ${MAX_INTERACTIONS_PER_STATE}`
    )

    let interactionCount = 0
    let duplicateSkips   = 0

    // ================================================================
    // PHASE A — Build a label → handle map from all visible elements
    //
    // Purpose: let Phase B look up any repeated pattern by label
    // without scanning the DOM again per pattern. Uses text content
    // (not aria-label) as the key so it matches countLabelFrequency,
    // which also uses text content via allTextContents().
    // ================================================================
    const labelToHandle = new Map()  // normalizedLabel → { handle, elementId }

    for (const item of clickable) {
      try {
        if (!await item.isVisible()) continue
        // Key by raw text content — same source as countLabelFrequency
        const rawText = (await item.textContent() || '').trim()
        const normed  = normalizeLabel(rawText)
        if (normed && !labelToHandle.has(normed)) {
          const elementId = await getElementIdentifier(item)
          labelToHandle.set(normed, { handle: item, elementId })
        }
      } catch {
        continue  // stale handle during map build — skip silently
      }
    }

    // ================================================================
    // PHASE B — Execute one representative per repeated pattern
    //
    // This is the bridge between detection and execution.
    // The previous architecture relied on encountering representative
    // elements by chance during the general loop (Phase C). If patterns
    // appeared after position MAX_INTERACTIONS_PER_STATE in the DOM,
    // they were silently cut off and never executed.
    //
    // Phase B fixes this: it explicitly looks up each detected pattern
    // in the map built by Phase A and executes one representative,
    // BEFORE the general loop consumes the interaction budget.
    // ================================================================
    for (const pattern of repeatedRowActions) {

      if (interactionCount >= MAX_INTERACTIONS_PER_STATE) {
        log.limit(depth,
          `cap reached — cannot execute representative for "${pattern.label}"`
        )
        continue
      }

      const entry = labelToHandle.get(pattern.label)

      if (!entry) {
        // Pattern was detected in button text but no matching visible element
        // was found in the clickable collection. This can happen when the
        // button is hidden, in an iframe, or in a shadow DOM.
        log.select(depth,
          `pattern "${pattern.label}" — no visible element found, skipping representative`
        )
        continue
      }

      const { handle, elementId } = entry
      const interactionKey = `${stateKey}:${elementId}`

      if (interacted.has(interactionKey)) {
        // Already executed this element (e.g., it was also selected as
        // the representative for another pattern — very rare edge case).
        log.select(depth,
          `representative for "${pattern.label}" already executed — skipping`
        )
        continue
      }

      // Mark as interacted BEFORE clicking so Phase C skips it
      interacted.add(interactionKey)
      interactionCount++

      log.select(depth,
        `"${pattern.label}" × ${pattern.occurrences} occurrences — ` +
        `selected representative: ${elementId}`
      )
      log.execute(depth, elementId)

      const beforeState = await capturePageState(currentPage)
      const clickCheck  = {
        type:               'representative',
        page:               currentUrl,
        target:             elementId,
        status:             'noChange',
        outcomeCategory:    'no-change',
        outcome:            'no state change detected',
        isRepresentative:   true,
        patternOccurrences: pattern.occurrences,
        timestamp:          new Date().toISOString()
      }

      try {
        await handle.click({ timeout: 2000 })
      } catch (err) {
        // Click itself failed (timeout, element detached, etc.)
        const message = (err.message || 'click failed').split('\n')[0].slice(0, 120)
        clickCheck.status          = 'fail'
        clickCheck.outcomeCategory = 'error'
        clickCheck.outcome         = message
        log.fail(depth, `${elementId}  ${message}`)

        report.workflowPatterns.push({
          pattern: pattern.label, occurrences: pattern.occurrences,
          page: currentUrl, representativeId: elementId,
          outcomeCategory: 'error', outcome: message,
          status: 'fail', timestamp: new Date().toISOString()
        })
        report.executedChecks.push(clickCheck)
        continue
      }

      // Click succeeded — now observe the outcome and recurse if needed
      await handleClickOutcome(
        currentPage, beforeState, clickCheck, depth, currentUrl,
        log, report, exploredUrlPatterns, explore, baseOrigin
      )

      // Record workflow pattern result (all statuses — pass, noChange, fail)
      report.workflowPatterns.push({
        pattern:          pattern.label,
        occurrences:      pattern.occurrences,
        page:             currentUrl,
        representativeId: elementId,
        outcomeCategory:  clickCheck.outcomeCategory,
        outcome:          clickCheck.outcome,
        status:           clickCheck.status,
        timestamp:        new Date().toISOString()
      })
      report.executedChecks.push(clickCheck)

      if (clickCheck.status === 'pass') {
        log.workflow(depth,
          `"${pattern.label}" → [${clickCheck.outcomeCategory}]  ${clickCheck.outcome}` +
          `  (${pattern.occurrences} occurrences)`
        )
      }
    }

    // ================================================================
    // PHASE C — General interaction loop (all remaining elements)
    //
    // Representatives from Phase B are already in the interacted Set,
    // so they appear as "duplicate" here and are skipped naturally.
    // This loop handles every other interactive element on the page.
    // ================================================================
    for (const item of clickable) {

      if (interactionCount >= MAX_INTERACTIONS_PER_STATE) {
        log.limit(depth,
          `cap of ${MAX_INTERACTIONS_PER_STATE} reached — ` +
          `${clickable.length - interactionCount - duplicateSkips} elements not attempted`
        )
        break
      }

      // Setup phase — get identifier and check deduplication
      let elementId, interactionKey
      try {
        if (!await item.isVisible()) continue

        elementId      = await getElementIdentifier(item)
        interactionKey = `${stateKey}:${elementId}`

        if (interacted.has(interactionKey)) {
          // This covers both: elements already interacted in a previous
          // explore() call AND representatives executed in Phase B above
          log.skip(depth, `${elementId}  reason=duplicate (already interacted in this state)`)
          duplicateSkips++
          continue
        }

        // Pre-click scope check for explicit href links.
        // Avoids a wasted click + goBack() round-trip on known external anchors.
        // Buttons and role-based elements without href fall through to the
        // post-click check in handleClickOutcome.
        const href = await item.getAttribute('href') || ''
        if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
          if (!isSameAppDomain(baseOrigin, href)) {
            log.block(depth, `external link skipped: ${href.slice(0, 80)}`)
            continue  // don't consume interaction budget for external anchors
          }
        }

        interacted.add(interactionKey)
        interactionCount++
      } catch {
        continue  // stale handle
      }

      // Execution phase — plain click, not a representative
      const beforeState = await capturePageState(currentPage)
      const clickCheck  = {
        type:               'click',
        page:               currentUrl,
        target:             elementId,
        status:             'noChange',
        outcomeCategory:    'no-change',
        outcome:            'no state change detected',
        isRepresentative:   false,
        patternOccurrences: null,
        timestamp:          new Date().toISOString()
      }

      log.click(depth, elementId)

      try {
        await item.click({ timeout: 2000 })
      } catch (err) {
        const message = (err.message || 'click failed').split('\n')[0].slice(0, 120)
        clickCheck.status          = 'fail'
        clickCheck.outcomeCategory = 'error'
        clickCheck.outcome         = message
        log.fail(depth, `${elementId}  ${message}`)
        report.executedChecks.push(clickCheck)
        continue
      }

      await handleClickOutcome(
        currentPage, beforeState, clickCheck, depth, currentUrl,
        log, report, exploredUrlPatterns, explore, baseOrigin
      )
      report.executedChecks.push(clickCheck)
    }
  }
  // -----------------------------------------------------------------

  await page.goto(startUrl, { waitUntil: 'networkidle' })
  await explore(page)

  const passed = report.executedChecks.filter(c => c.status === 'pass').length
  const failed = report.executedChecks.filter(c => c.status === 'fail').length

  report.summary.pages             = Object.keys(report.components).length
  report.summary.detectedTestCases = report.detectedTestCases.length
  report.summary.executed          = report.executedChecks.length
  report.summary.passed            = passed
  report.summary.failed            = failed
  report.summary.skipped           = report.summary.detectedTestCases - report.summary.executed
  report.summary.workflowPatterns  = report.workflowPatterns.length

  report.recommendations.push('Improve accessibility validations')
  report.recommendations.push('Optimize slow pages')

  log.done(0,
    `session "${sessionName}" complete  pages=${report.summary.pages}  ` +
    `executed=${report.summary.executed}  passed=${passed}  failed=${failed}`
  )

  // Tag every record with session name AND role so merged reports stay traceable
  // and the semantic agent can reason about role-specific workflows.
  for (const c of report.executedChecks)    { c.workflowName = sessionName; c.workflowRole = role }
  for (const t of report.detectedTestCases) { t.workflowName = sessionName; t.workflowRole = role }
  for (const w of report.workflowPatterns)  { w.workflowName = sessionName; w.workflowRole = role }
  report.workflowName = sessionName
  report.workflowRole = role

  return report
}

// -------------------------------------------------------------------
// Main agent — orchestrates single-session or multi-session crawls.
// Creates a throwaway detection context first, then one isolated
// browser context per detected workflow entry.
// -------------------------------------------------------------------
async function runAgent(url, username, password) {

  const browser        = await chromium.launch({ headless: false })
  const sharedCrawlLog = []
  const log            = createLogger(sharedCrawlLog)
  const baseOrigin     = new URL(url).origin

  log.crawl(0, `starting  url=${url}`)
  log.scope(0, `boundary  origin=${baseOrigin}  mode=${SCOPE_MODE}`)

  // ---- Phase 1: Workflow Entry Discovery ----
  // A throwaway context isolates detection from any session state changes.
  log.wflow(0, '[PHASE-1] workflow entry discovery starting...')
  const detectionCtx  = await browser.newContext()
  const detectionPage = await detectionCtx.newPage()
  let entries = []
  try {
    await detectionPage.goto(url, { waitUntil: 'networkidle', timeout: 15000 })
    entries = await detectWorkflowEntryPoints(detectionPage, baseOrigin, log)
  } catch (err) {
    log.wflow(0,
      `[PHASE-1] entry discovery failed: ${(err.message || '').split('\n')[0].slice(0, 80)}` +
      ` — falling back to single-session crawl`
    )
  } finally {
    await detectionCtx.close().catch(() => {})
  }
  log.wflow(0, `[PHASE-1] complete  entryPoints=${entries.length}`)

  // ---- Phase 2 + 3: Session Creation & Independent Authentication ----
  const sessionReports = []

  if (entries.length < 2) {
    // Single-session path — identical to the original single-portal behaviour
    log.wflow(0, '[PHASE-2] single-session mode')
    log.ctx(0,   '[CTX] creating browser context for single session')
    const ctx = await browser.newContext()
    log.auth(0,  '[AUTH] authenticating single session  role="User"')
    log.crawl(0, '[CRAWL] crawling single session')
    const sr  = await crawlSession(
      ctx, url, username, password, baseOrigin, 'default', 'User', sharedCrawlLog
    )
    await ctx.close()
    log.ctx(0, '[CTX] single-session context closed')
    sessionReports.push(sr)

  } else {
    // Multi-workflow path — one isolated browser context per discovered entry point
    log.wflow(0, `[PHASE-2] multi-workflow mode  sessions=${entries.length}`)
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      log.switch_(0,
        `[SWITCH] [${i + 1}/${entries.length}]  session="${entry.sessionId}"  role="${entry.role}"`
      )
      log.ctx(0,
        `[CTX] creating isolated context  session="${entry.sessionId}"  role="${entry.role}"`
      )
      const ctx = await browser.newContext()
      log.auth(0,
        `[AUTH] authenticating  session="${entry.sessionId}"  role="${entry.role}"  url=${shortUrl(entry.url)}`
      )
      log.crawl(0,
        `[CRAWL] crawling workflow session="${entry.sessionId}"  role="${entry.role}"`
      )
      const sr  = await crawlSession(
        ctx, entry.url, username, password, baseOrigin,
        entry.entryLabel, entry.role, sharedCrawlLog
      )
      await ctx.close()
      log.ctx(0, `[CTX] context closed  session="${entry.sessionId}"  role="${entry.role}"`)
      sessionReports.push(sr)
    }
  }

  // ---- Step 3: Merge all session reports ----
  const merged = mergeReports(sessionReports, sharedCrawlLog)
  log.merge(0,
    `merged ${sessionReports.length} session(s)  ` +
    `total pages=${merged.summary.pages}  executed=${merged.summary.executed}`
  )

  // ---- Step 4: Semantic use-case analysis on the complete merged dataset ----
  merged.useCase = await runUseCaseAgent(merged, log)

  // Verify expected schema fields are present — log any missing ones immediately
  const EXPECTED_FIELDS = ['applicationType', 'businessDescription', 'coreWorkflows', 'detectedRoles', 'confidence', 'reasoning', 'classifiedBy']
  const missingFields   = EXPECTED_FIELDS.filter(f => !(f in merged.useCase))
  if (missingFields.length > 0) {
    log.fail(0, `[USECASE-SCHEMA] missing fields in useCase: ${missingFields.join(', ')}`)
  }
  // Verify NO legacy fields leaked through
  const LEGACY_FIELDS   = ['signals', 'alternativeTypes', 'matchedSignals', 'allScores', 'label']
  const presentLegacy   = LEGACY_FIELDS.filter(f => f in merged.useCase)
  if (presentLegacy.length > 0) {
    log.fail(0, `[USECASE-SCHEMA] legacy fields still present: ${presentLegacy.join(', ')}`)
  }

  log.crawl(0,
    `[USECASE-FINAL] type="${merged.useCase.applicationType}"` +
    `  confidence=${merged.useCase.confidence}` +
    `  classifiedBy=${merged.useCase.classifiedBy}` +
    `  workflows=[${(merged.useCase.coreWorkflows || []).slice(0, 3).join(', ')}]` +
    `  roles=[${(merged.useCase.detectedRoles || []).join(', ')}]`
  )
  console.log('\n[USECASE → API RESPONSE]')
  console.log(JSON.stringify(merged.useCase, null, 2))

  log.done(0,
    `crawl complete  sessions=${sessionReports.length}  pages=${merged.summary.pages}  ` +
    `executed=${merged.summary.executed}  passed=${merged.summary.passed}  ` +
    `failed=${merged.summary.failed}  skipped=${merged.summary.skipped}`
  )

  fs.writeFileSync('report.json', JSON.stringify(merged, null, 2))
  await browser.close()

  return merged
}

module.exports = runAgent
