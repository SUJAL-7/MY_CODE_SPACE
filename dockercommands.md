# Build the server image (orchestrator stage)
docker build -t sujalsa/ide-server-image:latest -f server/Dockerfile --target orchestrator ./server

# Build the client image
docker build -t sujalsa/ide-client-image:latest -f client/Dockerfile ./client

# Build the dev-base image
docker build -t sujalsa/dev-base:latest -f server/Dockerfile --target dev-base ./server

# push images to docker HUB
docker push sujalsa/ide-server-image:latest
docker push sujalsa/ide-client-image:latest
docker push sujalsa/dev-base:latest