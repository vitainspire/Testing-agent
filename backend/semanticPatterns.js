
// -------------------------------------------------------------------
// semanticPatterns.js
//
// Pattern library for use-case classification.
//
// Structure:
//   PATTERNS[typeName] = {
//     label:    human-readable name for the UI
//     keywords: [{ term, weight }]
//   }
//
// Weight scale:
//   3 = highly specific   — this word almost certainly means this app type
//   2 = moderately specific — common in this type, rare elsewhere
//   1 = weak signal        — relevant but appears across many app types
//
// To add a new app type: copy any entry, change the key, label, and keywords.
// The classifier auto-discovers all keys in PATTERNS — no other file changes needed.
// -------------------------------------------------------------------

const PATTERNS = {

  ecommerce: {
    label: 'E-Commerce',
    keywords: [
      { term: 'add to cart',    weight: 3 },
      { term: 'shopping cart',  weight: 3 },
      { term: 'checkout',       weight: 3 },
      { term: 'buy now',        weight: 3 },
      { term: 'place order',    weight: 3 },
      { term: 'order history',  weight: 3 },
      { term: 'wishlist',       weight: 3 },
      { term: 'product',        weight: 2 },
      { term: 'inventory',      weight: 2 },
      { term: 'shipping',       weight: 2 },
      { term: 'discount',       weight: 2 },
      { term: 'coupon',         weight: 2 },
      { term: 'promo code',     weight: 3 },
      { term: 'cart',           weight: 2 },
      { term: 'order',          weight: 1 },
      { term: 'quantity',       weight: 1 },
      { term: 'stock',          weight: 1 },
      { term: 'price',          weight: 1 },
    ]
  },

  finance: {
    label: 'Finance / Banking',
    keywords: [
      { term: 'transfer',        weight: 3 },
      { term: 'transaction',     weight: 3 },
      { term: 'account balance', weight: 3 },
      { term: 'deposit',         weight: 3 },
      { term: 'withdraw',        weight: 3 },
      { term: 'statement',       weight: 2 },
      { term: 'investment',      weight: 2 },
      { term: 'portfolio',       weight: 2 },
      { term: 'interest',        weight: 2 },
      { term: 'loan',            weight: 2 },
      { term: 'balance',         weight: 2 },
      { term: 'invoice',         weight: 2 },
      { term: 'budget',          weight: 2 },
      { term: 'expense',         weight: 2 },
      { term: 'payment',         weight: 1 },
      { term: 'account',         weight: 1 },
    ]
  },

  healthcare: {
    label: 'Healthcare',
    keywords: [
      { term: 'patient',         weight: 3 },
      { term: 'appointment',     weight: 3 },
      { term: 'prescription',    weight: 3 },
      { term: 'diagnosis',       weight: 3 },
      { term: 'medical record',  weight: 3 },
      { term: 'doctor',          weight: 3 },
      { term: 'clinic',          weight: 2 },
      { term: 'symptom',         weight: 3 },
      { term: 'medication',      weight: 3 },
      { term: 'lab result',      weight: 3 },
      { term: 'referral',        weight: 2 },
      { term: 'vitals',          weight: 3 },
      { term: 'nurse',           weight: 2 },
      { term: 'health',          weight: 1 },
      { term: 'insurance',       weight: 1 },
    ]
  },

  education: {
    label: 'Education / LMS',
    keywords: [
      { term: 'course',          weight: 3 },
      { term: 'lesson',          weight: 3 },
      { term: 'assignment',      weight: 3 },
      { term: 'grade',           weight: 3 },
      { term: 'quiz',            weight: 3 },
      { term: 'enrollment',      weight: 3 },
      { term: 'student',         weight: 3 },
      { term: 'instructor',      weight: 2 },
      { term: 'syllabus',        weight: 3 },
      { term: 'lecture',         weight: 2 },
      { term: 'certificate',     weight: 2 },
      { term: 'module',          weight: 2 },
      { term: 'submission',      weight: 2 },
      { term: 'curriculum',      weight: 2 },
      { term: 'progress',        weight: 1 },
    ]
  },

  booking: {
    label: 'Booking / Reservations',
    keywords: [
      { term: 'reservation',     weight: 3 },
      { term: 'availability',    weight: 3 },
      { term: 'check-in',        weight: 3 },
      { term: 'check in',        weight: 3 },
      { term: 'hotel',           weight: 3 },
      { term: 'flight',          weight: 3 },
      { term: 'ticket',          weight: 2 },
      { term: 'seat',            weight: 2 },
      { term: 'itinerary',       weight: 3 },
      { term: 'cancellation',    weight: 2 },
      { term: 'book',            weight: 2 },
      { term: 'schedule',        weight: 2 },
      { term: 'date range',      weight: 2 },
      { term: 'confirmation',    weight: 1 },
    ]
  },

  social: {
    label: 'Social Platform',
    keywords: [
      { term: 'feed',            weight: 3 },
      { term: 'follow',          weight: 3 },
      { term: 'like',            weight: 3 },
      { term: 'comment',         weight: 3 },
      { term: 'friend',          weight: 3 },
      { term: 'hashtag',         weight: 3 },
      { term: 'timeline',        weight: 2 },
      { term: 'mention',         weight: 2 },
      { term: 'post',            weight: 2 },
      { term: 'share',           weight: 2 },
      { term: 'profile',         weight: 2 },
      { term: 'message',         weight: 1 },
      { term: 'notification',    weight: 1 },
    ]
  },

  admin_dashboard: {
    label: 'Admin Dashboard',
    keywords: [
      { term: 'analytics',       weight: 3 },
      { term: 'user management', weight: 3 },
      { term: 'permission',      weight: 3 },
      { term: 'audit log',       weight: 3 },
      { term: 'audit trail',     weight: 3 },
      { term: 'configuration',   weight: 2 },
      { term: 'metric',          weight: 2 },
      { term: 'report',          weight: 2 },
      { term: 'role',            weight: 2 },
      { term: 'dashboard',       weight: 2 },
      { term: 'export',          weight: 1 },
      { term: 'system',          weight: 1 },
      { term: 'setting',         weight: 1 },
    ]
  },

  crm: {
    label: 'CRM',
    keywords: [
      { term: 'lead',            weight: 3 },
      { term: 'deal',            weight: 3 },
      { term: 'pipeline',        weight: 3 },
      { term: 'opportunity',     weight: 3 },
      { term: 'prospect',        weight: 3 },
      { term: 'follow up',       weight: 2 },
      { term: 'sales',           weight: 2 },
      { term: 'contact',         weight: 2 },
      { term: 'customer',        weight: 2 },
      { term: 'account',         weight: 1 },
      { term: 'activity',        weight: 1 },
    ]
  },

  project_management: {
    label: 'Project Management',
    keywords: [
      { term: 'sprint',          weight: 3 },
      { term: 'backlog',         weight: 3 },
      { term: 'kanban',          weight: 3 },
      { term: 'epic',            weight: 3 },
      { term: 'milestone',       weight: 3 },
      { term: 'assignee',        weight: 3 },
      { term: 'story',           weight: 2 },
      { term: 'issue',           weight: 2 },
      { term: 'board',           weight: 2 },
      { term: 'task',            weight: 2 },
      { term: 'priority',        weight: 2 },
      { term: 'deadline',        weight: 2 },
      { term: 'project',         weight: 1 },
    ]
  },

  saas: {
    label: 'SaaS / Platform',
    keywords: [
      { term: 'subscription',    weight: 3 },
      { term: 'billing',         weight: 3 },
      { term: 'workspace',       weight: 3 },
      { term: 'api key',         weight: 3 },
      { term: 'integration',     weight: 3 },
      { term: 'webhook',         weight: 3 },
      { term: 'upgrade plan',    weight: 3 },
      { term: 'trial',           weight: 2 },
      { term: 'plan',            weight: 2 },
      { term: 'usage',           weight: 2 },
      { term: 'organization',    weight: 2 },
      { term: 'team',            weight: 1 },
      { term: 'upgrade',         weight: 1 },
    ]
  },

}

module.exports = { PATTERNS }
