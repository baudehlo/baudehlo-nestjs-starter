import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/**
 * Holds a reference to the NestJS application instance.
 * Extracted into its own module to avoid circular dependencies
 * (prisma.service → bootstrap-app → app.module → controllers → auth guards → prisma.service).
 */
export let app: NestFastifyApplication | undefined;

export function setAppRef(instance: NestFastifyApplication) {
  app = instance;
}
