import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { RedisHealthIndicator, RedisService } from 'src/common/services/redis';
import { ConfigService } from '@nestjs/config/dist/config.service';
import { LoggerService } from 'src/logger/logger';

@Module({
  controllers: [HealthController],
  providers: [LoggerService, HealthService, RedisService, RedisHealthIndicator, ConfigService],
  imports: [TerminusModule.forRoot({ logger: true }), HttpModule],
})
export class HealthModule {}
