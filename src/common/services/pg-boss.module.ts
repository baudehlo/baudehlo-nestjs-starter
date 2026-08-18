import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'src/logger/logger.module';
import { PgBossService } from './pg-boss.service';

@Global()
@Module({
  imports: [LoggerModule],
  providers: [PgBossService],
  exports: [PgBossService],
})
export class PgBossModule {}
