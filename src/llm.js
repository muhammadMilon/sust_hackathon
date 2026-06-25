'use strict';

/**
 * OPTIONAL Claude-powered classifier.
 *
 * Disabled by default. The deployed service runs purely on the rules engine in
 * classify.js — no key, no network, no failure modes. Enable this path only by
 * setting BOTH:
 *     USE_LLM=true
 *     ANTHROPIC_API_KEY=sk-ant-...
 * and installing the SDK:  npm install @anthropic-ai/sdk
 *
 * Even when enabled, the LLM output is strictly validated and every invariant
 * (department<->case_type, human_review flag, confidence bounds, summary
 * safety) is re-enforced through finalize(). On ANY error, timeout, or invalid
 * output the caller falls back to the deterministic rules result, so enabling
 * the LLM can only ever add value, never break the service.
 */

const fs = require('fs');
const path = require('path');
const { finalize, CASE_TYPES, DEPARTMENTS } = require('./classify');

const MODEL = process.env.QUEUESTORM_MODEL || 'claude-opus-4-8';
const MAX_TOKENS = Number(process.env.QUEUESTORM_MAX_TOKENS || 512);
const TIMEOUT_MS = Number(process.env.QUEUESTORM_LLM_TIMEOUT_MS || 12000);

const VALID_CASE_TYPES = new Set(Object.values(CASE_TYPES));
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_DEPARTMENTS = new Set(Object.values(DEPARTMENTS));

let _client = null;
let _systemPrompt = null;

function isEnabled() {
  return process.env.USE_LLM === 'true' && Boolean(process.env.ANTHROPIC_API_KEY);
}

function loadSystemPrompt() {
  if (_systemPrompt) return _systemPrompt;
  const p = path.join(__dirname, '..', 'prompts', 'system_prompt.txt');
  _systemPrompt = fs.readFileSync(p, 'utf8');
  return _systemPrompt;
}

async function getClient() {
  if (_client) return _client;
  // Dynamic require so the SDK is only needed when the LLM path is enabled.
  const Anthropic = require('@anthropic-ai/sdk');
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function extractJson(textOut) {
  const start = textOut.indexOf('{');
  const end = textOut.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(textOut.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<object|null>} a finalized response (without ticket_id) or
 *   null if the LLM could not produce a valid classification.
 */
async function classifyWithLLM(ticket) {
  const client = await getClient();
  const userPayload = JSON.stringify({
    ticket_id: ticket.ticket_id,
    channel: ticket.channel,
    locale: ticket.locale,
    message: ticket.message,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let msg;
  try {
    msg = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: loadSystemPrompt(),
        messages: [{ role: 'user', content: userPayload }],
      },
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }

  const textOut = (msg.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const parsed = extractJson(textOut);
  if (!parsed) return null;

  if (
    !VALID_CASE_TYPES.has(parsed.case_type) ||
    !VALID_SEVERITIES.has(parsed.severity) ||
    !VALID_DEPARTMENTS.has(parsed.department) ||
    typeof parsed.agent_summary !== 'string'
  ) {
    return null;
  }

  // Re-enforce every invariant; trust only the validated fields.
  return finalize({
    case_type: parsed.case_type,
    severity: parsed.severity,
    department: parsed.department,
    agent_summary: parsed.agent_summary,
    confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.7,
  });
}

module.exports = { isEnabled, classifyWithLLM };
