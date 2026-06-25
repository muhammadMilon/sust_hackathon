'use strict';

// Friendly landing payload for the base URL on Vercel (GET /).
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    service: 'queuestorm-ticket-triage',
    status: 'ok',
    endpoints: ['GET /health', 'POST /sort-ticket'],
  });
};
