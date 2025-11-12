###################
# BUILD FOR LOCAL DEVELOPMENT
###################

FROM node:24-alpine AS development

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma

RUN npm pkg delete scripts.prepare
RUN npm ci --no-audit --prefer-dedupe

COPY --chown=node:node . .

USER node

###################
# BUILD FOR PRODUCTION
###################

FROM node:24-alpine AS build

# ARG SENTRY_AUTH_TOKEN
# ARG SENTRY_RELEASE
# ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN} SENTRY_RELEASE=${SENTRY_RELEASE}

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

COPY --chown=node:node --from=development /usr/src/app/node_modules ./node_modules

COPY --chown=node:node . .

ENV NODE_ENV=production

RUN npm run build

USER node

###################
# PRODUCTION
###################

FROM node:24-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma

COPY --chown=node:node . .
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=build --chown=node:node /usr/src/app/generated ./generated
# COPY --from=build --chown=node:node /usr/src/app/bootstrap.ts .

RUN apk update && apk add --no-cache --upgrade bash perl postgresql-client

RUN find . -name .env -delete

ENTRYPOINT ["sh", "-c", "npx prisma migrate deploy && npm run start:prod"]
# ENTRYPOINT ["sh", "-c", "perl -le sleep"]

EXPOSE 3000

USER node
