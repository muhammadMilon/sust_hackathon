'use strict';

const express = require('express');
const { classify } = require('./classify');
const llm = require('./llm');

const CHANNELS = new Set(['app', 'sms', 'call_center', 'merchant_portal']);
const LOCALES = new Set(['bn', 'en', 'mixed']);

/**
 * Produce the full /sort-ticket response for a validated ticket.
 * Always runs the deterministic rules engine; if the LLM path is enabled it is
 * tried first and falls back to rules on any error/timeout/invalid output.
 */
async function sortTicket(ticket) {
  const rules = classify(ticket.message, {
    channel: ticket.channel,
    locale: ticket.locale,
  });

  let core = rules;
  if (llm.isEnabled()) {
    try {
      const out = await llm.classifyWithLLM(ticket);
      if (out) core = out;
    } catch (err) {
      // Never let the LLM break the request — log and use rules.
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

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // Permissive CORS so a browser-based grader can call the API directly.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'queuestorm-ticket-triage',
      engine: llm.isEnabled() ? 'llm+rules' : 'rules',
      time: new Date().toISOString(),
    });
  });

  app.get('/', (req, res) => {
    res.json({
      service: 'queuestorm-ticket-triage',
      endpoints: ['GET /health', 'POST /sort-ticket'],
    });
  });

  app.post('/sort-ticket', async (req, res, next) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Request body must be a JSON object.' });
      }

      // ticket_id is the only hard requirement (it must be echoed back).
      if (typeof body.ticket_id !== 'string' || body.ticket_id.length === 0) {
        return res.status(400).json({ error: 'Field "ticket_id" is required and must be a non-empty string.' });
      }

      // Be forgiving on everything else so no edge case fails unexpectedly.
      const ticket = {
        ticket_id: body.ticket_id,
        message: typeof body.message === 'string' ? body.message : '',
        channel: CHANNELS.has(body.channel) ? body.channel : undefined,
        locale: LOCALES.has(body.locale) ? body.locale : undefined,
      };

      const response = await sortTicket(ticket);
      return res.json(response);
    } catch (err) {
      return next(err);
    }
  });

  // Malformed JSON from express.json() lands here.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON in request body.' });
    }
    console.error('[queuestorm] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp, sortTicket };
