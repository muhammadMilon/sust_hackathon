'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(() => server && server.close());

test('GET /health returns ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('POST /sort-ticket returns full schema and echoes ticket_id', async () => {
  const res = await fetch(`${base}/sort-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ticket_id: 'T-001',
      channel: 'app',
      locale: 'en',
      message: 'I sent 5000 taka to a wrong number this morning, please help me get it back',
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ticket_id, 'T-001');
  assert.equal(body.case_type, 'wrong_transfer');
  assert.equal(body.severity, 'high');
  assert.equal(body.department, 'dispute_resolution');
  assert.equal(typeof body.agent_summary, 'string');
  assert.equal(body.human_review_required, false);
  assert.equal(typeof body.confidence, 'number');
  // exactly the seven documented keys
  assert.deepEqual(
    Object.keys(body).sort(),
    ['agent_summary', 'case_type', 'confidence', 'department', 'human_review_required', 'severity', 'ticket_id']
  );
});

test('POST /sort-ticket flags phishing for human review', async () => {
  const res = await fetch(`${base}/sort-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket_id: 'T-003', channel: 'call_center', message: 'Someone called asking my OTP, is that bKash?' }),
  });
  const body = await res.json();
  assert.equal(body.case_type, 'phishing_or_social_engineering');
  assert.equal(body.human_review_required, true);
});

test('POST /sort-ticket without ticket_id -> 400', async () => {
  const res = await fetch(`${base}/sort-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'no id here' }),
  });
  assert.equal(res.status, 400);
});

test('POST /sort-ticket with malformed JSON -> 400', async () => {
  const res = await fetch(`${base}/sort-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ not json ',
  });
  assert.equal(res.status, 400);
});
