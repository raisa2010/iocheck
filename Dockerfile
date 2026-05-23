FROM node:22-alpine AS builder

WORKDIR /app

COPY api/package*.json ./
RUN npm install

COPY api ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

COPY api/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start:prod"]