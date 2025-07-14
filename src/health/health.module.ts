import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { RedisHealthIndicator, RedisService } from 'src/common/services/redis';
import { ConfigService } from '@nestjs/config/dist/config.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, RedisService, RedisHealthIndicator, ConfigService],
  imports: [TerminusModule.forRoot({ logger: true }), HttpModule],
})
export class HealthModule {}
