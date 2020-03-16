FROM wonderlic/node:10-alpine-builder as build

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --only=production

#---------------------------------------------------------------------
FROM wonderlic/node:10-alpine
LABEL maintainer="Wonderlic DevOps <DevOps@wonderlic.com>"

WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY index.js AwsEC2Service.js ./

RUN ln -s /usr/bin/node /app/ebs-snapshot

ENTRYPOINT ["/app/ebs-snapshot", "/app/index.js"]
