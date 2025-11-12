import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { StatsD } from 'hot-shots';
import { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from '../services/logger';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  public constructor(
    private readonly metrics: StatsD,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    console.log('Request received:');
    if (this.configService.get<boolean>('REQUEST_LOGGING') && ['PUT', 'POST', 'PATCH'].includes(request.method)) {
      this.logger.log(`Request body: ${JSON.stringify(request.body)}`);
    }

    return next.handle();
  }

  private doLog(request: FastifyRequest, response: FastifyReply, startAt: bigint, method: string, originalUrl: string, userAgent: string, ip: string) {
    return () => {
      const { statusCode } = response;
      const contentLength = response.getHeader('content-length')?.toString() || '0';

      const duration = process.hrtime.bigint() - startAt;
      const durationInMs = duration[0] * 1000 + duration[1] / 1e6;

      this.logger.log(`[${ip}] ${method} ${originalUrl} ${statusCode} ${durationInMs}ms ${contentLength} - ${userAgent} ${ip}`);

      this.metrics.timing('http.response.time', durationInMs);
      this.metrics.increment(`http.response.status.${statusCode}`);
    };
  }
}
