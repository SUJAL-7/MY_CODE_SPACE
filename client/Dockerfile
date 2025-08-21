FROM node:20-bullseye AS client

WORKDIR /app

# ARG VITE_BACKEND_URL=http://3.108.254.28:8080/
# ENV VITE_REACT_APP_SERVER_URL=${VITE_BACKEND_URL}

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npx","vite","preview","--host","0.0.0.0","--port","3000"]