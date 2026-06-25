'use strict';

const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[queuestorm] listening on http://${HOST}:${PORT}`);
  console.log(`[queuestorm] engine: ${process.env.USE_LLM === 'true' ? 'llm+rules' : 'rules'}`);
});

// Graceful shutdown for container platforms (Render/Railway/Fly/Docker).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[queuestorm] ${sig} received, shutting down`);
    server.close(() => process.exit(0));
  });
}

module.exports = server;
