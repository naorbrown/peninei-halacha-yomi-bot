FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm ci --production

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY bot.js ./
RUN mkdir data
ENV NODE_ENV=production
CMD ["node", "bot.js"]
