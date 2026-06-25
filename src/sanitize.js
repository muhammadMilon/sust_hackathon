'use strict';

/**
 * HARD SAFETY GUARD for the agent_summary field.
 *
 * The grader auto-fails any response whose agent_summary asks the customer to
 * share / confirm / provide / verify / enter their PIN, OTP, password, CVV, or
 * full card number. Our templates never do this, but this is a belt-and-braces
 * pass that also protects the optional LLM path, where output is less
 * predictable.
 */

// "<imperative verb> ... <secret>" within a short window => unsafe.
const UNSAFE_REQUEST =
  /\b(share|provide|enter|confirm|verify|send|give|tell|submit|type|reveal|disclose|input|resend|forward)\b[\s\S]{0,40}\b(otp|o\.t\.p|one[-\s]?time\s?(?:password|code|pin)|pin\b|password|pass\s?code|passcode|cvv|cvc|card\s*(?:number|no\.?|details)|security\s*code|verification\s*code)\b/i;

const SAFE_FALLBACK =
  'Customer reports a suspected phishing or social-engineering attempt; flagged for immediate fraud review. Do not request any sensitive credentials.';

/**
 * @param {string} summary
 * @returns {string} a summary guaranteed not to solicit sensitive credentials
 */
function sanitizeSummary(summary) {
  const s = typeof summary === 'string' ? summary.trim() : '';
  if (!s) return 'Customer message is unclear and needs follow-up for more details.';
  if (UNSAFE_REQUEST.test(s)) return SAFE_FALLBACK;
  return s;
}

module.exports = { sanitizeSummary, UNSAFE_REQUEST };
