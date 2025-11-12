import { Module } from '@nestjs/common';
import { LoggerMiddlewareOrGuard } from './logger.middleware';
import { LoggerService } from './logger';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerInterceptor } from './logger.interceptor';

@Module({
  providers: [
    LoggerService,
    { provide: APP_INTERCEPTOR, useClass: LoggerInterceptor },
    { provide: APP_GUARD, useClass: LoggerMiddlewareOrGuard },
    { provide: APP_FILTER, useClass: LoggerMiddlewareOrGuard },
  ],
  exports: [LoggerService],
})
export class LoggerModule {}
