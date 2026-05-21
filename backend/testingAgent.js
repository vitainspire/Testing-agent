
const { chromium }         = require('playwright')
const fs                   = require('fs')
const { runUseCaseAgent }    = require('./agents/useCaseAgent')
const { runQAAnalysisAgent } = require('./agents/qaAnalysisAgent')

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

// -------------------------------------------------------------------
// Execution State Engine
// Every executed test MUST resolve to exactly one of these terminal states.
//
// PASS      — test ran, application state changed meaningfully
// FAIL      — test ran, outcome indicates an application-level failure
// NO_CHANGE — test ran, no observable state change (valid outcome)
// SKIPPED   — test could not be attempted (cap, element not found, duplicate)
// ERROR     — test attempted but failed due to a technical/infrastructure issue
//
// Invariant: executedTests === passedTests + failedTests + noChangeTests + errorTests
// skippedTests are NOT included in executedTests.
// -------------------------------------------------------------------
const EXECUTION_STATUS = {
  PASS:      'pass',
  FAIL:      'fail',
  NO_CHANGE: 'noChange',
  SKIPPED:   'skipped',
  ERROR:     'error',
}

const ASSERTION_SEVERITY = {
  LOW:      'low',
  MEDIUM:   'medium',
  HIGH:     'high',
  CRITICAL: 'critical',
}

// Action priority scores — higher = execute sooner in Phase B/C
const ACTION_SCORE = {
  CRITICAL: 95,
  HIGH:     80,
  MEDIUM:   55,
  LOW:      20,
  DEFAULT:  40,
}

// Scope policy for domain boundary enforcement.
// 'origin' — strict: scheme + hostname + port must match exactly.
// 'domain' — relaxed: same base domain allows cross-subdomain navigation
//            (e.g. app.example.com ↔ auth.example.com are both allowed).
// Start with 'domain' so auth subdomains are not blocked.
const SCOPE_MODE = 'domain'

// -------------------------------------------------------------------
// Stateful UI element pattern — elements whose natural behavior is
// toggle/open/close, producing pass on first click and noChange on
// repeat clicks. These are NOT flaky; they are deterministic stateful.
// -------------------------------------------------------------------
const STATEFUL_TARGET_PATTERN =
  /menu|toggle|hamburger|burger|accordion|sidebar|dropdown|nav(?:bar)?|open|close|expand|collapse|tab|drawer|panel|modal|popup|dialog|overlay/i

// -------------------------------------------------------------------
// Business workflow registry
// Each app type lists the canonical workflows expected from that class
// of application. Coverage = completed / expected, NOT executed / detected.
// -------------------------------------------------------------------
const EXPECTED_WORKFLOWS = {
  ecommerce: [
    { id: 'login',               label: 'Login' },
    { id: 'browse-products',     label: 'Browse Products' },
    { id: 'view-product-detail', label: 'View Product Detail' },
    { id: 'add-to-cart',         label: 'Add to Cart' },
    { id: 'view-cart',           label: 'View Cart' },
    { id: 'remove-from-cart',    label: 'Remove from Cart' },
    { id: 'checkout',            label: 'Checkout' },
    { id: 'logout',              label: 'Logout' },
  ],
  crm: [
    { id: 'login',               label: 'Login' },
    { id: 'view-records',        label: 'View Records' },
    { id: 'create-record',       label: 'Create Record' },
    { id: 'edit-record',         label: 'Edit Record' },
    { id: 'filter-search',       label: 'Filter / Search' },
    { id: 'logout',              label: 'Logout' },
  ],
  dashboard: [
    { id: 'login',               label: 'Login' },
    { id: 'view-dashboard',      label: 'View Dashboard' },
    { id: 'navigate-sections',   label: 'Navigate Sections' },
    { id: 'filter-data',         label: 'Filter Data' },
    { id: 'logout',              label: 'Logout' },
  ],
  generic: [
    { id: 'navigate',            label: 'Navigate Pages' },
    { id: 'interact',            label: 'Interact with UI' },
    { id: 'form-submit',         label: 'Submit Form' },
  ],
}

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
    execution:(d, msg) => emit(d, 'EXECUTION',msg),   // per-test terminal state
    metrics:  (d, msg) => emit(d, 'METRICS',  msg),   // session metric snapshot
    statediff:(d, msg) => emit(d, 'STATE-DIFF',msg),  // fine-grained UI diff signal
    retry:    (d, msg) => emit(d, 'RETRY',    msg),   // click retry attempt
    recover:  (d, msg) => emit(d, 'RECOVER',  msg),   // mouse.click coordinate fallback
    explore_: (d, msg) => emit(d, 'EXPLORE',  msg),   // targeted exploration strategy
    plan:     (d, msg) => emit(d, 'PLAN',    msg),
    workflow_:(d, msg) => emit(d, 'WFEXEC',  msg),
    assert_:  (d, msg) => emit(d, 'ASSERT',  msg),
    quality:  (d, msg) => emit(d, 'QUALITY', msg),
    memory:   (d, msg) => emit(d, 'MEMORY',  msg),
    graph:    (d, msg) => emit(d, 'GRAPH',   msg),
    cart_:    (d, msg) => emit(d, 'CART',    msg),
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
    // Full URL or hash change — distinguish hash-routing from full navigation
    try {
      const bu = new URL(before.url)
      const au = new URL(after.url)
      if (bu.pathname === au.pathname && bu.search === au.search && bu.hash !== au.hash) {
        category    = 'hash-navigation'
        description = `hash changed to ${au.hash || '#'}`
      } else {
        category    = 'navigation'
        description = `navigated to ${au.pathname}`
      }
    } catch {
      category    = 'navigation'
      description = `navigated to ${after.url}`
    }
  } else if (before.sidebarOpen < after.sidebarOpen) {
    category    = 'sidebar-opened'
    description = 'sidebar or navigation panel opened'
  } else if (before.sidebarOpen > after.sidebarOpen) {
    category    = 'sidebar-closed'
    description = 'sidebar or navigation panel closed'
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

      // URL hash — detects SPA hash-routing without full navigation
      const urlHash = location.hash

      // Visible sidebars / drawers / nav panels — detects off-canvas menus opening
      const sidebarOpen = [...document.querySelectorAll(
        '[role="navigation"], aside, [class*="sidebar"], [class*="drawer"],' +
        '[class*="offcanvas"], [class*="side-panel"], [class*="sidemenu"]'
      )].filter(el => {
        const s = window.getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0
      }).length

      // Total interactive button count — lightweight AJAX-mutation signal
      const buttonCount = document.querySelectorAll('button, [role="button"]').length

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
        urlHash,
        sidebarOpen,
        buttonCount,
      }
    })
  } catch {
    return {
      url: page.url(), title: '', textBucket: 0, openDialogs: 0, expandedCount: 0,
      visibleInputs: 0, editableCount: 0, selectedCount: 0, checkedCount: 0,
      errorCount: 0, rowCount: 0, activePanels: 0, childCount: 0,
      urlHash: '', sidebarOpen: 0, buttonCount: 0,
    }
  }
}

// -------------------------------------------------------------------
// captureUIState
// Fine-grained UI snapshot — captures signals invisible to capturePageState:
//   button texts, badge/counter values, ARIA states, class fingerprints,
//   toast presence, disabled counts.
// Runs one browser evaluate call; returns plain-JSON data safe for diffing.
// -------------------------------------------------------------------
async function captureUIState(page) {
  try {
    return await page.evaluate(() => {
      function isVisible(el) {
        const s = window.getComputedStyle(el)
        return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0
      }

      // 1. All visible button / action-element texts
      const buttonTexts = [...document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"], input[type="reset"]'
      )]
        .filter(isVisible)
        .map(el => ((el.textContent || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase()))
        .filter(Boolean)

      // 2. Badge and counter values — numeric text inside badge-like elements.
      //    Uses a broad class-name heuristic so it works across any app.
      const badgeEls = [...document.querySelectorAll(
        '[class*="badge"], [class*="count"], [class*="counter"], [class*="quantity"],' +
        '[class*="cart"], [class*="basket"], [class*="notification"], [class*="indicator"],' +
        '[class*="label"], [data-count], [data-badge]'
      )].filter(isVisible)

      const badgeMap = {}
      badgeEls.forEach((el, i) => {
        const raw = (el.textContent || el.getAttribute('data-count') || el.getAttribute('data-badge') || '').trim()
        if (raw && /^\d+$/.test(raw)) {
          // Key by class list so the diff can report which counter changed
          const key = (el.className || '').trim().replace(/\s+/g, ' ').slice(0, 60) || `badge[${i}]`
          badgeMap[key] = parseInt(raw, 10)
        }
      })

      // Scalar summary so hasStateChanged can use a single number check
      const totalBadgeSum = Object.values(badgeMap).reduce((s, v) => s + v, 0)

      // 3. ARIA interaction states — pressed, checked, disabled
      const ariaPressedTrue  = document.querySelectorAll('[aria-pressed="true"]').length
      const ariaCheckedTrue  = document.querySelectorAll('[aria-checked="true"]').length
      const ariaDisabledTrue = [...document.querySelectorAll('[aria-disabled], [disabled]')]
        .filter(el => el.getAttribute('aria-disabled') !== 'false' && !el.disabled === false).length

      // 4. Visible toasts / snackbars / flash messages
      const toastCount = [...document.querySelectorAll(
        '[class*="toast"], [class*="snackbar"], [class*="flash"], [class*="notification"],' +
        '[class*="alert"]:not([role="alert"]), [class*="banner"]'
      )].filter(isVisible).length

      // 5. Class fingerprint of all interactive elements — detects active/selected/loading class swaps.
      //    Capped at 150 elements to bound memory; sorted for determinism.
      const classPrint = [...document.querySelectorAll(
        'button, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"]'
      )]
        .filter(isVisible)
        .slice(0, 150)
        .map(el => [...el.classList].sort().join(' '))
        .join('||')

      // 6. Visible link texts — detects nav/menu changes after AJAX
      const linkTexts = [...document.querySelectorAll('a')]
        .filter(isVisible)
        .map(el => (el.textContent || '').trim().toLowerCase().slice(0, 60))
        .filter(Boolean)

      // 7. Storage fingerprint — catches AJAX state changes written to localStorage/sessionStorage
      //    (e.g. cart item added, user preferences saved, session token updated)
      let storageHash = ''
      try {
        const items = []
        for (let i = 0; i < Math.min(localStorage.length, 30); i++) {
          const k = localStorage.key(i)
          items.push(`ls:${k}=${(localStorage.getItem(k) || '').slice(0, 60)}`)
        }
        for (let i = 0; i < Math.min(sessionStorage.length, 20); i++) {
          const k = sessionStorage.key(i)
          items.push(`ss:${k}=${(sessionStorage.getItem(k) || '').slice(0, 60)}`)
        }
        storageHash = items.sort().join('|')
      } catch {}

      return {
        buttonTexts,
        badgeMap,
        totalBadgeSum,
        buttonCount:       buttonTexts.length,
        linkCount:         linkTexts.length,
        ariaPressedTrue,
        ariaCheckedTrue,
        ariaDisabledTrue,
        toastCount,
        classPrint,
        storageHash,
      }
    })
  } catch {
    return {
      buttonTexts: [], badgeMap: {}, totalBadgeSum: 0,
      buttonCount: 0, linkCount: 0,
      ariaPressedTrue: 0, ariaCheckedTrue: 0, ariaDisabledTrue: 0,
      toastCount: 0, classPrint: '', storageHash: '',
    }
  }
}

// -------------------------------------------------------------------
// diffUIState
// Compares two captureUIState snapshots and returns the most specific
// outcome category + description, plus a full diffs array for logging.
// Returns { changed, category, description, diffs }.
// -------------------------------------------------------------------
function diffUIState(before, after, log, depth) {
  const diffs = []

  // -- button text changes (e.g. "Add to cart" → "Remove") --
  const beforeSet = new Set(before.buttonTexts)
  const afterSet  = new Set(after.buttonTexts)
  const added   = after.buttonTexts.filter(t => !beforeSet.has(t))
  const removed = before.buttonTexts.filter(t => !afterSet.has(t))
  if (added.length || removed.length) {
    const parts = []
    if (removed.length) parts.push(`removed: [${removed.slice(0, 3).join(', ')}]`)
    if (added.length)   parts.push(`appeared: [${added.slice(0, 3).join(', ')}]`)
    const desc = `button text changed (${parts.join('; ')})`
    diffs.push({ signal: 'button-text', category: 'state-change', description: desc })
    log.statediff(depth, desc)
  }

  // -- badge / counter updates --
  if (before.totalBadgeSum !== after.totalBadgeSum) {
    const delta = after.totalBadgeSum - before.totalBadgeSum
    const desc  = `counter/badge changed ${before.totalBadgeSum} → ${after.totalBadgeSum} (${delta > 0 ? '+' : ''}${delta})`
    diffs.push({ signal: 'counter', category: 'counter-update', description: desc })
    log.statediff(depth, desc)
  } else {
    // Even if sum is same, individual counter keys may have changed
    const keys = new Set([...Object.keys(before.badgeMap), ...Object.keys(after.badgeMap)])
    for (const k of keys) {
      const bv = before.badgeMap[k] ?? 0
      const av = after.badgeMap[k] ?? 0
      if (bv !== av) {
        const desc = `counter "${k.slice(0, 40)}" changed ${bv} → ${av}`
        diffs.push({ signal: 'counter', category: 'counter-update', description: desc })
        log.statediff(depth, desc)
        break  // one entry is enough; sum already logged if multiple changed
      }
    }
  }

  // -- aria-pressed (toggle buttons, like/star/bookmark) --
  if (before.ariaPressedTrue !== after.ariaPressedTrue) {
    const delta = after.ariaPressedTrue - before.ariaPressedTrue
    const desc  = `aria-pressed changed ${before.ariaPressedTrue} → ${after.ariaPressedTrue} (${delta > 0 ? '+' : ''}${delta})`
    diffs.push({ signal: 'aria-pressed', category: 'state-change', description: desc })
    log.statediff(depth, desc)
  }

  // -- aria-checked (checkboxes, switches, toggles) --
  if (before.ariaCheckedTrue !== after.ariaCheckedTrue) {
    const delta = after.ariaCheckedTrue - before.ariaCheckedTrue
    const desc  = `aria-checked changed ${before.ariaCheckedTrue} → ${after.ariaCheckedTrue} (${delta > 0 ? '+' : ''}${delta})`
    diffs.push({ signal: 'aria-checked', category: 'state-change', description: desc })
    log.statediff(depth, desc)
  }

  // -- disabled / enabled state flip --
  if (before.ariaDisabledTrue !== after.ariaDisabledTrue) {
    const desc = `disabled state changed ${before.ariaDisabledTrue} → ${after.ariaDisabledTrue} elements`
    diffs.push({ signal: 'disabled-state', category: 'state-change', description: desc })
    log.statediff(depth, desc)
  }

  // -- toast / snackbar appeared --
  if (after.toastCount > before.toastCount) {
    const desc = `${after.toastCount - before.toastCount} notification/toast appeared`
    diffs.push({ signal: 'toast', category: 'async-update', description: desc })
    log.statediff(depth, desc)
  }

  // -- CSS class fingerprint changed (active/selected/loading/highlighted) --
  if (before.classPrint !== after.classPrint) {
    const desc = 'interactive element CSS classes changed'
    diffs.push({ signal: 'class-change', category: 'state-change', description: desc })
    log.statediff(depth, desc)
  }

  // -- button or link count changed (AJAX-rendered items, add/remove rows) --
  const btnDelta = after.buttonCount - before.buttonCount
  const lnkDelta = after.linkCount   - before.linkCount
  if (btnDelta !== 0 || lnkDelta !== 0) {
    const parts = []
    if (btnDelta) parts.push(`buttons ${btnDelta > 0 ? '+' : ''}${btnDelta}`)
    if (lnkDelta) parts.push(`links ${lnkDelta > 0 ? '+' : ''}${lnkDelta}`)
    const desc = `dynamic content updated (${parts.join(', ')})`
    diffs.push({ signal: 'dom-count', category: 'content-update', description: desc })
    log.statediff(depth, desc)
  }

  // -- localStorage / sessionStorage mutation (AJAX state write) --
  if (before.storageHash !== undefined && after.storageHash !== undefined &&
      before.storageHash !== after.storageHash) {
    const desc = 'client storage state changed (localStorage/sessionStorage)'
    diffs.push({ signal: 'storage', category: 'async-update', description: desc })
    log.statediff(depth, desc)
  }

  if (diffs.length === 0) {
    return { changed: false, category: 'no-change', description: 'no state change detected', diffs: [] }
  }

  // Priority order — most specific first
  const PRIORITY = ['counter-update', 'async-update', 'state-change', 'content-update']
  const sorted   = diffs.slice().sort(
    (a, b) => PRIORITY.indexOf(a.category) - PRIORITY.indexOf(b.category)
  )
  return {
    changed:     true,
    category:    sorted[0].category,
    description: sorted[0].description,
    diffs,
  }
}

function hasStateChanged(before, after) {
  if (before.url           !== after.url)           return true
  if (before.urlHash       !== after.urlHash)       return true
  if (before.title         !== after.title)         return true
  if (before.openDialogs   !== after.openDialogs)   return true
  if (before.sidebarOpen   !== after.sidebarOpen)   return true
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
  if (before.buttonCount   !== after.buttonCount)   return true
  return false
}

function getStateKey(state) {
  // Include urlHash and buttonCount so hash-routing and AJAX mutations
  // produce distinct keys and avoid premature deduplication.
  return [
    state.url,
    state.urlHash || '',
    `dlg:${state.openDialogs}`,
    `exp:${state.expandedCount}`,
    `txt:${state.textBucket}`,
    `inp:${state.visibleInputs}`,
    `edt:${state.editableCount}`,
    `sel:${state.selectedCount}`,
    `row:${state.rowCount}`,
    `pnl:${state.activePanels}`,
    `dom:${state.childCount}`,
    `btn:${state.buttonCount || 0}`,
  ].join('|')
}

async function waitForStability(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 3000 }) } catch {}
  await page.waitForTimeout(500)
}

async function tryDismissOverlay(page) {
  try { await page.keyboard.press('Escape'); await page.waitForTimeout(400) } catch {}
}

// -------------------------------------------------------------------
// scoreAction
// Returns a numeric priority score (0–100) for an interactive element.
// Higher score = execute first. Drives Phase B/C ordering (Phase 13).
// -------------------------------------------------------------------
function scoreAction(elementId) {
  const id = (elementId || '').toLowerCase()
  if (/checkout|place.?order|buy.?now|purchase/.test(id))      return ACTION_SCORE.CRITICAL
  if (/add.?to.?cart|add.?cart|add.?basket/.test(id))          return 90
  if (/remove.?from.?cart|remove.?item|delete.?cart/.test(id)) return 85
  if (/login|sign.?in|log.?in/.test(id))                       return 88
  if (/submit|save|confirm|apply|proceed/.test(id))            return ACTION_SCORE.HIGH
  if (/logout|sign.?out|log.?out/.test(id))                    return 78
  if (/cart|basket|bag/.test(id))                              return 70
  if (/search|filter|sort|order.?by/.test(id))                 return 65
  if (/menu|nav|hamburger|drawer/.test(id))                    return 60
  if (/modal|popup|dialog/.test(id))                           return ACTION_SCORE.MEDIUM
  if (/edit|update|delete|remove/.test(id))                    return 52
  if (/footer|social|share|follow|twitter|facebook/.test(id))  return ACTION_SCORE.LOW
  if (/cookie|consent|accept.?all/.test(id))                   return 15
  return ACTION_SCORE.DEFAULT
}

// -------------------------------------------------------------------
// validateBusinessOutcome
// Phase 12 — Business Assertion Engine.
// Given an action label and before/after state snapshots, validates
// expected business outcomes and returns a structured assertion result.
// Returns null when no specific assertion applies to this action type.
// -------------------------------------------------------------------
function validateBusinessOutcome(action, beforeState, afterState, beforeUI, afterUI) {
  const a = (action || '').toLowerCase()

  if (/add.?to.?cart|add.?cart|add.?basket/.test(a)) {
    const badgeDelta  = (afterUI.totalBadgeSum || 0) - (beforeUI.totalBadgeSum || 0)
    const btnAppeared = (afterUI.buttonTexts || []).some(t => /^remove$|remove from cart/.test(t)) &&
                        !(beforeUI.buttonTexts || []).some(t => /^remove$|remove from cart/.test(t))
    const passed = badgeDelta > 0 || btnAppeared
    return {
      passed,
      assertionType: 'business',
      assertion:  'add-to-cart',
      expected:   'cart badge increments OR button text changes to "Remove"',
      actual:     `badge delta=${badgeDelta > 0 ? '+' + badgeDelta : badgeDelta}, removeBtn appeared=${btnAppeared}`,
      severity:   ASSERTION_SEVERITY.HIGH,
      confidence: 1.0,
      retryable:  true,
    }
  }

  if (/remove.?from.?cart|remove.?item|remove.?cart/.test(a)) {
    const badgeDelta = (afterUI.totalBadgeSum || 0) - (beforeUI.totalBadgeSum || 0)
    const rowDelta   = (afterState.rowCount   || 0) - (beforeState.rowCount   || 0)
    const passed = badgeDelta < 0 || rowDelta < 0
    return {
      passed,
      assertionType: 'business',
      assertion:  'remove-from-cart',
      expected:   'cart badge decrements OR item row removed',
      actual:     `badge delta=${badgeDelta}, row delta=${rowDelta}`,
      severity:   ASSERTION_SEVERITY.HIGH,
      confidence: 1.0,
      retryable:  true,
    }
  }

  if (/logout|sign.?out|log.?out/.test(a)) {
    const navigated  = beforeState.url !== afterState.url
    const loginPage  = /login|signin|sign.?in|auth/.test((afterState.url || '') + (afterState.title || ''))
    const passed = navigated && loginPage
    return {
      passed,
      assertionType: 'business',
      assertion:  'logout',
      expected:   'navigate away AND reach login/auth page',
      actual:     `navigated=${navigated}, loginPageDetected=${loginPage}, url=${shortUrl(afterState.url)}`,
      severity:   ASSERTION_SEVERITY.CRITICAL,
      confidence: 1.0,
      retryable:  false,
    }
  }

  if (/^menu$|hamburger|sidebar.?toggle|drawer.?toggle|nav.?toggle/.test(a)) {
    const passed = (afterState.sidebarOpen || 0) > (beforeState.sidebarOpen || 0)
    return {
      passed,
      assertionType: 'ui',
      assertion:  'menu-open',
      expected:   'sidebarOpen count increases',
      actual:     `sidebarOpen: ${beforeState.sidebarOpen}→${afterState.sidebarOpen}`,
      severity:   ASSERTION_SEVERITY.MEDIUM,
      confidence: 0.7,
      retryable:  true,
    }
  }

  if (/sort|filter|order.?by/.test(a)) {
    const rowChanged  = beforeState.rowCount  !== afterState.rowCount
    const textChanged = beforeState.textBucket !== afterState.textBucket
    const passed = rowChanged || textChanged
    return {
      passed,
      assertionType: 'ui',
      assertion:  'sort-filter',
      expected:   'row count or visible content changes',
      actual:     `rows: ${beforeState.rowCount}→${afterState.rowCount}`,
      severity:   ASSERTION_SEVERITY.MEDIUM,
      confidence: 0.7,
      retryable:  true,
    }
  }

  if (/checkout|place.?order|buy.?now/.test(a)) {
    const navigated = beforeState.url !== afterState.url
    const orderPage = /checkout|order|confirm|payment|pay/.test((afterState.url || '') + (afterState.title || ''))
    const passed = navigated || orderPage
    return {
      passed,
      assertionType: 'business',
      assertion:  'checkout',
      expected:   'navigate to checkout or payment page',
      actual:     `navigated=${navigated}, checkoutPageDetected=${orderPage}, url=${shortUrl(afterState.url)}`,
      severity:   ASSERTION_SEVERITY.CRITICAL,
      confidence: 1.0,
      retryable:  false,
    }
  }

  if (/^login$|sign.?in/.test(a)) {
    const passed = beforeState.url !== afterState.url
    return {
      passed,
      assertionType: 'business',
      assertion:  'login',
      expected:   'navigate away from login page after submit',
      actual:     `url: ${shortUrl(beforeState.url)}→${shortUrl(afterState.url)}`,
      severity:   ASSERTION_SEVERITY.CRITICAL,
      confidence: 1.0,
      retryable:  false,
    }
  }

  if (/submit|save|confirm|apply/.test(a)) {
    const passed = beforeState.url !== afterState.url ||
                   beforeState.errorCount !== afterState.errorCount ||
                   (afterUI.toastCount || 0) > (beforeUI.toastCount || 0)
    return {
      passed,
      assertionType: 'business',
      assertion:  'form-submit',
      expected:   'navigation, validation feedback, or toast confirmation',
      actual:     `urlChanged=${beforeState.url !== afterState.url}, toast=${beforeUI.toastCount}→${afterUI.toastCount}`,
      severity:   ASSERTION_SEVERITY.HIGH,
      confidence: 0.7,
      retryable:  true,
    }
  }

  return null
}

// -------------------------------------------------------------------
// buildWorkflowGraph
// Phase 10 — Derives a workflow graph from the collected component map.
// Each page (node) maps to the next steps inferred from its interactive
// elements. The graph is used for coverage analysis and gap detection.
// -------------------------------------------------------------------
function buildWorkflowGraph(components) {
  const graph = {}

  for (const [url, comp] of Object.entries(components)) {
    const buttons = comp.buttonTexts || []
    const links   = comp.linkTexts   || []
    let pageKey
    try {
      const p = new URL(url).pathname
      pageKey = (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[^a-z0-9]/gi, '-').slice(0, 30)) || 'home'
    } catch {
      pageKey = 'page'
    }

    const edges = new Set()

    for (const btn of buttons) {
      const b = btn.toLowerCase()
      if (/checkout|place.?order/.test(b))         edges.add('checkout')
      else if (/add.?to.?cart|add.?basket/.test(b)) edges.add('cart')
      else if (/remove.?from.?cart/.test(b))        edges.add('cart')
      else if (/logout|sign.?out/.test(b))          edges.add('logout')
      else if (/login|sign.?in/.test(b))            edges.add('login')
      else if (/sort|filter/.test(b))               edges.add('filter')
      else if (/edit|update/.test(b))               edges.add('edit-form')
      else if (/delete|remove/.test(b))             edges.add('delete-action')
      else if (/search/.test(b))                    edges.add('search')
      else if (/submit|save/.test(b))               edges.add('form-submit')
    }

    for (const link of links) {
      const l = link.toLowerCase()
      if (/product|detail|item/.test(l))  edges.add('product-detail')
      else if (/cart|basket/.test(l))     edges.add('cart')
      else if (/home/.test(l))            edges.add('home')
      else if (/dashboard/.test(l))       edges.add('dashboard')
      else if (/profile|account/.test(l)) edges.add('profile')
      else if (/order|history/.test(l))   edges.add('orders')
    }

    graph[pageKey] = [...edges]
  }

  return graph
}

// -------------------------------------------------------------------
// buildNavigationGraph
// Phase 31 — Action-level workflow graph.
// Builds typed nodes+edges from URL transitions AND from executed checks.
// Each node tracks assertion outcomes, retry totals, and duration.
// Each edge carries the action label and pass/fail/error status.
// -------------------------------------------------------------------
function buildNavigationGraph(workflows, executedChecks) {
  const nodes  = new Map()
  const edges  = []

  function getOrCreateNode(url) {
    if (!nodes.has(url)) {
      let label
      try { label = new URL(url).pathname || '/' } catch { label = url.slice(0, 40) }
      nodes.set(url, {
        id:             url,
        label,
        url,
        status:         'visited',
        assertionPassed: 0,
        assertionFailed: 0,
        totalDurationMs: 0,
        totalRetries:    0,
        checkCount:      0,
      })
    }
    return nodes.get(url)
  }

  // Build nodes and edges from URL-transition pairs
  for (const wf of (workflows || [])) {
    getOrCreateNode(wf.from)
    getOrCreateNode(wf.to)
    edges.push({
      from:       wf.from,
      to:         wf.to,
      action:     wf.note || 'navigation',
      status:     'visited',
      durationMs: 0,
      retryCount: 0,
    })
  }

  // Enrich nodes and add action-level edges from executed checks
  for (const check of (executedChecks || [])) {
    const node = nodes.get(check.page) || getOrCreateNode(check.page)
    node.checkCount      += 1
    node.totalDurationMs += (check.durationMs || 0)
    node.totalRetries    += (check.retryCount || 0)

    // Navigation checks create new edges in the graph
    if (check.outcomeCategory === 'navigation' && check.status === 'pass') {
      node.status = 'passed'
    }

    // Assertion enrichment on the source node
    if (check.assertionPassed != null) {
      if (check.assertionPassed) node.assertionPassed++
      else                       node.assertionFailed++
    }

    // Add non-navigation actions as self-loop-style action nodes
    if (check.type === 'representative' && check.outcomeCategory !== 'navigation') {
      edges.push({
        from:       check.page,
        to:         check.page,
        action:     check.target || check.outcomeCategory,
        status:     check.status,
        durationMs: check.durationMs || 0,
        retryCount: check.retryCount || 0,
        category:   check.outcomeCategory,
      })
    }
  }

  // Compute per-node pass/fail status from check outcomes
  for (const node of nodes.values()) {
    const nodeChecks = (executedChecks || []).filter(c => c.page === node.url)
    const passed = nodeChecks.filter(c => c.status === 'pass').length
    const failed = nodeChecks.filter(c => c.status === 'fail' || c.status === 'error').length
    if (passed > 0 && failed === 0) node.status = 'passed'
    else if (failed > 0)            node.status = 'failed'
    node.avgDurationMs = node.checkCount > 0
      ? Math.round(node.totalDurationMs / node.checkCount)
      : 0
  }

  return { nodes: [...nodes.values()], edges }
}

// -------------------------------------------------------------------
// detectCompletedWorkflows
// Evaluates each workflow in the registry against actual execution
// evidence. A workflow is completed ONLY if:
//   1. Execution happened (an action was clicked/submitted/navigated)
//   AND
//   2. Success evidence exists (URL visited, assertion passed, pattern passed)
//
// Returns { registry, completed, missing }
//   registry  — the full expected workflow list for this app type
//   completed — workflows with evidence { id, label, evidence }
//   missing   — workflows not yet completed { id, label }
// -------------------------------------------------------------------
function detectCompletedWorkflows(report) {
  // Resolve app type from AI classification or deterministic fallback
  const appTypeRaw = (report.useCase?.applicationType || report.useCase?.label || '').toLowerCase()

  let registry
  if (/ecommerce|e-commerce|shop|store|retail|cart|product/.test(appTypeRaw)) {
    registry = EXPECTED_WORKFLOWS.ecommerce
  } else if (/crm|customer|lead|sales|contact/.test(appTypeRaw)) {
    registry = EXPECTED_WORKFLOWS.crm
  } else if (/dashboard|analytics|reporting|admin/.test(appTypeRaw)) {
    registry = EXPECTED_WORKFLOWS.dashboard
  } else {
    registry = EXPECTED_WORKFLOWS.generic
  }

  // Collect all URLs the crawler actually visited
  const visitedUrls = new Set()
  for (const w of (report.workflows || [])) {
    if (w.from) visitedUrls.add(w.from.toLowerCase())
    if (w.to)   visitedUrls.add(w.to.toLowerCase())
  }
  for (const n of (report.navigationGraph?.nodes || [])) {
    if (n.url) visitedUrls.add(n.url.toLowerCase())
  }
  const urlVisited = (pattern) => [...visitedUrls].some(u => pattern.test(u))

  // Collect passed assertion types and patterns
  const passedAssertions = report.assertions.filter(a => a.passed)
  const assertMatch  = (pat) => passedAssertions.some(a =>
    pat.test((a.assertionType || a.pattern || '').toLowerCase())
  )

  // Collect passed workflow patterns (phase B representative executions that PASS)
  const passedPatterns = report.workflowPatterns
    .filter(w => w.status === EXECUTION_STATUS.PASS)
    .map(w => (w.pattern || '').toLowerCase())
  const patternMatch = (pat) => passedPatterns.some(p => pat.test(p))

  // Collect passed execution targets
  const passedTargets = report.executedChecks
    .filter(c => c.status === EXECUTION_STATUS.PASS)
    .map(c => (c.target || '').toLowerCase())
  const targetMatch = (pat) => passedTargets.some(t => pat.test(t))

  // Login check: login-type check that succeeded
  const loginSuccess = report.executedChecks.some(
    c => c.type === 'login' && c.status === EXECUTION_STATUS.PASS
  ) || assertMatch(/login|auth|sign.?in/)

  const evidence = {
    visitedUrls, urlVisited,
    assertMatch, patternMatch, targetMatch,
    loginSuccess, report,
  }

  const completed = []
  const missing   = []

  for (const wf of registry) {
    const proof = checkWorkflowEvidence(wf.id, evidence)
    if (proof) {
      completed.push({ id: wf.id, label: wf.label, evidence: proof.lines, summary: proof.summary })
    } else {
      missing.push({ id: wf.id, label: wf.label })
    }
  }

  return { registry, completed, missing }
}

// Returns { summary: string, lines: string[] } if evidence found, null otherwise.
// All cases use single() or multi() helpers for consistency.
function checkWorkflowEvidence(workflowId, ev) {
  const { urlVisited, assertMatch, patternMatch, targetMatch, loginSuccess, report } = ev

  const single = (s) => s ? { summary: s, lines: [s] } : null
  const multi  = (lines) => lines.length > 0 ? { summary: lines[0], lines } : null

  switch (workflowId) {
    case 'login':
      return single(loginSuccess ? 'successful auth navigation detected' : null)

    case 'browse-products':
      if (urlVisited(/inventory|products?|catalog|shop|listing|items/)) return single('catalog/inventory page visited')
      if (patternMatch(/browse|product|catalog|listing/)) return single('product listing pattern passed')
      return null

    case 'view-product-detail':
      if (urlVisited(/inventory[_-]item|product[_/]detail|[?&]id=|\/item\/|\/product\//)) return single('product detail page visited')
      if (patternMatch(/product.detail|item.detail|view.product/)) return single('detail pattern passed')
      return null

    case 'add-to-cart':
      if (assertMatch(/add.to.cart|add.cart|cart.add/) || patternMatch(/add.to.cart|add.cart|add.basket/) || targetMatch(/add.to.cart|add.cart|add.basket/))
        return single('cart increment / add-to-cart action passed')
      return null

    case 'view-cart':
      if (urlVisited(/\/cart|\/basket|\/bag|\/checkout/)) return single('cart page visited')
      if (patternMatch(/view.cart|open.cart|cart.page/)) return single('cart view pattern passed')
      return null

    case 'remove-from-cart':
      if (assertMatch(/remove.from.cart|remove.cart|cart.remove/) || (patternMatch(/remove/) && urlVisited(/cart|basket/)) || targetMatch(/remove.from.cart|remove.item|btn_remove/))
        return single('remove-from-cart action passed')
      return null

    case 'checkout':
      if (urlVisited(/checkout|payment|place.?order|order.confirm|purchase/)) return single('checkout page reached')
      if (assertMatch(/checkout|place.order/)) return single('checkout assertion passed')
      return null

    case 'logout':
      if (assertMatch(/logout|sign.out|log.out/) || patternMatch(/logout|sign.?out/) || targetMatch(/logout|sign.?out|btn.?logout/))
        return single('logout action executed successfully')
      return null

    // CRM / Dashboard workflows
    case 'view-records':
      return single(urlVisited(/records?|list|table|data|entries/) ? 'records page visited' : null)

    case 'create-record':
      return single(patternMatch(/create|new|add.record|submit/) || assertMatch(/create|add.record/) ? 'record creation passed' : null)

    case 'edit-record':
      return single(patternMatch(/edit|update|modify/) || assertMatch(/edit|update/) ? 'record edit passed' : null)

    case 'filter-search':
      return single(patternMatch(/filter|search|sort/) || assertMatch(/filter|search/) ? 'filter/search action passed' : null)

    case 'view-dashboard':
      return single(urlVisited(/dashboard|home|overview|summary/) ? 'dashboard page visited' : null)

    case 'navigate-sections':
      return single((ev.report.workflows || []).length >= 2 ? 'multi-page navigation confirmed' : null)

    case 'filter-data':
      return single(patternMatch(/filter|sort|search/) ? 'filter action passed' : null)

    // Generic
    case 'navigate':
      return single((report.workflows || []).length >= 1 ? 'page navigation detected' : null)

    case 'interact':
      return single(report.executedChecks.some(c => c.status === EXECUTION_STATUS.PASS) ? 'UI interaction passed' : null)

    case 'form-submit': {
      const lines = []

      // A successful login IS a form submission — authentication forms count
      if (loginSuccess) {
        const lc = report.executedChecks.find(c => c.type === 'login' && c.status === EXECUTION_STATUS.PASS)
        if (lc) {
          lines.push(`LOGIN ${lc.status} ${lc.outcome || 'login form submitted successfully'}`)
          lines.push(`EXECUTION status=${lc.status} target=${lc.target || 'login form'} category=${lc.outcomeCategory || 'navigation'}`)
        } else {
          lines.push('LOGIN pass login form submitted successfully')
        }
      }

      // Workflow-pattern or assertion evidence for non-login form submits
      if (patternMatch(/submit|save|send/)) lines.push('form submission pattern passed')
      if (assertMatch(/form.submit|submit/))  lines.push('form submission assertion passed')

      // Any other passing executedCheck that looks like a form submit
      const otherFormChecks = report.executedChecks.filter(c =>
        c.status === EXECUTION_STATUS.PASS &&
        c.type !== 'login' &&
        /form|submit|save/.test((c.type || c.target || '').toLowerCase())
      )
      for (const fc of otherFormChecks) {
        lines.push(`EXECUTION status=${fc.status} target=${fc.target} category=${fc.outcomeCategory}`)
      }

      return multi(lines)
    }

    default:
      return null
  }
}

// -------------------------------------------------------------------
// computeExecutionQualityScore
// Phase 17 — Produces a 0-100 score and quality category from session
// metrics + assertion results. Each factor contributes a weighted portion.
// -------------------------------------------------------------------
function computeExecutionQualityScore(summary, assertions) {
  const {
    executedTests    = 0,
    passedTests      = 0,
    errorTests       = 0,
    workflowCoverage = 0,
  } = summary

  if (executedTests === 0) {
    return { score: 0, category: 'Weak', factors: [] }
  }

  const factors = []
  let score = 0

  // Factor 1: Assertion pass rate — 35 pts (was 30)
  if (assertions.length > 0) {
    const passed = assertions.filter(a => a.passed).length
    const pct    = Math.round((passed / assertions.length) * 100)
    const pts    = Math.round((passed / assertions.length) * 35)
    score += pts
    factors.push({ name: 'Assertion Pass Rate', score: pts, max: 35, pct, weight: 0.35 })
  } else {
    score += 18
    factors.push({ name: 'Assertion Pass Rate', score: 18, max: 35, pct: null, weight: 0.35 })
  }

  // Factor 2: Workflow coverage — 30 pts (was 25)
  const covPts = Math.round((workflowCoverage / 100) * 30)
  score += covPts
  factors.push({ name: 'Workflow Coverage', score: covPts, max: 30, pct: workflowCoverage, weight: 0.30 })

  // Factor 3: Execution stability (pass rate) — 20 pts
  // Stateful noChange results (toggle open/close cycles) are deterministic
  // correct behaviour — they are added back to avoid penalising stability.
  const adjustedPassed = passedTests + (summary.statefulNoChangeAdjust || 0)
  const passRate  = adjustedPassed / executedTests
  const passPts   = Math.round(passRate * 20)
  score += passPts
  factors.push({ name: 'Execution Stability', score: passPts, max: 20, pct: Math.round(passRate * 100), weight: 0.20 })

  // Factor 4: Retry penalty — 10 pts (low retry count = good)
  const avgRetries = (summary.avgRetryCount || 0)
  const retryPts   = Math.round(Math.max(0, 1 - avgRetries / 3) * 10)
  score += retryPts
  factors.push({ name: 'Low Retry Rate', score: retryPts, max: 10, pct: Math.round(Math.max(0, 1 - avgRetries / 3) * 100), weight: 0.10 })

  // Factor 5: Error penalty — 5 pts
  const errRate = errorTests / executedTests
  const errPts  = Math.round((1 - Math.min(errRate * 2, 1)) * 5)
  score += errPts
  factors.push({ name: 'Low Error Rate', score: errPts, max: 5, pct: Math.round((1 - errRate) * 100), weight: 0.05 })

  const category = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Moderate' : 'Weak'

  return { score, category, factors }
}

// -------------------------------------------------------------------
// createAgentMemory
// Phase 15 — Per-session memory that prevents the agent from repeating
// useless interactions and accumulates assertion results.
// -------------------------------------------------------------------
function createAgentMemory() {
  return {
    visitedStates:   new Set(),
    executedActions: new Set(),
    failedSelectors: new Set(),
    noChangeActions: new Set(),
    workflowHistory: [],
    assertions:      [],
    retryMetrics:    {},   // elementId → { attempts, recovered }
    flakyActions:    [],   // { elementId, reason, retryCount, inconsistentOutcomes }
  }
}

// -------------------------------------------------------------------
// generateStateFingerprint
// Phase 28 — Richer state deduplication key.
// Combines URL + DOM structural hash + visible action set + cart/modal signals.
// Returns a string; falls back to getStateKey() on any error.
// -------------------------------------------------------------------
async function generateStateFingerprint(page, pageState) {
  try {
    const structural = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1, h2')]
        .map(h => h.textContent.trim().slice(0, 40))
        .join('|')

      const actions = [...document.querySelectorAll('button, [role="button"], a[href]')]
        .filter(el => {
          const s = window.getComputedStyle(el)
          return s.display !== 'none' && s.visibility !== 'hidden'
        })
        .map(el => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 25))
        .filter(Boolean)
        .slice(0, 30)
        .sort()
        .join('|')

      const cartNums = [...document.querySelectorAll('[class*="cart"],[class*="badge"],[class*="count"]')]
        .map(el => (el.textContent || '').trim())
        .filter(t => /^\d+$/.test(t))
        .join(',')

      return `h:${headings}||a:${actions.slice(0, 200)}||c:${cartNums}`
    })

    const urlPart = (() => {
      try {
        const u = new URL(pageState.url)
        return u.pathname + (u.hash || '')
      } catch { return pageState.url.slice(0, 80) }
    })()

    return [
      urlPart,
      `dlg:${pageState.openDialogs}`,
      `sidebar:${pageState.sidebarOpen}`,
      structural.slice(0, 400),
    ].join('::')
  } catch {
    return getStateKey(pageState)
  }
}

// -------------------------------------------------------------------
// planWorkflowExecution
// Phases 23/24 — Goal-Driven Workflow Planner.
// Given a workflow graph and the detected component map, returns an
// ordered execution plan that prioritizes business-critical paths.
// Each step carries: goal, expectedOutcome, priority, assertionHint.
// -------------------------------------------------------------------
function planWorkflowExecution(workflowGraph, components) {
  const plan = []
  const seen = new Set()

  // Business-critical workflow chains — ordered by priority
  const CRITICAL_CHAINS = [
    { goal: 'login',            expectedOutcome: 'navigation to authenticated area',   priority: 1, assertionHint: 'login'         },
    { goal: 'add-to-cart',      expectedOutcome: 'cart badge increments',              priority: 2, assertionHint: 'add-to-cart'   },
    { goal: 'checkout',         expectedOutcome: 'navigate to checkout/payment',       priority: 3, assertionHint: 'checkout'      },
    { goal: 'remove-from-cart', expectedOutcome: 'cart badge decrements',              priority: 4, assertionHint: 'remove-from-cart' },
    { goal: 'logout',           expectedOutcome: 'redirect to login page',             priority: 5, assertionHint: 'logout'        },
    { goal: 'filter',           expectedOutcome: 'product list or content changes',    priority: 6, assertionHint: 'sort-filter'   },
    { goal: 'form-submit',      expectedOutcome: 'navigation or validation feedback',  priority: 7, assertionHint: 'form-submit'   },
    { goal: 'search',           expectedOutcome: 'result list updates',                priority: 8, assertionHint: 'sort-filter'   },
  ]

  // Map workflow graph edges to executable steps
  const allEdges = new Set(Object.values(workflowGraph).flat())

  for (const chain of CRITICAL_CHAINS) {
    if (allEdges.has(chain.goal) || Object.keys(workflowGraph).includes(chain.goal)) {
      if (!seen.has(chain.goal)) {
        seen.add(chain.goal)
        plan.push({ ...chain, source: 'graph' })
      }
    }
  }

  // Add any graph edges not already in the plan
  for (const [page, edges] of Object.entries(workflowGraph)) {
    for (const edge of edges) {
      if (!seen.has(edge)) {
        seen.add(edge)
        plan.push({
          goal:             edge,
          expectedOutcome:  `action "${edge}" produces state change`,
          priority:         plan.length + 10,
          assertionHint:    edge,
          source:           page,
        })
      }
    }
  }

  return plan.sort((a, b) => a.priority - b.priority)
}

// -------------------------------------------------------------------
// detectFlakyActions
// Phase 32 — Post-crawl flaky interaction analysis.
//
// Distinguishes two categories:
//
//   stability='stateful'
//     Element is a toggle/menu/accordion whose natural behavior produces
//     pass (first click, element was closed) then noChange (repeat click,
//     already open). Outcomes are ONLY {pass, noChange} — never fail/error.
//     This is deterministic state-machine behavior, NOT flakiness.
//     These are returned in the same array but MUST be split by the caller:
//       report.flakyActions    = results.filter(f => f.stability !== 'stateful')
//       report.statefulActions = results.filter(f => f.stability === 'stateful')
//
//   stability='unstable'|'flaky'|'critical-flaky'
//     Same action produces genuinely inconsistent outcomes under the same
//     page conditions (fail+pass, error+pass, high-retry).
//
// Returns combined list sorted by retryCount descending.
// -------------------------------------------------------------------
function detectFlakyActions(executedChecks) {
  const byTarget = {}
  for (const check of executedChecks) {
    if (!check.target) continue
    if (!byTarget[check.target]) byTarget[check.target] = []
    byTarget[check.target].push(check)
  }

  const results = []

  for (const [target, checks] of Object.entries(byTarget)) {
    if (checks.length < 2) continue  // single occurrence cannot be flaky or stateful

    const maxRetry        = Math.max(...checks.map(c => c.retryCount || 0))
    const outcomeStatuses = checks.map(c => c.status)
    const outcomeSet      = new Set(outcomeStatuses)
    const passCount       = checks.filter(c => c.status === EXECUTION_STATUS.PASS).length
    const noChangeCount   = checks.filter(c => c.status === EXECUTION_STATUS.NO_CHANGE).length
    const failCount       = checks.filter(c => c.status === EXECUTION_STATUS.FAIL).length
    const errorCount      = checks.filter(c => c.status === EXECUTION_STATUS.ERROR).length

    // ---- Stateful toggle detection ----
    // Criterion: outcomes are ONLY {pass, noChange} (no fail, no error)
    //            AND the target name or page context looks like a toggle element.
    if (outcomeSet.size > 1 && failCount === 0 && errorCount === 0) {
      const hasOnlyPassAndNoChange =
        [...outcomeSet].every(o => o === EXECUTION_STATUS.PASS || o === EXECUTION_STATUS.NO_CHANGE)

      if (hasOnlyPassAndNoChange && STATEFUL_TARGET_PATTERN.test(target)) {
        results.push({
          target,
          stability:        'stateful',
          reasons:          ['toggle-state-change: open/closed cycle produces expected pass then noChange'],
          retryCount:       maxRetry,
          occurrences:      checks.length,
          passOccurrences:  passCount,
          noChangeOccurrences: noChangeCount,
          pages:            [...new Set(checks.map(c => c.page))],
          stateTransitions: checks.map(c => ({
            action:   target,
            result:   c.status,
            category: c.outcomeCategory || c.outcome || '',
          })),
        })
        continue
      }
    }

    // ---- Genuine flakiness detection ----
    const reasons = []
    if (maxRetry >= 2) reasons.push(`high-retry (max=${maxRetry})`)
    if (outcomeSet.size > 1) reasons.push(`inconsistent-outcomes (${[...outcomeSet].join(',')})`)
    if (errorCount > 0 && checks.length > 1) reasons.push(`intermittent-error (${errorCount}/${checks.length})`)

    if (reasons.length > 0) {
      const stability = reasons.length >= 2 ? 'critical-flaky' : maxRetry >= 2 ? 'flaky' : 'unstable'
      results.push({
        target,
        stability,
        reasons,
        retryCount:   maxRetry,
        occurrences:  checks.length,
        passOccurrences:  passCount,
        noChangeOccurrences: noChangeCount,
        pages:        [...new Set(checks.map(c => c.page))],
      })
    }
  }

  return results.sort((a, b) => b.retryCount - a.retryCount)
}

// -------------------------------------------------------------------
// updateExecutionMetrics — centralized execution accounting
//
// Single source of truth for all execution statistics.
// Accepts the full executedChecks array (all actions that actually ran)
// and the skipped count (actions that were intentionally not run).
//
// Returns a consistent metric snapshot where:
//   executedTests === passedTests + failedTests + noChangeTests + errorTests
//
// Every phase that pushes a clickCheck to report.executedChecks is
// automatically included — no manual counter increments needed.
// -------------------------------------------------------------------
function updateExecutionMetrics(executedChecks, skippedCount = 0) {
  const passed   = executedChecks.filter(c => c.status === EXECUTION_STATUS.PASS).length
  const failed   = executedChecks.filter(c => c.status === EXECUTION_STATUS.FAIL).length
  const noChange = executedChecks.filter(c => c.status === EXECUTION_STATUS.NO_CHANGE).length
  const error    = executedChecks.filter(c => c.status === EXECUTION_STATUS.ERROR).length
  const executed = passed + failed + noChange + error

  return {
    executedTests:  executed,
    passedTests:    passed,
    failedTests:    failed,
    noChangeTests:  noChange,
    errorTests:     error,
    skippedTests:   skippedCount,
    invariantValid: true,   // always holds: executed = pass+fail+noChange+error by construction
  }
}

// -------------------------------------------------------------------
// clickWithRetry
// Reliable click wrapper: scroll into view → wait for visible → click.
// On failure retries up to MAX_CLICK_RETRIES times with exponential backoff,
// then falls back to page.mouse.click() at the element's bounding-box centre.
// Returns { retryCount, recovered } — callers attach these to the trace record.
// -------------------------------------------------------------------
const MAX_CLICK_RETRIES = 2

async function clickWithRetry(handle, page, elementId, log, depth) {
  let lastError = null

  for (let attempt = 0; attempt <= MAX_CLICK_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        log.retry(depth, `attempt ${attempt}/${MAX_CLICK_RETRIES}  target=${elementId}`)
        await page.waitForTimeout(300 * attempt)
      }
      // Ensure element is scrolled into view and visible before clicking
      await handle.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {})
      await handle.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {})
      await handle.click({ timeout: 3000 })
      return { retryCount: attempt, recovered: false }
    } catch (err) {
      lastError = err
      // Coordinate fallback: bypass Playwright's element targeting entirely
      if (attempt < MAX_CLICK_RETRIES) {
        try {
          const box = await handle.boundingBox()
          if (box) {
            const cx = Math.round(box.x + box.width  / 2)
            const cy = Math.round(box.y + box.height / 2)
            log.recover(depth,
              `mouse.click fallback  target=${elementId}  pos=(${cx},${cy})`
            )
            await page.mouse.click(cx, cy)
            return { retryCount: attempt, recovered: true }
          }
        } catch {}
      }
    }
  }

  throw lastError
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
  beforeUIState,   // fine-grained UI snapshot captured before the click
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
      // Coarse structural change detected (navigation, modal, DOM count, etc.)
      clickCheck.status = EXECUTION_STATUS.PASS
      log.pass(depth, `[${outcome.category}]  ${outcome.description}`)
    } else {
      // Coarse state unchanged — run fine-grained diff to catch dynamic updates:
      // button text swaps, badge increments, ARIA/class flips, toasts, etc.
      const afterUIState = await captureUIState(page)
      const uiDiff       = diffUIState(beforeUIState, afterUIState, log, depth)

      if (uiDiff.changed) {
        clickCheck.status          = EXECUTION_STATUS.PASS
        clickCheck.outcomeCategory = uiDiff.category
        clickCheck.outcome         = uiDiff.description
        log.pass(depth, `[${uiDiff.category}]  ${uiDiff.description}`)
      } else {
        clickCheck.status = EXECUTION_STATUS.NO_CHANGE
        log.nochange(depth, `${clickCheck.target}  no visible state change detected`)
      }
    }

  } catch (err) {
    const message = (err.message || 'interaction failed').split('\n')[0].slice(0, 120)
    clickCheck.status          = EXECUTION_STATUS.ERROR
    clickCheck.outcomeCategory = 'error'
    clickCheck.outcome         = message
    log.fail(depth, `${clickCheck.target}  ${message}`)
  }

  // Recurse if the interaction produced a meaningful state change
  if (clickCheck.status === EXECUTION_STATUS.PASS) {
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
      pages:                  0,
      detectedTests:          0,
      executedTests:          0,
      passedTests:            0,
      failedTests:            0,
      noChangeTests:          0,
      skippedTests:           0,
      errorTests:             0,
      successfulTests:        0,
      nonBlockingTests:       0,
      workflowPatterns:       0,
      workflowCoverage:       0,
      crawlInteractions:      0,
      executionAccuracy:      0,
      detectedWorkflowCount:  0,
      executedWorkflowCount:  0,
      executionQualityScore:  0,
      qualityCategory:        'Weak',
      assertionCount:         0,
      assertionPassCount:     0,
      completedWorkflowCount: 0,
      expectedWorkflowCount:  0,
      flakyActionCount:       0,
      statefulActionCount:    0,
      avgRetryCount:          0,
      sessions:               sessionReports.length,
    },
    detectedTestCases:  [],
    executedChecks:     [],
    workflowPatterns:   [],
    crawlLog:           sharedCrawlLog,
    components:         {},
    workflows:          [],
    performance:        {},
    screenshots:        [],
    recommendations:    [],
    useCase:            null,
    assertions:         [],
    missingWorkflows:   [],
    expectedWorkflows:  [],
    completedWorkflows: [],
    workflowGraph:      {},
    navigationGraph:    { nodes: [], edges: [] },
    flakyActions:       [],
    statefulActions:    [],
    executionPlan:      [],
    qualityFactors:     [],

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
      detectedTests:  (r.detectedTestCases || []).length,
      executedTests:  r.summary?.executedTests ?? 0,
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

    merged.summary.pages                 += sub.summary.pages
    merged.summary.detectedTests         += sub.summary.detectedTests
    merged.summary.passedTests           += sub.summary.passedTests
    merged.summary.failedTests           += sub.summary.failedTests
    merged.summary.noChangeTests         += sub.summary.noChangeTests         ?? 0
    merged.summary.skippedTests          += sub.summary.skippedTests
    merged.summary.errorTests            += sub.summary.errorTests             ?? 0
    merged.summary.workflowPatterns      += sub.summary.workflowPatterns
    merged.summary.crawlInteractions     += sub.summary.crawlInteractions
    merged.summary.detectedWorkflowCount += sub.summary.detectedWorkflowCount ?? 0
    merged.summary.executedWorkflowCount += sub.summary.executedWorkflowCount ?? 0
    merged.summary.assertionCount        += sub.summary.assertionCount         ?? 0
    merged.summary.assertionPassCount    += sub.summary.assertionPassCount     ?? 0
    merged.summary.completedWorkflowCount += sub.summary.completedWorkflowCount ?? 0
    merged.summary.flakyActionCount      += sub.summary.flakyActionCount       ?? 0
    merged.summary.statefulActionCount   += sub.summary.statefulActionCount    ?? 0

    // Merge arrays
    if (sub.assertions)       merged.assertions.push(...sub.assertions)
    if (sub.missingWorkflows) merged.missingWorkflows.push(...sub.missingWorkflows)
    if (sub.workflowGraph)    Object.assign(merged.workflowGraph, sub.workflowGraph)
    if (sub.navigationGraph?.nodes) {
      merged.navigationGraph.nodes.push(...sub.navigationGraph.nodes)
      merged.navigationGraph.edges.push(...sub.navigationGraph.edges)
    }
    if (sub.flakyActions)       merged.flakyActions.push(...sub.flakyActions)
    if (sub.statefulActions)    merged.statefulActions.push(...sub.statefulActions)
    if (sub.executionPlan)     merged.executionPlan.push(...sub.executionPlan)
    if (sub.qualityFactors)    merged.qualityFactors.push(...sub.qualityFactors)
    if (sub.completedWorkflows) merged.completedWorkflows.push(...sub.completedWorkflows)
    // expectedWorkflows is registry-based — use the last session's list (same for same app type)
    if (sub.expectedWorkflows?.length) merged.expectedWorkflows = sub.expectedWorkflows
  }

  // Deduplicate recommendations
  merged.recommendations = [...new Set(merged.recommendations)]

  // Recompute merged execution totals using centralized accounting.
  // Derive from merged.executedChecks (the authoritative full list) rather
  // than summing per-session summaries, which avoids double-counting.
  const mergedSkipped  = merged.summary.skippedTests  // already summed from sessions
  const mergedExecMet  = updateExecutionMetrics(merged.executedChecks, mergedSkipped)
  merged.summary.executedTests  = mergedExecMet.executedTests
  merged.summary.passedTests    = mergedExecMet.passedTests
  merged.summary.failedTests    = mergedExecMet.failedTests
  merged.summary.noChangeTests  = mergedExecMet.noChangeTests
  merged.summary.errorTests     = mergedExecMet.errorTests
  merged.summary.successfulTests  = mergedExecMet.passedTests
  merged.summary.nonBlockingTests = mergedExecMet.noChangeTests

  // Recompute flaky detection and avgRetryCount from merged execution data
  const mergedFlakyAll           = detectFlakyActions(merged.executedChecks)
  merged.flakyActions            = mergedFlakyAll.filter(f => f.stability !== 'stateful')
  merged.statefulActions         = mergedFlakyAll.filter(f => f.stability === 'stateful')
  merged.summary.flakyActionCount    = merged.flakyActions.length
  merged.summary.statefulActionCount = merged.statefulActions.length
  merged.summary.avgRetryCount = merged.executedChecks.length > 0
    ? Math.round((merged.executedChecks.reduce((s, c) => s + (c.retryCount || 0), 0) / merged.executedChecks.length) * 100) / 100
    : 0

  merged.summary.executionAccuracy = merged.summary.executedTests > 0
    ? Math.round((merged.summary.passedTests / merged.summary.executedTests) * 100)
    : 0

  // Deduplicate missing workflows across sessions
  merged.missingWorkflows = [...new Set(merged.missingWorkflows)]

  // Recompute business workflow coverage from merged completed/expected lists
  const mergedCompleted = merged.completedWorkflows
  const mergedExpected  = merged.expectedWorkflows
  merged.summary.completedWorkflowCount = mergedCompleted.length
  merged.summary.expectedWorkflowCount  = mergedExpected.length
  merged.summary.workflowCoverage = mergedExpected.length > 0
    ? Math.round((mergedCompleted.length / mergedExpected.length) * 100)
    : 0

  // Quality score MUST be computed AFTER workflowCoverage is set
  const mergedQuality = computeExecutionQualityScore(merged.summary, merged.assertions)
  merged.summary.executionQualityScore = mergedQuality.score
  merged.summary.qualityCategory       = mergedQuality.category
  merged.qualityFactors                = mergedQuality.factors || []

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
      pages:                  0,
      detectedTests:          0,
      executedTests:          0,
      passedTests:            0,
      failedTests:            0,
      noChangeTests:          0,
      skippedTests:           0,
      errorTests:             0,
      workflowPatterns:       0,
      crawlInteractions:      0,
      executionAccuracy:      0,
      detectedWorkflowCount:  0,
      executedWorkflowCount:  0,
      executionQualityScore:  0,
      qualityCategory:        'Weak',
    },
    detectedTestCases: [],
    executedChecks:    [],
    workflowPatterns:  [],
    crawlLog:          [],
    components:        {},
    workflows:         [],
    performance:       {},
    screenshots:       [],
    recommendations:   [],
    useCase:           null,
    assertions:         [],
    missingWorkflows:   [],
    expectedWorkflows:  [],
    completedWorkflows: [],
    workflowGraph:      {},
    navigationGraph:    { nodes: [], edges: [] },
    flakyActions:       [],
    statefulActions:    [],
    executionPlan:      [],
    qualityFactors:     [],
  }

  const log = createLogger(sharedCrawlLog)
  log.ctx(0, `[CTX] context created  session="${sessionName}"  role="${role}"`)
  log.wflow(0, `[WFLOW] session="${sessionName}"  role="${role}"  url=${startUrl}`)
  log.scope(0, `boundary  origin=${baseOrigin}  mode=${SCOPE_MODE}`)

  const visited             = new Set()
  const interacted          = new Set()
  const exploredUrlPatterns = new Set()

  // Execution accounting — only Phase B (representative) and login are test runs.
  // Phase C general clicks are crawler interactions and must not inflate executedTests.
  const tracker = { testRuns: [], crawlActions: 0 }

  // Phase 15 — session memory to prevent repeated useless interactions
  const agentMemory = createAgentMemory()

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
        status: EXECUTION_STATUS.ERROR, outcomeCategory: 'error', outcome: '',
        isRepresentative: false, isTestRun: true, patternOccurrences: null,
        timestamp: new Date().toISOString()
      }
      try {
        await currentPage.locator('input[type=text], input[type=email]').first().fill(username)
        await currentPage.locator('input[type=password]').fill(password)
        await currentPage.locator('button, input[type=submit]').first().click()
        await currentPage.waitForTimeout(3000)
        loginCheck.status          = EXECUTION_STATUS.PASS
        loginCheck.outcomeCategory = 'navigation'
        loginCheck.outcome         = 'login form submitted successfully'
      } catch (err) {
        loginCheck.outcome = (err.message || 'login interaction failed').split('\n')[0].slice(0, 120)
      }
      tracker.testRuns.push({
        status:   loginCheck.status === EXECUTION_STATUS.PASS ? EXECUTION_STATUS.PASS : EXECUTION_STATUS.ERROR,
        pattern:  'login',
        page:     currentUrl,
        outcome:  loginCheck.outcome,
        category: loginCheck.outcomeCategory,
        target:   'login form',
      })
      report.executedChecks.push(loginCheck)
      log.login(depth, `${loginCheck.status}  ${loginCheck.outcome}`)
      log.execution(depth,
        `status=${loginCheck.status}  target=login form  category=${loginCheck.outcomeCategory}`
      )
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

    // Phase 13 — sort patterns by business priority score (highest first)
    repeatedRowActions.sort((a, b) => scoreAction(b.label) - scoreAction(a.label))

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
        tracker.testRuns.push({ status: EXECUTION_STATUS.SKIPPED, reason: 'cap-reached', pattern: pattern.label, page: currentUrl })
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
        tracker.testRuns.push({ status: EXECUTION_STATUS.SKIPPED, reason: 'element-not-found', pattern: pattern.label, page: currentUrl })
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

      const beforeState   = await capturePageState(currentPage)
      const beforeUIState = await captureUIState(currentPage)
      const actionStart   = Date.now()
      const clickCheck  = {
        id:                 `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type:               'representative',
        page:               currentUrl,
        target:             elementId,
        status:             EXECUTION_STATUS.NO_CHANGE,
        outcomeCategory:    'no-change',
        outcome:            'no state change detected',
        isRepresentative:   true,
        isTestRun:          true,
        patternOccurrences: pattern.occurrences,
        retryCount:         0,
        durationMs:         0,
        timestamp:          new Date().toISOString()
      }

      try {
        const clickResult = await clickWithRetry(handle, currentPage, elementId, log, depth)
        clickCheck.retryCount = clickResult.retryCount
      } catch (err) {
        // All retry attempts exhausted — technical error
        const message = (err.message || 'click failed').split('\n')[0].slice(0, 120)
        clickCheck.status          = EXECUTION_STATUS.ERROR
        clickCheck.outcomeCategory = 'error'
        clickCheck.outcome         = message
        clickCheck.durationMs      = Date.now() - actionStart
        log.fail(depth, `${elementId}  ${message}`)
        log.execution(depth, `status=error  target=${elementId}  category=error  retries=${clickCheck.retryCount}`)

        tracker.testRuns.push({ status: EXECUTION_STATUS.ERROR, reason: 'click-error', pattern: pattern.label, page: currentUrl, outcome: message })
        report.workflowPatterns.push({
          pattern: pattern.label, occurrences: pattern.occurrences,
          page: currentUrl, representativeId: elementId,
          outcomeCategory: 'error', outcome: message,
          status: EXECUTION_STATUS.ERROR, timestamp: new Date().toISOString()
        })
        report.executedChecks.push(clickCheck)
        continue
      }

      // Click succeeded — observe outcome with both coarse and fine-grained diff
      await handleClickOutcome(
        currentPage, beforeState, beforeUIState, clickCheck, depth, currentUrl,
        log, report, exploredUrlPatterns, explore, baseOrigin
      )
      clickCheck.durationMs = Date.now() - actionStart

      // Record test run outcome in tracker (Phase B = intentional test execution).
      // noChange is a valid terminal state — not a skip.
      // error (technical failure in handleClickOutcome) is separate from fail.
      {
        const runStatus = clickCheck.status === EXECUTION_STATUS.PASS     ? EXECUTION_STATUS.PASS
          : clickCheck.status === EXECUTION_STATUS.ERROR    ? EXECUTION_STATUS.ERROR
          : clickCheck.status === EXECUTION_STATUS.FAIL     ? EXECUTION_STATUS.FAIL
          : EXECUTION_STATUS.NO_CHANGE
        tracker.testRuns.push({
          status:   runStatus,
          pattern:  pattern.label,
          page:     currentUrl,
          outcome:  clickCheck.outcome,
          category: clickCheck.outcomeCategory,
          target:   elementId,
        })
        log.execution(depth,
          `status=${runStatus}  target=${elementId}  category=${clickCheck.outcomeCategory}`
        )

        // Phase 12 — business assertion engine
        if (clickCheck.status === EXECUTION_STATUS.PASS || clickCheck.status === EXECUTION_STATUS.NO_CHANGE) {
          const afterStateForAssert = await capturePageState(currentPage).catch(() => beforeState)
          const afterUIForAssert    = await captureUIState(currentPage).catch(() => beforeUIState)
          const assertion = validateBusinessOutcome(
            pattern.label, beforeState, afterStateForAssert, beforeUIState, afterUIForAssert
          )
          if (assertion) {
            assertion.target    = elementId
            assertion.pattern   = pattern.label
            assertion.page      = currentUrl
            assertion.timestamp = new Date().toISOString()
            report.assertions.push(assertion)
            agentMemory.assertions.push(assertion)
            if (assertion.passed) {
              log.assert_(depth, `PASS  [${assertion.severity}]  ${assertion.assertion}: ${assertion.actual}`)
            } else {
              log.assert_(depth, `FAIL  [${assertion.severity}]  ${assertion.assertion}: expected="${assertion.expected}"  actual="${assertion.actual}"`)
            }
          }
        }

        // Phase 15 — track noChange in memory to avoid future re-runs
        if (clickCheck.status === EXECUTION_STATUS.NO_CHANGE) {
          agentMemory.noChangeActions.add(elementId)
          log.memory(depth, `noChange recorded  target=${elementId}`)
        }
        // Track workflow execution history in memory
        agentMemory.workflowHistory.push({ pattern: pattern.label, status: runStatus, timestamp: new Date().toISOString() })
      }

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

        // Phase 15 — skip elements that already produced noChange in this session
        if (agentMemory.noChangeActions.has(elementId)) {
          log.memory(depth, `skip  reason=repeated-noChange  target=${elementId}`)
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
        tracker.crawlActions++  // Phase C: crawler interaction, not a test execution
      } catch {
        continue  // stale handle
      }

      // Execution phase — plain click, not a representative
      const beforeState   = await capturePageState(currentPage)
      const beforeUIState = await captureUIState(currentPage)
      const actionStart   = Date.now()
      const clickCheck  = {
        id:                 `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        type:               'click',
        page:               currentUrl,
        target:             elementId,
        status:             EXECUTION_STATUS.NO_CHANGE,
        outcomeCategory:    'no-change',
        outcome:            'no state change detected',
        isRepresentative:   false,
        isTestRun:          false,
        patternOccurrences: null,
        retryCount:         0,
        durationMs:         0,
        timestamp:          new Date().toISOString()
      }

      log.click(depth, elementId)

      try {
        const clickResult = await clickWithRetry(item, currentPage, elementId, log, depth)
        clickCheck.retryCount = clickResult.retryCount
      } catch (err) {
        const message = (err.message || 'click failed').split('\n')[0].slice(0, 120)
        clickCheck.status          = EXECUTION_STATUS.ERROR
        clickCheck.outcomeCategory = 'error'
        clickCheck.outcome         = message
        clickCheck.durationMs      = Date.now() - actionStart
        log.fail(depth, `${elementId}  ${message}`)
        report.executedChecks.push(clickCheck)
        continue
      }

      await handleClickOutcome(
        currentPage, beforeState, beforeUIState, clickCheck, depth, currentUrl,
        log, report, exploredUrlPatterns, explore, baseOrigin
      )
      clickCheck.durationMs = Date.now() - actionStart
      report.executedChecks.push(clickCheck)
    }

    // ================================================================
    // PHASE D — Dropdown / <select> exploration
    //
    // For every visible <select> on the page, pick up to 2 non-default
    // options and trigger a change event. Detects filtering, sorting, and
    // pagination side effects that bare clicks cannot reach.
    // Counts as crawlActions (not test runs) — no tracker.testRuns push.
    // ================================================================
    if (depth === 0) {   // only at top-level to avoid noisy recursion
      const selectHandles = await currentPage.locator('select').elementHandles()
      for (const sel of selectHandles.slice(0, 4)) {
        try {
          if (!await sel.isVisible()) continue

          const opts = await sel.evaluate(el =>
            [...el.options].map(o => ({ value: o.value, text: o.text.trim() }))
          )
          // Need at least 2 options to exercise a meaningful change
          if (opts.length < 2) continue

          const selId = await getElementIdentifier(sel)
          log.explore_(depth, `dropdown  target=${selId}  options=${opts.length}`)

          for (const opt of opts.slice(1, 3)) {   // exercise up to 2 non-default options
            try {
              const bsD   = await capturePageState(currentPage)
              const bsUI  = await captureUIState(currentPage)

              await sel.evaluate((el, v) => {
                el.value = v
                el.dispatchEvent(new Event('change', { bubbles: true }))
                el.dispatchEvent(new Event('input',  { bubbles: true }))
              }, opt.value)

              await waitForStability(currentPage)
              tracker.crawlActions++

              const asD  = await capturePageState(currentPage)
              const asUI = await captureUIState(currentPage)
              const coarse = classifyOutcome(bsD, asD)
              const fine   = diffUIState(bsUI, asUI, log, depth)

              if (coarse.category !== 'no-change' || fine.changed) {
                const cat  = coarse.category !== 'no-change' ? coarse.category : fine.category
                const desc = coarse.category !== 'no-change' ? coarse.description : fine.description
                log.pass(depth, `[${cat}]  dropdown option "${opt.text}" → ${desc}`)
                report.detectedTestCases.push({
                  component: 'Dropdown', page: currentUrl, status: 'detected',
                  tests: [`Verify option "${opt.text}" triggers expected ${cat} change`]
                })
              } else {
                log.nochange(depth, `dropdown option "${opt.text}"  no state change`)
              }
            } catch { /* stale handle mid-option — skip this option */ }
          }
        } catch { /* stale select handle — skip this dropdown */ }
      }
    }

    // ================================================================
    // PHASE E — Form empty-submit exploration
    //
    // For each <form> on the page, attempt a submit without filling in
    // any fields. Detects validation feedback (required-field errors,
    // inline messages) that only appear on interaction.
    // Counts as crawlActions; if validation appears it's logged as PASS.
    // ================================================================
    if (depth === 0) {
      const formHandles = await currentPage.locator('form').elementHandles()
      for (const form of formHandles.slice(0, 3)) {
        try {
          if (!await form.isVisible()) continue

          const submitBtn = await form.$(
            'button[type="submit"], input[type="submit"], button:not([type="button"]):not([type="reset"])'
          )
          if (!submitBtn) continue

          const formId = await getElementIdentifier(form)
          log.explore_(depth, `form empty-submit  form=${formId}`)

          const bsD  = await capturePageState(currentPage)
          const bsUI = await captureUIState(currentPage)

          await submitBtn.click({ timeout: 2000 }).catch(() => {})
          await waitForStability(currentPage)
          tracker.crawlActions++

          const asD  = await capturePageState(currentPage)
          const asUI = await captureUIState(currentPage)
          const coarse = classifyOutcome(bsD, asD)
          const fine   = diffUIState(bsUI, asUI, log, depth)

          if (coarse.category === 'validation-triggered' || asD.errorCount > bsD.errorCount) {
            log.pass(depth, `[validation-triggered]  form validation fired on empty submit`)
            report.detectedTestCases.push({
              component: 'Forms', page: currentUrl, status: 'detected',
              tests: ['Empty submit shows validation errors — verify all required fields are marked']
            })
          } else if (coarse.category !== 'no-change' || fine.changed) {
            log.pass(depth, `[${coarse.category !== 'no-change' ? coarse.category : fine.category}]  form responded to empty submit`)
          } else {
            log.nochange(depth, `form  no validation feedback on empty submit`)
          }

          // Restore — press Escape in case a modal or overlay appeared
          await tryDismissOverlay(currentPage)
          await waitForStability(currentPage)
        } catch { /* form interaction failed — skip */ }
      }
    }
  }
  // -----------------------------------------------------------------

  await page.goto(startUrl, { waitUntil: 'networkidle' })
  await explore(page)

  // ================================================================
  // PHASE F — Cart & Checkout Dedicated Traversal (Phase 14)
  //
  // After the main crawl, specifically seek out cart badge/icon elements
  // and the checkout flow to ensure these high-value workflows are covered.
  // ================================================================
  try {
    log.cart_(0, '[PHASE-F] cart & checkout traversal starting')

    // Look for cart badge elements on current page
    const cartHandles = await page.locator(
      '[class*="cart"], [class*="basket"], [class*="bag"], ' +
      '[aria-label*="cart"], [aria-label*="basket"], ' +
      'a[href*="cart"], a[href*="basket"]'
    ).elementHandles().catch(() => [])

    let cartNavigated = false
    for (const cartEl of cartHandles.slice(0, 3)) {
      try {
        if (!await cartEl.isVisible()) continue
        const cartId = await getElementIdentifier(cartEl)
        log.cart_(0, `cart element found: ${cartId}`)

        const bsD  = await capturePageState(page)
        const bsUI = await captureUIState(page)
        await clickWithRetry(cartEl, page, cartId, log, 0)
        await waitForStability(page)

        const asD  = await capturePageState(page)
        const asUI = await captureUIState(page)

        if (asD.url !== bsD.url) {
          log.cart_(0, `cart navigation: ${shortUrl(bsD.url)} → ${shortUrl(asD.url)}`)
          cartNavigated = true
          tracker.crawlActions++

          // Validate cart persistence: look for checkout button
          const checkoutBtn = await page.locator(
            'button:has-text("Checkout"), a:has-text("Checkout"), ' +
            'button:has-text("Place Order"), [href*="checkout"]'
          ).first()
          const checkoutVisible = await checkoutBtn.isVisible().catch(() => false)
          if (checkoutVisible) {
            log.cart_(0, 'checkout button detected on cart page')
            report.detectedTestCases.push({
              component: 'Cart', page: asD.url, status: 'detected',
              tests: [
                'Verify checkout button is reachable from cart',
                'Verify cart persists after page reload',
                'Verify item count matches badge',
              ]
            })
          }

          // Look for remove-item buttons on cart page
          const removeHandles = await page.locator(
            'button:has-text("Remove"), button:has-text("Delete"), ' +
            '[aria-label*="remove"], [aria-label*="delete"]'
          ).elementHandles().catch(() => [])

          if (removeHandles.length > 0) {
            log.cart_(0, `remove-item buttons found: ${removeHandles.length}`)
            const bsRemD  = await capturePageState(page)
            const bsRemUI = await captureUIState(page)
            const removeId = await getElementIdentifier(removeHandles[0])
            await clickWithRetry(removeHandles[0], page, removeId, log, 0).catch(() => {})
            await waitForStability(page)
            const asRemD  = await capturePageState(page)
            const asRemUI = await captureUIState(page)

            const removeAssertion = validateBusinessOutcome('remove from cart', bsRemD, asRemD, bsRemUI, asRemUI)
            if (removeAssertion) {
              removeAssertion.target = removeId
              removeAssertion.pattern = 'remove-from-cart'
              removeAssertion.page = bsRemD.url
              removeAssertion.timestamp = new Date().toISOString()
              report.assertions.push(removeAssertion)
              log.assert_(0, `${removeAssertion.passed ? 'PASS' : 'FAIL'}  [${removeAssertion.severity}]  ${removeAssertion.assertion}: ${removeAssertion.actual}`)
              tracker.crawlActions++
            }
          }

          // Navigate back to start for next session work
          await page.goto(startUrl, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {})
          break
        }
      } catch { /* cart element became stale — skip */ }
    }

    if (!cartNavigated) {
      log.cart_(0, '[PHASE-F] no cart navigation found — skipping cart traversal')
    }
  } catch { /* cart traversal failed — non-blocking */ }

  // --- Centralized execution accounting via updateExecutionMetrics ---
  // Source of truth: report.executedChecks — every action that actually ran.
  // Covers Phase A (login) + Phase B (representative) + Phase C (general crawl).
  // skippedTests from tracker.testRuns — skips never create executedCheck entries.
  const skippedCount = tracker.testRuns.filter(r => r.status === EXECUTION_STATUS.SKIPPED).length
  const execMetrics  = updateExecutionMetrics(report.executedChecks, skippedCount)

  const {
    executedTests,
    passedTests,
    failedTests,
    noChangeTests,
    errorTests,
    skippedTests,
  } = execMetrics

  // Validate invariant — log warning and auto-correct if somehow mismatched
  const computedExecuted = passedTests + failedTests + noChangeTests + errorTests
  const invariantHolds   = executedTests === computedExecuted
  if (!invariantHolds) {
    log.fail(0,
      `[WARNING] metrics invariant mismatch — auto-correcting totals: ` +
      `executed=${executedTests} computed=${computedExecuted}`
    )
  }

  log.metrics(0,
    `[METRICS] executed=${executedTests} pass=${passedTests} fail=${failedTests} ` +
    `noChange=${noChangeTests} error=${errorTests} skipped=${skippedTests} ` +
    `invariant=${invariantHolds}`
  )

  const detectedTests      = report.detectedTestCases.length
  const uniquePatternNames = new Set(report.workflowPatterns.map(w => w.pattern))
  const workflowPatterns   = uniquePatternNames.size
  const crawlInteractions  = tracker.crawlActions
  const executionAccuracy  = executedTests > 0
    ? Math.round((passedTests / executedTests) * 100)
    : 0

  // Business workflow coverage — completedBusinessWorkflows / expectedBusinessWorkflows
  // Uses real execution evidence, NOT detected buttons / elements.
  const bwResult           = detectCompletedWorkflows(report)
  const completedWorkflows = bwResult.completed          // [{ id, label, evidence }]
  const missingWorkflows_  = bwResult.missing            // [{ id, label }]
  const expectedWorkflows  = bwResult.registry           // [{ id, label }]

  report.expectedWorkflows  = expectedWorkflows.map(w => w.label)
  report.completedWorkflows = completedWorkflows
  report.missingWorkflows   = missingWorkflows_.map(w => w.label)

  const workflowCoverage = expectedWorkflows.length > 0
    ? Math.round((completedWorkflows.length / expectedWorkflows.length) * 100)
    : 0

  // Legacy pattern-level tracking (kept for backward compat with WorkflowPatternsTable)
  const passedPatternNames = new Set(
    report.workflowPatterns
      .filter(w => w.status === EXECUTION_STATUS.PASS)
      .map(w => w.pattern)
  )
  const detectedWorkflowNames = [...uniquePatternNames]
  const executedWorkflowNames = [...passedPatternNames]
  log.workflow_(0,
    `[BW-COVERAGE] expected=${expectedWorkflows.length}  completed=${completedWorkflows.length}  ` +
    `missing=${missingWorkflows_.length}  coverage=${workflowCoverage}%`
  )
  log.workflow_(0, `[BW-COMPLETED] ${completedWorkflows.map(w => w.label).join(', ') || 'none'}`)
  log.workflow_(0, `[BW-MISSING]   ${missingWorkflows_.map(w => w.label).join(', ') || 'none'}`)

  // Phase 10 — workflow graph from detected elements
  report.workflowGraph   = buildWorkflowGraph(report.components)

  // Phase 19 — navigation graph from URL transitions
  report.navigationGraph = buildNavigationGraph(report.workflows, report.executedChecks)

  // Phase 32 — flaky action detection (split stateful from genuinely flaky)
  const allFlakyResults      = detectFlakyActions(report.executedChecks)
  report.flakyActions        = allFlakyResults.filter(f => f.stability !== 'stateful')
  report.statefulActions     = allFlakyResults.filter(f => f.stability === 'stateful')

  // Phase 23 — goal-driven execution plan
  report.executionPlan  = planWorkflowExecution(report.workflowGraph, report.components)

  // Phase 17 — execution quality score (workflowCoverage must be computed first)
  // Stateful noChange results (toggle open/close cycles) are not failures — add
  // them back into the adjusted pass count so they don't penalise stability.
  const statefulNoChangeAdjust = report.statefulActions.reduce((s, a) => s + (a.noChangeOccurrences || 0), 0)
  const avgRetryForQuality = report.executedChecks.length > 0
    ? report.executedChecks.reduce((s, c) => s + (c.retryCount || 0), 0) / report.executedChecks.length
    : 0
  const tempSummary = {
    executedTests, passedTests, noChangeTests, errorTests,
    workflowCoverage, avgRetryCount: avgRetryForQuality,
    statefulNoChangeAdjust,
  }
  const qualityResult = computeExecutionQualityScore(tempSummary, report.assertions)
  report.qualityFactors = qualityResult.factors || []
  log.quality(0, `score=${qualityResult.score}  category=${qualityResult.category}  assertions=${report.assertions.length}  flaky=${report.flakyActions.length}  stateful=${report.statefulActions.length}`)

  report.summary = {
    pages:                  Object.keys(report.components).length,
    detectedTests,
    executedTests,
    passedTests,
    failedTests,
    noChangeTests,
    skippedTests,
    errorTests,
    successfulTests:        passedTests,
    nonBlockingTests:       noChangeTests,
    workflowPatterns,
    workflowCoverage,
    crawlInteractions,
    executionAccuracy,
    detectedWorkflowCount:  detectedWorkflowNames.length,
    executedWorkflowCount:  executedWorkflowNames.length,
    completedWorkflowCount: completedWorkflows.length,
    expectedWorkflowCount:  expectedWorkflows.length,
    executionQualityScore:  qualityResult.score,
    qualityCategory:        qualityResult.category,
    assertionCount:         report.assertions.length,
    assertionPassCount:     report.assertions.filter(a => a.passed).length,
    flakyActionCount:       report.flakyActions.length,
    statefulActionCount:    report.statefulActions.length,
    avgRetryCount:          report.executedChecks.length > 0
      ? Math.round((report.executedChecks.reduce((s, c) => s + (c.retryCount || 0), 0) / report.executedChecks.length) * 100) / 100
      : 0,
  }

  // Deterministic recommendations based on measured outcomes
  if (workflowCoverage < 50) {
    report.recommendations.push('Low workflow coverage — add more interactive test patterns')
  } else if (workflowCoverage < 80) {
    report.recommendations.push('Moderate workflow coverage — investigate uncovered patterns')
  }
  if (failedTests > 0) {
    report.recommendations.push(`${failedTests} test(s) failed — review error details and fix broken flows`)
  }
  if (errorTests > 0) {
    report.recommendations.push(`${errorTests} execution error(s) — check element selectors and page stability`)
  }
  if (noChangeTests > passedTests && executedTests > 0) {
    report.recommendations.push('High no-change rate — verify state detection covers AJAX and SPA transitions')
  }
  if (skippedTests > 0) {
    report.recommendations.push(`${skippedTests} test(s) skipped — ensure login and preconditions are met`)
  }
  if (executionAccuracy === 100 && executedTests >= 5) {
    report.recommendations.push('All executed tests passed — consider expanding coverage with edge-case scenarios')
  }
  if (report.recommendations.length === 0) {
    report.recommendations.push('Coverage and quality look healthy — continue monitoring with each deployment')
  }

  log.metrics(0,
    `detected=${detectedTests}  executed=${executedTests}  ` +
    `passed=${passedTests}  failed=${failedTests}  ` +
    `noChange=${noChangeTests}  skipped=${skippedTests}  error=${errorTests}  ` +
    `workflowCoverage=${workflowCoverage}%  crawlActions=${crawlInteractions}`
  )

  log.done(0,
    `session "${sessionName}" complete  pages=${report.summary.pages}  ` +
    `detected=${detectedTests}  executed=${executedTests}  ` +
    `passed=${passedTests}  failed=${failedTests}  ` +
    `noChange=${noChangeTests}  skipped=${skippedTests}  error=${errorTests}`
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
    `total pages=${merged.summary.pages}  executed=${merged.summary.executedTests}`
  )

  // ---- Step 4: Semantic use-case analysis on the complete merged dataset ----
  merged.useCase = await runUseCaseAgent(merged, log)

  // ---- Step 5: AI QA Risk Analysis (Phase 18) ----
  log.usecase(0, '[PHASE-18] QA risk analysis starting...')
  merged.qaAnalysis = await runQAAnalysisAgent(merged, log)
  log.usecase(0, `[PHASE-18] complete  analysedBy=${merged.qaAnalysis.analysedBy}`)

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

  // --- Invariant validation ---
  // executed = pass + fail + noChange + error  (skipped is NOT executed)
  // If this throws, there is a bug in the execution accounting logic above.
  const {
    executedTests:  et,
    passedTests:    pt,
    failedTests:    ft,
    noChangeTests:  nct,
    errorTests:     err,
    // skippedTests intentionally excluded — skipped is NOT counted in executedTests
  } = merged.summary
  const computedMergedExecuted = pt + ft + nct + err
  if (et !== computedMergedExecuted) {
    throw new Error(
      `[INVARIANT] Invalid execution accounting: ` +
      `executed=${et} !== computed=${computedMergedExecuted} ` +
      `(passed=${pt} + failed=${ft} + noChange=${nct} + error=${err})`
    )
  }

  // --- Observability metrics block ---
  console.log(
    `\n[METRICS]\n` +
    `detected=${merged.summary.detectedTests}\n` +
    `executed=${merged.summary.executedTests}\n` +
    `passed=${merged.summary.passedTests}\n` +
    `failed=${merged.summary.failedTests}\n` +
    `noChange=${merged.summary.noChangeTests ?? 0}\n` +
    `skipped=${merged.summary.skippedTests}\n` +
    `error=${merged.summary.errorTests ?? 0}\n` +
    `crawl-interactions=${merged.summary.crawlInteractions}\n` +
    `accuracy=${merged.summary.executionAccuracy}%`
  )

  log.done(0,
    `crawl complete  sessions=${sessionReports.length}  pages=${merged.summary.pages}  ` +
    `detected=${merged.summary.detectedTests}  executed=${merged.summary.executedTests}  ` +
    `passed=${merged.summary.passedTests}  failed=${merged.summary.failedTests}  ` +
    `noChange=${merged.summary.noChangeTests ?? 0}  skipped=${merged.summary.skippedTests}  ` +
    `error=${merged.summary.errorTests ?? 0}`
  )

  fs.writeFileSync('report.json', JSON.stringify(merged, null, 2))
  await browser.close()

  return merged
}

module.exports = runAgent
