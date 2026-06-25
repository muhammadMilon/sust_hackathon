# QueueStorm ticket-triage service — production image.
FROM node:20-alpine

WORKDIR /app

# Install only production deps using the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY src ./src
COPY prompts ./prompts

ENV NODE_ENV=production
# Platforms inject PORT; the server reads it (defaults to 3000).
EXPOSE 3000

# Lightweight container healthcheck hitting the /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
