'use strict';

/**
 * Transport-agnostic core: no Express, no HTTP framework.
 *
 * Both the long-running Express server (src/app.js) and the Vercel serverless
 * functions (api/*.js) call into here, so the validation, orchestration, and
 * response shape live in exactly one place.
 */

const { classify } = require('./classify');
const llm = require('./llm');

const CHANNELS = new Set(['app', 'sms', 'call_center', 'merchant_portal']);
const LOCALES = new Set(['bn', 'en', 'mixed']);

/** Health payload for GET /health. */
function buildHealth() {
  return {
    status: 'ok',
    service: 'queuestorm-ticket-triage',
    engine: llm.isEnabled() ? 'llm+rules' : 'rules',
    time: new Date().toISOString(),
  };
}

/**
 * Run the deterministic rules engine, with the optional LLM tried first (and
 * falling back to rules on any error/timeout/invalid output) when enabled.
 */
async function sortTicket(ticket) {
  const rules = classify(ticket.message, { channel: ticket.channel, locale: ticket.locale });

  let core = rules;
  if (llm.isEnabled()) {
    try {
      const out = await llm.classifyWithLLM(ticket);
      if (out) core = out;
    } catch (err) {
      console.warn('[queuestorm] LLM path failed, using rules engine:', err.message);
    }
  }

  // ticket_id first, then the classification fields, matching the schema order.
  return {
    ticket_id: ticket.ticket_id,
    case_type: core.case_type,
    severity: core.severity,
    department: core.department,
    agent_summary: core.agent_summary,
    human_review_required: core.human_review_required,
    confidence: core.confidence,
  };
}

/**
 * Validate a parsed request body and produce the response.
 * @returns {Promise<{status:number, body:object}>}
 */
async function handleSortTicket(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { status: 400, body: { error: 'Request body must be a JSON object.' } };
  }
  // ticket_id is the only hard requirement (it must be echoed back).
  if (typeof body.ticket_id !== 'string' || body.ticket_id.length === 0) {
    return { status: 400, body: { error: 'Field "ticket_id" is required and must be a non-empty string.' } };
  }

  // Be forgiving on everything else so no edge case fails unexpectedly.
  const ticket = {
    ticket_id: body.ticket_id,
    message: typeof body.message === 'string' ? body.message : '',
    channel: CHANNELS.has(body.channel) ? body.channel : undefined,
    locale: LOCALES.has(body.locale) ? body.locale : undefined,
  };

  return { status: 200, body: await sortTicket(ticket) };
}

module.exports = { buildHealth, sortTicket, handleSortTicket, CHANNELS, LOCALES };
