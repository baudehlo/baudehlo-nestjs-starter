import { Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { LoggerService } from 'src/logger/logger';
import { isProduction } from '../enums';
import { FastifyReply } from 'fastify';

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly logger: LoggerService) {
    process.on('unhandledRejection', (err: Error, origin: string) => {
      this.logger.error(`unhandledRejection: ${err.message}, origin: ${origin}, ${err.stack}`);
      process.exit(1);
    });

    process.on('uncaughtException', (err: Error, origin: string) => {
      this.logger.error(`uncaughtException: ${err.message}, origin: ${origin}, err.stack`);
      process.exit(1);
    });

    super();
  }
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    this.logger.error(`Uncaught Exception: ${JSON.stringify(exception)}`);
    if (exception instanceof Error) {
      this.logger.error(exception.stack);
    }
    // Sentry.setContext('AWS', {
    //   logs: `https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/$252Faws$252Fecs$252Fcontainerinsights$252F${
    //     process.env.IDEAL_ENVIRONMENT
    //   }-Cluster-Yukon$252Fapi/log-events$3Fstart$3D${Date.now() - 5000}$26end$3D${Date.now() + 5000}`,
    // });
    Sentry.captureException(exception);
    try {
      if (isProduction) {
        response
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: exception, stack: (exception as Error).stack });
      } else {
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, error: exception });
      }
    } catch {
      // Ignoring response error here
      this.logger.error(`Catastrophic failure when sending error response: ${JSON.stringify(exception)}`);
    }
  }
}
