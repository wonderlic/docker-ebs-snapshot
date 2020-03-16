FROM wonderlic/node:lts-10-build as build

WORKDIR /build
COPY package.json ./
RUN npm install --only=production

#---------------------------------------------------------------------
FROM wonderlic/node:lts-10-runtime
LABEL maintainer="Wonderlic DevOps <DevOps@wonderlic.com>"

WORKDIR /app
COPY --from=build /build/node_modules ./node_modules
COPY index.js AwsEC2Service.js ./

RUN ln -s /usr/bin/node /app/ebs-snapshot

ENTRYPOINT ["/app/ebs-snapshot", "/app/index.js"]
