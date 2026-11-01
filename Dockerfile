FROM node:22-alpine
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
