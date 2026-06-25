'use strict';

/**
 * QueueStorm rules-based ticket classifier.
 *
 * Deterministic, dependency-free, sub-millisecond. Understands English, Bangla,
 * and Banglish (mixed Bangla + English in Latin script). This is the default
 * engine that powers the deployed service — no API keys, no network, no GPU.
 *
 * The single source of truth for the response shape is `classify()`, so every
 * invariant (department <-> case_type consistency, human_review flagging,
 * confidence bounds, summary safety) is enforced in one place.
 */

const { sanitizeSummary } = require('./sanitize');

const CASE_TYPES = Object.freeze({
  WRONG_TRANSFER: 'wrong_transfer',
  PAYMENT_FAILED: 'payment_failed',
  REFUND: 'refund_request',
  PHISHING: 'phishing_or_social_engineering',
  OTHER: 'other',
});

const DEPARTMENTS = Object.freeze({
  CUSTOMER_SUPPORT: 'customer_support',
  DISPUTE: 'dispute_resolution',
  PAYMENTS: 'payments_ops',
  FRAUD: 'fraud_risk',
});

// ---------------------------------------------------------------------------
// Signal patterns. Lower-cased text is matched; Bangla code points are matched
// directly (case-folding is a no-op for Bangla, which is fine).
// ---------------------------------------------------------------------------

const RE = {
  // --- phishing building blocks ---
  secret:
    /(\botp\b|o\.t\.p|one[-\s]?time\s?(?:password|code|pin)|\bpin\b|\bpassword\b|\bpass\s?code\b|\bcvv\b|\bcvc\b|card\s*(?:number|no\.?|details)|security\s*code|verification\s*code|ওটিপি|পিন|পাসওয়ার্ড|গোপন\s*(?:নম্বর|কোড|পিন))/i,
  scam:
    /(\bscam\w*|fraud\w*|phish\w*|spoof\w*|impersonat\w*|pretend\w*\s+to\s+be|fake\s+(?:call|sms|message|link|agent|bkash|nagad|rocket|account|number)|suspicious|protarok|protaron\w*|\bvua\b|\bbhua\b|প্রতারক|প্রতারণা|সন্দেহজনক|ভুয়া|জালিয়াত\w*)/i,
  thirdPartyRequest:
    /(ask\w*\s+(?:for\s+|me\s+|my\s+)?|wants?\s+my|requested|request\s+my|share\s+(?:my|your|the)?|give\s+(?:me|them|him|her)|tell\s+(?:me|them)|told\s+me|sent?\s+me\s+a?\s?(?:link|sms|message|code)|click\s+(?:this|the|a)?\s?link|verify\s+(?:my|your|the)?\s?account|chac\w*|chai\w*\s+(?:otp|pin|code|password)|diye\s+bol\w*|চাইছে|চাচ্ছে|দিয়ে\s*বল|ভেরিফাই)/i,
  accountThreat:
    /(account\s+(?:hacked|compromis\w*|taken\s+over|take\s?over|breach\w*)|unauthori[sz]ed\s+(?:transaction|access|login|payment|activity)|hacked\s+my\s+account|someone\s+(?:accessed|logged\s+in(?:to)?|using)\s+my)/i,
  legitimacyDoubt:
    /(is\s+(?:this|that|it)\s+(?:real|legit\w*|genuine|original|bkash|nagad|true|fake)|asol\s+ki|আসল\s*কি|এটা\s*কি\s*আসল)/i,
  call: /(call\w*|phone|ring\w*|dial\w*|ফোন|কল\s*(?:দিয়ে|করে|করছে))/i,
  link: /(link|sms|text\s+message|message|email|url|http|লিংক|মেসেজ|এসএমএস)/i,
  verifyAccount:
    /(verify\s+(?:my|your|the)?\s?account|account\s+verif\w*|verify\s+kor\w*|update\s+(?:my|your)\s+(?:account|kyc)|confirm\s+(?:my|your)\s+(?:account|identity)|ভেরিফাই|একাউন্ট\s*(?:ভেরিফাই|আপডেট))/i,

  // --- wrong transfer ---
  wrongTransfer:
    /(wrong\s+(?:number|recipient|account|person|bkash|nagad|rocket|no\b)|sent\s+to\s+(?:the\s+)?wrong|mistaken\w*\s+sent|sent\s+(?:it\s+)?by\s+mistake|accidental\w*\s+sent|sent\s+to\s+(?:a\s+)?(?:different|another)\s+(?:number|person)|vul\s+(?:number|nombor|nomor|nambar)|bhul\s+(?:number|nombor|nomor)|vhul\s+(?:number|nombor)|ভুল\s*(?:নাম্বার|নম্বর|নাম্বারে|নম্বরে|ব্যক্তি))/i,

  // --- payment failed ---
  paymentFailed:
    /(payment\s+(?:fail\w*|unsuccessful|declin\w*|not\s+success\w*|did\s*n.?t\s+go|incomplete)|transaction\s+(?:fail\w*|unsuccessful|declin\w*|stuck|pending|incomplete|did\s*n.?t\s+complete)|fail\w*\s+(?:payment|transaction)|cash\s?out\s+(?:fail\w*|did\s*n.?t)|send\s+money\s+(?:fail\w*|did\s*n.?t)|payment\s+stuck|transaction\s+stuck|lenden\s+fail\w*|fail\s+hoyeche|peyment\s+fail\w*)/i,
  deduction:
    /(deducted|debited|balance\s+(?:cut|gone|deducted|kome\s+geche)|money\s+(?:cut|gone|deducted)|cut\s+from\s+my|taka\s+kete\s+(?:niyeche|nieche|neyeche|gece|geche|nilo)|kete\s+ne(?:ya|wa|che)|টাকা\s*কেটে\s*(?:নিয়েছে|নিছে|গেছে|নিল)|ব্যালেন্স\s*(?:কেটে|কমে))/i,

  // --- refund ---
  refund:
    /(refund\w*|money\s+back|get\s+my\s+money\s+back|return\s+my\s+(?:money|payment|taka)|reverse\s+(?:the\s+)?(?:transaction|payment|charge)|cancel\s+(?:my\s+)?(?:order|transaction|payment|purchase)|changed?\s+my\s+mind|charge\w*\s+twice|double\s+charge\w*|duplicate\s+(?:charge|payment|transaction)|overpaid|over\s?charge\w*|ferot|ফেরত|টাকা\s*ফেরত)/i,
  contested:
    /(refus\w*|denied|won.?t\s+refund|still\s+(?:not|haven.?t)|not\s+(?:yet\s+)?(?:received|refunded|delivered|got)|never\s+(?:received|got|delivered)|dispute\w*|escalat\w*|days?\s+ago|weeks?\s+ago|complain\w*\s+(?:multiple|again)|product\s+not\s+(?:delivered|received))/i,

  // --- "other" but recognizable (boosts confidence vs. true gibberish) ---
  otherKnown:
    /(app\s+(?:crash\w*|hang\w*|freez\w*|froze|not\s+open\w*|won.?t\s+open|stuck|slow|lag\w*|update)|crash\w*|cannot\s+(?:open|login|log\s?in|access)|can.?t\s+(?:open|login|log\s?in|access)|login\s+(?:problem|issue|fail\w*|error)|log\s?in\s+(?:problem|issue)|update\s+(?:problem|issue|fail\w*)|loading|black\s+screen|white\s+screen|blank\s+screen|error\s+(?:code|message)|not\s+working|didn.?t\s+receive\s+(?:my\s+)?otp|otp\s+not\s+(?:coming|received|received)|forgot\s+my\s+(?:pin|password)|reset\s+my\s+(?:pin|password)|change\s+my\s+(?:pin|password)|how\s+(?:do|to|can)|question|feedback|complain\w*\s+about\s+(?:ad|ads|service))/i,
  appCrash: /(crash\w*|froze|freez\w*|hang\w*|black\s+screen|white\s+screen|blank\s+screen)/i,
  login: /(login|log\s?in|sign\s?in|access\s+my\s+account|forgot\s+my\s+(?:pin|password)|reset\s+my\s+(?:pin|password))/i,
  slow: /(slow|lag\w*|loading|stuck\s+loading|not\s+responding|hang\w*)/i,
};

function normalize(message) {
  return (message == null ? '' : String(message)).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Extract a money amount and render it as "<n> BDT". Returns '' if none. */
function extractAmount(text) {
  const re = /(৳|tk\.?|bdt|taka|rs\.?|৳)?\s*(\d[\d,]*(?:\.\d+)?)\s*(৳|tk\b|bdt|taka|rs\b|টাকা|৳)?/gi;
  let best = null;
  let m;
  while ((m = re.exec(text)) !== null) {
    const hasCurrency = Boolean(m[1] || m[3]);
    const value = parseFloat(m[2].replace(/,/g, ''));
    if (!Number.isFinite(value) || value < 1) continue;
    // Prefer a number adjacent to a currency token; otherwise keep the largest.
    if (hasCurrency) return formatAmount(value);
    if (best === null || value > best) best = value;
  }
  return best !== null && best >= 10 ? formatAmount(best) : '';
}

function formatAmount(value) {
  const n = Number.isInteger(value) ? value : Number(value.toFixed(2));
  return `${n.toLocaleString('en-US')} BDT`;
}

/** Decide whether the message describes a phishing / social-engineering case. */
function detectPhishing(text, channel) {
  const secret = RE.secret.test(text);
  const scam = RE.scam.test(text);
  const request = RE.thirdPartyRequest.test(text);
  const threat = RE.accountThreat.test(text);
  const doubt = RE.legitimacyDoubt.test(text);
  const call = RE.call.test(text) || channel === 'call_center';
  const link = RE.link.test(text);
  const verify = RE.verifyAccount.test(text);

  // A bare mention of PIN/OTP (e.g. "I forgot my PIN", "didn't receive OTP") is
  // NOT phishing — it needs a third-party request, a scam signal, an account
  // threat, a legitimacy doubt around the secret, or an unsolicited "verify
  // your account" link to qualify.
  const hit =
    scam ||
    threat ||
    (secret && (request || doubt || channel === 'call_center')) ||
    (verify && (link || doubt));

  return { hit, secret, scam, request, threat, doubt, call, link, verify };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Classify a single ticket.
 *
 * @param {string} message  free-text customer complaint
 * @param {{channel?:string, locale?:string}} [hints]
 * @returns {{case_type:string, severity:string, department:string,
 *            agent_summary:string, human_review_required:boolean,
 *            confidence:number}}
 */
function classify(message, hints = {}) {
  const channel = hints.channel;
  const text = normalize(message);
  const amount = extractAmount(text);

  // Empty / no usable content.
  if (!text || !/[a-z0-9ঀ-৿]/i.test(text)) {
    return finalize({
      case_type: CASE_TYPES.OTHER,
      severity: 'low',
      department: DEPARTMENTS.CUSTOMER_SUPPORT,
      agent_summary: 'Customer message is empty or unclear and needs follow-up for more details.',
      confidence: 0.3,
    });
  }

  const phish = detectPhishing(text, channel);
  const sig = {
    wrongTransfer: RE.wrongTransfer.test(text),
    paymentFailed: RE.paymentFailed.test(text),
    refund: RE.refund.test(text),
    deduction: RE.deduction.test(text),
    contested: RE.contested.test(text),
    otherKnown: RE.otherKnown.test(text),
  };

  // --- case_type via safety-first priority ---
  // phishing > wrong_transfer > payment_failed > refund_request > other
  let caseType;
  if (phish.hit) caseType = CASE_TYPES.PHISHING;
  else if (sig.wrongTransfer) caseType = CASE_TYPES.WRONG_TRANSFER;
  else if (sig.paymentFailed || sig.deduction) caseType = CASE_TYPES.PAYMENT_FAILED;
  else if (sig.refund) caseType = CASE_TYPES.REFUND;
  else caseType = CASE_TYPES.OTHER;

  // --- severity ---
  let severity;
  switch (caseType) {
    case CASE_TYPES.PHISHING:
      severity = 'critical';
      break;
    case CASE_TYPES.WRONG_TRANSFER:
      severity = 'high';
      break;
    case CASE_TYPES.PAYMENT_FAILED:
      severity = sig.deduction ? 'high' : 'medium';
      break;
    case CASE_TYPES.REFUND:
      severity = sig.contested ? 'medium' : 'low';
      break;
    default:
      severity = 'low';
  }

  // --- department (kept consistent with case_type) ---
  let department;
  switch (caseType) {
    case CASE_TYPES.PHISHING:
      department = DEPARTMENTS.FRAUD;
      break;
    case CASE_TYPES.WRONG_TRANSFER:
      department = DEPARTMENTS.DISPUTE;
      break;
    case CASE_TYPES.PAYMENT_FAILED:
      department = DEPARTMENTS.PAYMENTS;
      break;
    case CASE_TYPES.REFUND:
      department = severity === 'low' ? DEPARTMENTS.CUSTOMER_SUPPORT : DEPARTMENTS.DISPUTE;
      break;
    default:
      department = DEPARTMENTS.CUSTOMER_SUPPORT;
  }

  // --- confidence ---
  const competing = [sig.wrongTransfer, sig.paymentFailed, sig.refund].filter(Boolean).length;
  let confidence;
  switch (caseType) {
    case CASE_TYPES.PHISHING:
      confidence = 0.9;
      if (phish.scam && phish.secret) confidence = 0.96;
      else if (phish.scam || (phish.secret && phish.request)) confidence = 0.93;
      else if (phish.threat) confidence = 0.85;
      break;
    case CASE_TYPES.WRONG_TRANSFER:
      confidence = 0.9 + (amount ? 0.03 : 0) - (competing > 1 ? 0.06 : 0);
      break;
    case CASE_TYPES.PAYMENT_FAILED:
      confidence = (sig.deduction ? 0.92 : 0.8) - (competing > 1 ? 0.06 : 0);
      break;
    case CASE_TYPES.REFUND:
      confidence = 0.88 - (competing > 1 ? 0.08 : 0);
      break;
    default:
      confidence = sig.otherKnown ? 0.82 : 0.3;
  }
  confidence = clamp(round2(confidence), 0.05, 0.97);

  const agent_summary = buildSummary(caseType, { text, amount, channel, phish, sig });

  return finalize({ case_type: caseType, severity, department, agent_summary, confidence });
}

/** Build a neutral, factual, safety-compliant agent summary. */
function buildSummary(caseType, ctx) {
  const { text, amount, channel, phish, sig } = ctx;

  if (caseType === CASE_TYPES.PHISHING) {
    let detail = '';
    if (phish.secret) detail = ' involving a request for sensitive account credentials';
    else if (phish.link && !phish.call) detail = ' involving a suspicious message or link';
    else if (phish.call) detail = ' involving a suspicious phone call';
    else if (phish.threat) detail = ' involving possible unauthorized account access';
    // NOTE: never echoes the requested secret as an instruction.
    return `Customer reports a suspected phishing or social-engineering attempt${detail} and questions its legitimacy; flagged for immediate fraud review.`;
  }

  if (caseType === CASE_TYPES.WRONG_TRANSFER) {
    let noun = 'number';
    if (/account/.test(text)) noun = 'account';
    else if (/person|someone|recipient|individual/.test(text)) noun = 'recipient';
    return `Customer reports sending ${amount || 'money'} to a wrong ${noun} and requests recovery of the funds.`;
  }

  if (caseType === CASE_TYPES.PAYMENT_FAILED) {
    const ded = sig.deduction ? ' where the account balance was still deducted' : '';
    const amt = amount ? ` of ${amount}` : '';
    return `Customer reports a failed or incomplete payment${amt}${ded}.`;
  }

  if (caseType === CASE_TYPES.REFUND) {
    const last = /(last|recent|latest|previous|this)/.test(text);
    const reason = /(changed?\s+my\s+mind|no\s+longer\s+want|don.?t\s+want)/.test(text)
      ? ' due to a change of mind'
      : /(twice|double|duplicate)/.test(text)
        ? ' for a duplicate charge'
        : '';
    const amt = amount ? ` of ${amount}` : '';
    return `Customer requests a refund for ${last ? 'their last transaction' : 'a transaction'}${amt}${reason}.`;
  }

  // other
  if (RE.appCrash.test(text)) return 'Customer reports that the app crashed or became unresponsive.';
  if (RE.login.test(text)) return 'Customer reports a login or account-access issue.';
  if (RE.slow.test(text)) return 'Customer reports app performance or loading problems.';
  if (sig.otherKnown) return 'Customer reports a general app or service issue that needs follow-up.';
  return 'Customer message is unclear and needs follow-up for more details.';
}

/** Enforce every invariant and produce the final response object. */
function finalize(partial) {
  const case_type = partial.case_type;
  const human_review_required =
    partial.severity === 'critical' || case_type === CASE_TYPES.PHISHING;

  // Field order matches the documented response schema.
  return {
    case_type,
    severity: partial.severity,
    department: partial.department,
    agent_summary: sanitizeSummary(partial.agent_summary),
    human_review_required,
    confidence: clamp(round2(partial.confidence), 0.05, 0.97),
  };
}

module.exports = { classify, CASE_TYPES, DEPARTMENTS, finalize, extractAmount };
