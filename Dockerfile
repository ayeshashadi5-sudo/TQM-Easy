FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
COPY seed ./seed
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 TRUST_PROXY=1
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
