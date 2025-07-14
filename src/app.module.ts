import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HotShotsModule } from 'nestjs-hot-shots';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    ConfigModule.forRoot(),
    HotShotsModule.forRoot({
      // StatsD
      host: process.env.STATSD_HOST || 'statsd.disco',
      port: parseInt(process.env.STATSD_PORT || '8125', 10),
      mock: process.env.NODE_ENV !== 'production' || process.env.STATSD_MOCK === 'true',
    }),
  ],
  providers: [AppService],
})
export class AppModule {}
