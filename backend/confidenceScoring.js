
// -------------------------------------------------------------------
// confidenceScoring.js
//
// Scores each application type against a flat array of text signals.
// Returns a sorted list of { typeName, label, confidence, matched }.
//
// Scoring design:
//
//   rawScore — sum of weights of all keywords that match at least
//              one signal via substring search.
//
//   confidence — blends two independent measures:
//
//     1. relativeDominance (weight 0.65):
//        How much did this type score compared to the sum of ALL types?
//        High = this type monopolizes the signals. Low = signals are spread.
//
//     2. absoluteStrength (weight 0.35):
//        rawScore / 10, capped at 1.0.
//        Rewards having many high-weight keyword matches in absolute terms,
//        independently of how other types scored.
//
//   This blend avoids two failure modes:
//     - relativeDominance alone: any one match on an otherwise empty page
//       gives 100% confidence (wrong).
//     - absoluteStrength alone: a type with 3 matched keywords of weight 3
//       scores 0.9 even if another type scored 50 points (wrong).
// -------------------------------------------------------------------

const { PATTERNS } = require('./semanticPatterns')

// Returns true if any signal contains the keyword term as a substring.
// e.g. "add to cart" matches the signal "add to cart button click".
function anySignalContains(signals, term) {
  for (const s of signals) {
    if (s.includes(term)) return true
  }
  return false
}

// Score a single app type against the full signal array.
function scoreType(typeName, signals) {
  const config  = PATTERNS[typeName]
  const matched = []
  let rawScore  = 0

  for (const kw of config.keywords) {
    if (anySignalContains(signals, kw.term)) {
      rawScore += kw.weight
      matched.push(kw.term)
    }
  }

  return { typeName, label: config.label, rawScore, matched }
}

// Score all types and attach a normalised confidence value to each.
// Returns the array sorted by confidence descending.
function scoreAllTypes(signals) {
  // Step 1 — compute raw scores for every type
  const results = Object.keys(PATTERNS).map(name => scoreType(name, signals))

  // Step 2 — compute totals needed for relative dominance
  const totalRawScore = results.reduce((sum, r) => sum + r.rawScore, 0)

  // Step 3 — attach confidence and sort
  return results
    .map(r => {
      const relativeDominance  = totalRawScore > 0 ? r.rawScore / totalRawScore : 0
      const absoluteStrength   = Math.min(r.rawScore / 10, 1.0)
      const confidence         = parseFloat(
        (relativeDominance * 0.65 + absoluteStrength * 0.35).toFixed(3)
      )
      return { ...r, confidence }
    })
    .sort((a, b) => b.confidence - a.confidence)
}

module.exports = { scoreAllTypes }
