import { ArgumentsHost, Catch, ExceptionFilter, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from './logger';

@Injectable()
@Catch(HttpException)
export class LoggerMiddlewareOrGuard implements ExceptionFilter {
  public constructor(private readonly logger: LoggerService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const startTime = process.hrtime.bigint();
    request.headers['x-start-time'] = startTime.toString();

    this.logger.log(`Request: ${request.method} ${request.originalUrl} ${request.ip}`, 'HTTP');

    return true;
  }

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();
    const status = exception.getStatus();

    const startTimeStr = Array.isArray(request.headers['x-start-time']) ? request.headers['x-start-time'][0] : request.headers['x-start-time'];
    const startTime = startTimeStr ? BigInt(startTimeStr) : process.hrtime.bigint();
    const responseTime = (process.hrtime.bigint() - startTime) / BigInt(1e6); // Convert to milliseconds

    this.logger.error(`${request.method} ${request.url} ${exception.getStatus()} ${responseTime}ms 0 - ${request.headers['user-agent']} ${request.ip}`, 'HTTP');

    response.status(status).send({
      timestamp: new Date().toISOString(),
      statusCode: exception.getStatus(),
      error: HttpStatus[exception.getStatus()],
      message: exception.toString(),
      path: request.url,
    });
  }
}
