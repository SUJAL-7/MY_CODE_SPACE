FROM node:18

WORKDIR /app

ENV VITE_BACKEND_URL="http://localhost:8080"

COPY package.json .

RUN npm install

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm","run", "preview"]