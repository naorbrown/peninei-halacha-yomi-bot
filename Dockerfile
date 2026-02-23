FROM node:20-alpine
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
RUN npm ci --production && apk del python3 make g++
COPY bot.js ./
RUN mkdir data
ENV NODE_ENV=production
CMD ["node", "bot.js"]
