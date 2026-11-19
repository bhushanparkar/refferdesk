# Flat layout (all files in one folder) so it can be uploaded from a phone.
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend.package.json package.json
RUN npm install
COPY index.html vite.config.js ./
RUN mkdir -p src public/icons
COPY App.jsx main.jsx src/
COPY manifest.webmanifest sw.js public/
COPY icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png public/icons/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend.package.json package.json
RUN npm install --omit=dev
COPY server.js auth.js ./
COPY 01_schema.sql 02_base.sql 03_demo.sql db/
COPY --from=web /web/dist ./public
EXPOSE 3000
CMD ["node", "server.js"]
