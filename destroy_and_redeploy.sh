# stops and removes all containers build from the floetenbot image
docker rm $(docker stop $(docker ps -a -q --filter ancestor=floetenbot))
# rebuilds the image in case of changes
docker build . -t floetenbot
# launches container which will restart on crash
docker run --restart always -it -d floetenbot
