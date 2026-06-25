'use strict';

// Vercel serverless function. Mapped to POST /sort-ticket via vercel.json.
// Reuses the same transport-agnostic core as the Express server.
const { handleSortTicket } = require('../src/handler');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  // Vercel auto-parses JSON bodies into req.body; guard for string/empty too.
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = body.length ? JSON.parse(body) : {};
    } catch {
      res.status(400).json({ error: 'Invalid JSON in request body.' });
      return;
    }
  }
  if (body == null) body = {};

  try {
    const result = await handleSortTicket(body);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[queuestorm] vercel handler error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};
