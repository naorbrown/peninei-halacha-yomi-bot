FROM node:20-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY src/ ./src/
COPY .github/state/ ./.github/state/
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
