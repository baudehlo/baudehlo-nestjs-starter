import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  imports: [TerminusModule.forRoot({ logger: true }), HttpModule],
})
export class HealthModule {}
