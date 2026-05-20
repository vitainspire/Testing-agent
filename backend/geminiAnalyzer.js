
// -------------------------------------------------------------------
// geminiAnalyzer.js
//
// Low-level Gemini API wrappers used by the visual site analyzer.
// Two operations only:
//   analyzeScreenshot  — describe one page image  (vision call)
//   summarizeAllFrames — synthesize N descriptions (text call)
//
// Model: gemini-1.5-flash
//   Fast enough for real-time crawl analysis, supports multimodal input,
//   generous free-tier quota.
// -------------------------------------------------------------------

const { GoogleGenerativeAI } = require('@google/generative-ai')
const fs   = require('fs')
const path = require('path')

const MODEL = 'gemini-1.5-flash'

// Prompt for individual frame analysis
const FRAME_PROMPT =
  'You are analyzing a screenshot of a web application page.\n' +
  'Describe what you see concisely and specifically:\n' +
  '1. Page type (login, dashboard, product listing, form, settings, report, etc.)\n' +
  '2. Visible UI components (buttons, tables, charts, forms, navigation, modals, etc.)\n' +
  '3. Main content or data shown on this page\n' +
  '4. Actions available to the user\n' +
  '5. Apparent purpose of this specific page\n' +
  'Keep your response under 200 words. Be specific about what is actually visible.'

// Prompt for combining all frame descriptions into a final classification
function buildSummaryPrompt(frameCount, framesText) {
  return (
    `You are analyzing a web application. ` +
    `Below are descriptions of ${frameCount} unique pages captured from it.\n\n` +
    framesText +
    '\n\n' +
    'Based on all these pages, provide a structured analysis using EXACTLY these section headers:\n\n' +
    'APPLICATION TYPE: (choose the single best fit from: ' +
    'E-Commerce | Finance/Banking | Healthcare | Education/LMS | ' +
    'Booking/Reservations | Social Platform | Admin Dashboard | CRM | ' +
    'Project Management | SaaS/Platform | Other)\n\n' +
    'OVERALL SUMMARY: (2-3 sentences — what does this application do and who is it for?)\n\n' +
    'KEY FEATURES:\n- feature 1\n- feature 2\n- feature 3\n- feature 4\n- feature 5\n\n' +
    'TARGET USERS: (who would use this application)\n\n' +
    'MAIN WORKFLOWS: (3-4 primary user journeys you observed across the pages)'
  )
}

// -------------------------------------------------------------------
// analyzeScreenshot
// Sends one screenshot to Gemini vision and returns the description text.
// Throws if the file does not exist or the API call fails.
// -------------------------------------------------------------------
async function analyzeScreenshot(apiKey, imagePath) {
  const absolutePath = path.resolve(imagePath)

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`screenshot file not found: ${absolutePath}`)
  }

  const imageBytes = fs.readFileSync(absolutePath)
  const base64     = imageBytes.toString('base64')

  const genAI  = new GoogleGenerativeAI(apiKey)
  const model  = genAI.getGenerativeModel({ model: MODEL })

  const result = await model.generateContent([
    FRAME_PROMPT,
    { inlineData: { mimeType: 'image/png', data: base64 } },
  ])

  return result.response.text()
}

// -------------------------------------------------------------------
// summarizeAllFrames
// Sends all frame descriptions as a single text prompt and asks Gemini
// for a structured classification of the whole application.
// -------------------------------------------------------------------
async function summarizeAllFrames(apiKey, frameDescriptions) {
  const framesText = frameDescriptions
    .map((desc, i) => `=== Frame ${i + 1} ===\n${desc}`)
    .join('\n\n')

  const prompt = buildSummaryPrompt(frameDescriptions.length, framesText)

  const genAI  = new GoogleGenerativeAI(apiKey)
  const model  = genAI.getGenerativeModel({ model: MODEL })

  const result = await model.generateContent(prompt)
  return result.response.text()
}

module.exports = { analyzeScreenshot, summarizeAllFrames }
