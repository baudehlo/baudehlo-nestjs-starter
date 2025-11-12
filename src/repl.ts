import { repl } from '@nestjs/core';
import { createAppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const appModule = await createAppModule();
  await repl(appModule);
}
void bootstrap();
