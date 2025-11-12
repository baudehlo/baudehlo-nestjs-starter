import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { StatsD } from 'hot-shots';
import { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from './logger';
import { ConfigService } from '@nestjs/config';
import { map, Observable } from 'rxjs';

@Injectable()
export class LoggerInterceptor implements NestInterceptor {
  private logBody = false;

  public constructor(
    private readonly metrics: StatsD,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.logBody = this.configService.get<boolean>('REQUEST_LOGGING', false);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse<FastifyReply>();

    if (this.logBody && ['PUT', 'POST', 'PATCH'].includes(request.method)) {
      this.logger.log(`Request body: ${JSON.stringify(request.body)}`);
    }

    const start = process.hrtime.bigint();

    return next.handle().pipe(
      map((data) => {
        const contentLength = response.getHeader('Content-Length')?.toString() || '0';
        response.header('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');

        if (request.method === 'POST' && data && (data as { id: string }).id) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const url = new URL(`${request.url}/${data.id}`, `http://${request.headers.host}`);
          response.header('Location', url.href);
        }

        const responseTime = (process.hrtime.bigint() - start) / BigInt(1e6); // Convert to milliseconds
        this.metrics.timing('http.request.time', Number(responseTime) / 1e6);
        this.metrics.increment(`http.request.method.${request.method.toLowerCase()}`);
        this.metrics.increment(`http.response.status.${response.statusCode}`);
        this.logger.log(
          `${request.method} ${request.url} ${response.statusCode} ${responseTime}ms ${contentLength} - ${request.headers['user-agent']} ${request.ip}`,
          'HTTP',
        );

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return data;
      }),
    );
  }
}
