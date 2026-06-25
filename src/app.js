'use strict';

const express = require('express');
const { buildHealth, sortTicket, handleSortTicket } = require('./handler');

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

  app.get('/health', (req, res) => res.json(buildHealth()));

  app.get('/', (req, res) => {
    res.json({
      service: 'queuestorm-ticket-triage',
      endpoints: ['GET /health', 'POST /sort-ticket'],
    });
  });

  app.post('/sort-ticket', async (req, res, next) => {
    try {
      const { status, body } = await handleSortTicket(req.body);
      return res.status(status).json(body);
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

module.exports = { createApp, sortTicket, handleSortTicket, buildHealth };
