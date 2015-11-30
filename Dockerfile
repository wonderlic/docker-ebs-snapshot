FROM wonderlic/nodejs:0.10.36
MAINTAINER Wonderlic DevOps <DevOps@wonderlic.com>

COPY node_modules /app/node_modules
COPY index.js /app/index.js

RUN ln -s /usr/bin/node /app/ebs-snapshot

ENTRYPOINT ["/app/ebs-snapshot", "/app/index.js"]
