import { repl } from '@nestjs/core';
import { createAppModule } from './app.module';
import { isProduction } from './common/enums';

async function bootstrap(): Promise<void> {
  const appModule = await createAppModule();
  if (isProduction) {
    process.env.DATABASE_URL = `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/yukon?schema=api`;
  }
  await repl(appModule);
}
void bootstrap();
