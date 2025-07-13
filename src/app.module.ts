import { Module } from '@nestjs/common';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [HealthModule, ConfigModule.forRoot()],
  providers: [AppService],
})
export class AppModule {}
