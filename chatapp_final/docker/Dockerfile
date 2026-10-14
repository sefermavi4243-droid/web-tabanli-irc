FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --production
COPY backend/ ./
COPY frontend/ ./frontend/
RUN mkdir -p /data/uploads /app/certs
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/nexus.db JWT_SECRET=change_me
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
