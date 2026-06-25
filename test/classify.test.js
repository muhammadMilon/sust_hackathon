'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../src/classify');
const { UNSAFE_REQUEST } = require('../src/sanitize');

// ---- Public sample cases from the task brief (case_type + severity) ----
const PUBLIC = [
  { msg: 'I sent 3000 to wrong number', case_type: 'wrong_transfer', severity: 'high' },
  { msg: 'Payment failed but balance deducted', case_type: 'payment_failed', severity: 'high' },
  { msg: 'Someone called asking my OTP, is that bKash?', case_type: 'phishing_or_social_engineering', severity: 'critical' },
  { msg: 'Please refund my last transaction, I changed my mind', case_type: 'refund_request', severity: 'low' },
  { msg: 'App crashed when I opened it', case_type: 'other', severity: 'low' },
];

for (const c of PUBLIC) {
  test(`public sample: "${c.msg}"`, () => {
    const r = classify(c.msg, {});
    assert.equal(r.case_type, c.case_type);
    assert.equal(r.severity, c.severity);
  });
}

// ---- Worked examples from the system prompt (full enum coverage) ----
test('wrong_transfer -> dispute_resolution, high, no review', () => {
  const r = classify('I sent 5000 taka to a wrong number this morning, please help me get it back', { channel: 'app', locale: 'en' });
  assert.equal(r.case_type, 'wrong_transfer');
  assert.equal(r.severity, 'high');
  assert.equal(r.department, 'dispute_resolution');
  assert.equal(r.human_review_required, false);
  assert.match(r.agent_summary, /5,?000 BDT/);
});

test('payment_failed -> payments_ops, high when deducted', () => {
  const r = classify('Payment failed but balance deducted', {});
  assert.equal(r.department, 'payments_ops');
  assert.equal(r.severity, 'high');
  assert.equal(r.human_review_required, false);
});

test('phishing -> fraud_risk, critical, review required', () => {
  const r = classify('Someone called asking my OTP, is that bKash?', { channel: 'call_center' });
  assert.equal(r.case_type, 'phishing_or_social_engineering');
  assert.equal(r.severity, 'critical');
  assert.equal(r.department, 'fraud_risk');
  assert.equal(r.human_review_required, true);
});

test('refund_request -> customer_support, low', () => {
  const r = classify('Please refund my last transaction, I changed my mind', {});
  assert.equal(r.department, 'customer_support');
  assert.equal(r.severity, 'low');
  assert.equal(r.human_review_required, false);
});

test('other -> customer_support, low', () => {
  const r = classify('App crashed when I opened it', {});
  assert.equal(r.case_type, 'other');
  assert.equal(r.department, 'customer_support');
});

// ---- Banglish / Bangla ----
test('banglish wrong transfer', () => {
  const r = classify('vul number e 2000 taka chole geche, ferot dorkar', { locale: 'mixed' });
  assert.equal(r.case_type, 'wrong_transfer');
  assert.equal(r.severity, 'high');
});

test('bangla phishing link', () => {
  const r = classify('একটা মেসেজে লিংক দিয়ে বলছে আমার একাউন্ট ভেরিফাই করতে, এটা কি আসল?', { locale: 'bn' });
  assert.equal(r.case_type, 'phishing_or_social_engineering');
  assert.equal(r.human_review_required, true);
});

test('banglish payment failed with deduction', () => {
  const r = classify('payment fail hoyeche kintu taka kete niyeche', {});
  assert.equal(r.case_type, 'payment_failed');
  assert.equal(r.severity, 'high');
});

// ---- Tie-breaking ----
test('wrong transfer beats refund wording', () => {
  const r = classify('I sent money to the wrong number, please refund it', {});
  assert.equal(r.case_type, 'wrong_transfer');
});

test('payment failed beats refund wording', () => {
  const r = classify('transaction failed but money deducted, give my money back', {});
  assert.equal(r.case_type, 'payment_failed');
});

test('phishing beats everything', () => {
  const r = classify('a scammer is asking for my OTP to refund a wrong transfer', {});
  assert.equal(r.case_type, 'phishing_or_social_engineering');
});

// ---- Non-phishing secret mentions stay out of fraud ----
test('forgot my PIN is not phishing', () => {
  const r = classify('I forgot my PIN, how do I reset it?', {});
  assert.notEqual(r.case_type, 'phishing_or_social_engineering');
});

test("didn't receive OTP is not phishing", () => {
  const r = classify("I didn't receive my OTP code", {});
  assert.notEqual(r.case_type, 'phishing_or_social_engineering');
});

// ---- Edge cases ----
test('empty message -> other/low/0.3', () => {
  const r = classify('', {});
  assert.equal(r.case_type, 'other');
  assert.equal(r.severity, 'low');
  assert.equal(r.confidence, 0.3);
});

test('gibberish -> other low confidence', () => {
  const r = classify('asdkjh ??', {});
  assert.equal(r.case_type, 'other');
  assert.ok(r.confidence <= 0.4);
});

// ---- Safety rule: summary must never solicit secrets ----
test('phishing summary never solicits credentials', () => {
  const r = classify('Caller said share your OTP and PIN now to keep your account', { channel: 'call_center' });
  assert.equal(r.case_type, 'phishing_or_social_engineering');
  assert.equal(UNSAFE_REQUEST.test(r.agent_summary), false);
});

// ---- Invariants across a broad sweep ----
test('confidence always within (0,1) and review flag consistent', () => {
  const samples = ['', 'random text', 'scam OTP', 'wrong number 500', 'refund please', 'payment failed deducted'];
  for (const m of samples) {
    const r = classify(m, {});
    assert.ok(r.confidence > 0 && r.confidence < 1, `confidence out of range for "${m}"`);
    const expectReview = r.severity === 'critical' || r.case_type === 'phishing_or_social_engineering';
    assert.equal(r.human_review_required, expectReview);
    assert.equal(UNSAFE_REQUEST.test(r.agent_summary), false);
  }
});
