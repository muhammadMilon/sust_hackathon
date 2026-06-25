'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sortFn = require('../api/sort-ticket');
const healthFn = require('../api/health');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: undefined,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
    end() { this.ended = true; return this; },
  };
}

test('vercel /health returns ok', async () => {
  const res = mockRes();
  await healthFn({ method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.status, 'ok');
  assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
});

test('vercel /sort-ticket with parsed object body', async () => {
  const res = mockRes();
  await sortFn({ method: 'POST', body: { ticket_id: 'T-001', message: 'I sent 3000 to wrong number' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ticket_id, 'T-001');
  assert.equal(res.payload.case_type, 'wrong_transfer');
  assert.equal(res.payload.severity, 'high');
});

test('vercel /sort-ticket with raw string body', async () => {
  const res = mockRes();
  await sortFn({ method: 'POST', body: JSON.stringify({ ticket_id: 'T-9', channel: 'call_center', message: 'a scammer wants my OTP' }) }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.case_type, 'phishing_or_social_engineering');
  assert.equal(res.payload.human_review_required, true);
});

test('vercel /sort-ticket missing ticket_id -> 400', async () => {
  const res = mockRes();
  await sortFn({ method: 'POST', body: { message: 'no id' } }, res);
  assert.equal(res.statusCode, 400);
});

test('vercel /sort-ticket bad JSON string -> 400', async () => {
  const res = mockRes();
  await sortFn({ method: 'POST', body: '{ broken ' }, res);
  assert.equal(res.statusCode, 400);
});

test('vercel /sort-ticket GET -> 405', async () => {
  const res = mockRes();
  await sortFn({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('vercel /sort-ticket OPTIONS -> 204', async () => {
  const res = mockRes();
  await sortFn({ method: 'OPTIONS' }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
});
