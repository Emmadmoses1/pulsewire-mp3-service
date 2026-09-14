FROM node:22-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl && \
    pip3 install --break-system-packages -U yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=10000
EXPOSE 10000

CMD ["npm","start"]

# Force yt-dlp update
RUN pip3 install --break-system-packages --upgrade yt-dlp
