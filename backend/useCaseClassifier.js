
// -------------------------------------------------------------------
// useCaseClassifier.js
//
// Use-Case Identification Agent — the first intelligent agent in the
// autonomous testing platform.
//
// Takes a completed crawl report, extracts semantic signals from the
// DOM data already collected, scores them against the pattern library,
// and returns a structured classification result.
//
// This runs AFTER crawling, using data already in memory — no extra
// browser calls, no network requests, no AI APIs.
//
// Output shape:
// {
//   applicationType:  'ecommerce',          // top-scoring type key
//   label:            'E-Commerce',         // human-readable name
//   confidence:       0.91,                 // 0.0 – 1.0
//   signals:          ['add to cart', ...], // matched keywords (top type)
//   alternativeTypes: [                     // other plausible types
//     { type, label, confidence }
//   ],
//   allScores: [...]                        // full ranked table for debugging
// }
// -------------------------------------------------------------------

const { extractSignals } = require('./signalExtractor')
const { scoreAllTypes }  = require('./confidenceScoring')

// Below this threshold the top type is treated as 'unknown'.
// Raise it to require stronger evidence; lower it to classify more aggressively.
const MIN_CONFIDENCE = 0.20

// A secondary type is listed as an alternative only if it crosses this floor.
const ALT_MIN_CONFIDENCE = 0.10

function classifyUseCase(report) {
  const signals = extractSignals(report)
  const ranked  = scoreAllTypes(signals)
  const top     = ranked[0]

  // Build the full score table for debugging/dashboard display
  const allScores = ranked.map(r => ({
    type:       r.typeName,
    label:      r.label,
    confidence: r.confidence,
    matched:    r.matched,
    rawScore:   r.rawScore,
  }))

  // Not enough evidence — return unknown
  if (!top || top.confidence < MIN_CONFIDENCE || top.rawScore === 0) {
    return {
      applicationType:  'unknown',
      label:            'Unknown Application',
      confidence:       0,
      signals:          [],
      alternativeTypes: [],
      allScores,
    }
  }

  // Secondary types that have meaningful (but lower) confidence
  const alternativeTypes = ranked
    .slice(1)
    .filter(r => r.confidence >= ALT_MIN_CONFIDENCE && r.rawScore > 0)
    .map(r => ({ type: r.typeName, label: r.label, confidence: r.confidence }))

  return {
    applicationType:  top.typeName,
    label:            top.label,
    confidence:       top.confidence,
    signals:          top.matched,
    alternativeTypes,
    allScores,
  }
}

module.exports = { classifyUseCase }
