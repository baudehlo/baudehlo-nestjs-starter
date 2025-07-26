###################
# BUILD FOR LOCAL DEVELOPMENT
###################

FROM node:alpine As development

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

FROM node:alpine As build

ARG SENTRY_AUTH_TOKEN
ARG SENTRY_RELEASE
ENV SENTRY_AUTH_TOKEN=${SENTRY_AUTH_TOKEN} SENTRY_RELEASE=${SENTRY_RELEASE}

WORKDIR /usr/src/app

COPY --chown=node:node package*.json ./

COPY --chown=node:node --from=development /usr/src/app/node_modules ./node_modules

COPY --chown=node:node . .

ENV NODE_ENV production

RUN npm run build

USER node

###################
# PRODUCTION
###################

FROM node:alpine As production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
COPY prisma ./prisma

COPY --chown=node:node . .
COPY --from=build --chown=node:node /usr/src/app/node_modules ./node_modules
COPY --from=build --chown=node:node /usr/src/app/dist ./dist
COPY --from=build --chown=node:node /usr/src/app/bootstrap.ts .

RUN apk update && apk add --no-cache --upgrade bash

RUN find . -name .env -delete

ENTRYPOINT DATABASE_URL="postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/yukon?schema=api" npx prisma migrate deploy && npm run start:prod

EXPOSE 3000

USER node
