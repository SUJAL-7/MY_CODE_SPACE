FROM ubuntu:20.04

RUN apt-get update &&\
    DEBIAN_FRONTEND=noninteractive TZ=Etc/UTC apt-get -y install tzdata

RUN apt-get install -y sudo
RUN apt-get install -y curl
RUN curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
RUN sudo apt install -y nodejs

RUN apt-get install -y python3
RUN apt-get install -y pip

RUN npm install -g typescript


WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]