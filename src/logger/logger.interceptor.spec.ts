import { CallHandler, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { StatsD } from 'hot-shots';
import { ClsService } from 'nestjs-cls';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));

import { LoggerService } from './logger';
import { LoggerInterceptor } from './logger.interceptor';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: 'GET',
    url: '/api/v1/test',
    originalUrl: '/api/v1/test',
    headers: { host: 'localhost', 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
    body: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeResponse(statusCode = 200): FastifyReply {
  const headers: Record<string, string> = {};
  return {
    statusCode,
    getHeader: vi.fn((key: string) => headers[key]),
    header: vi.fn((key: string, value: string) => {
      headers[key] = value;
    }),
  } as unknown as FastifyReply;
}

function makeContext(request: FastifyRequest, response: FastifyReply): ExecutionContext {
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
      getResponse: vi.fn().mockReturnValue(response),
    }),
  } as unknown as ExecutionContext;
}

function makeCallHandler(data: unknown = { id: 'res-1' }): CallHandler {
  return { handle: vi.fn().mockReturnValue(of(data)) };
}

function makeInterceptor({ logBody = false }: { logBody?: boolean } = {}): {
  interceptor: LoggerInterceptor;
  metrics: StatsD;
  logger: LoggerService;
} {
  const cls = { getId: vi.fn().mockReturnValue('req-1') } as unknown as ClsService;
  const logger = new LoggerService(cls);
  vi.spyOn(logger, 'log').mockReturnValue(undefined);
  vi.spyOn(logger, 'error').mockReturnValue(undefined);

  const metrics = {
    timing: vi.fn(),
    increment: vi.fn(),
  } as unknown as StatsD;

  const configService = {
    get: vi.fn().mockReturnValue(logBody),
  } as unknown as ConfigService;

  return { interceptor: new LoggerInterceptor(metrics, logger, configService), metrics, logger };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('LoggerInterceptor', () => {
  describe('intercept()', () => {
    it('calls next.handle() and returns the response data', async () => {
      const { interceptor } = makeInterceptor();
      const request = makeRequest();
      const response = makeResponse();
      const handler = makeCallHandler('result');
      const ctx = makeContext(request, response);

      const result = await new Promise((resolve) => {
        interceptor.intercept(ctx, handler).subscribe({ next: resolve });
      });

      expect(result).toBe('result');
    });

    it('records timing and http metrics via StatsD', async () => {
      const { interceptor, metrics } = makeInterceptor();
      const ctx = makeContext(makeRequest(), makeResponse());
      const handler = makeCallHandler(null);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, handler).subscribe({ next: () => resolve() });
      });

      expect(metrics.timing).toHaveBeenCalledWith('http.request.time', expect.any(Number));
      expect(metrics.increment).toHaveBeenCalledWith('http.request.method.get');
      expect(metrics.increment).toHaveBeenCalledWith('http.response.status.200');
    });

    it('sets Permissions-Policy header on every response', async () => {
      const { interceptor } = makeInterceptor();
      const response = makeResponse();
      const ctx = makeContext(makeRequest(), response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      expect(response.header).toHaveBeenCalledWith('Permissions-Policy', expect.stringContaining('camera=()'));
    });

    it('sets Location header when method is POST and response data has an id', async () => {
      const { interceptor } = makeInterceptor();
      const request = makeRequest({ method: 'POST', url: '/api/v1/items' });
      const response = makeResponse(201);
      const ctx = makeContext(request, response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler({ id: 'new-id' })).subscribe({ next: () => resolve() });
      });

      expect(response.header).toHaveBeenCalledWith('Location', expect.stringContaining('new-id'));
    });

    it('does not set Location header for non-POST methods', async () => {
      const { interceptor } = makeInterceptor();
      const request = makeRequest({ method: 'GET', url: '/api/v1/items' });
      const response = makeResponse(200);
      const ctx = makeContext(request, response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler({ id: 'some-id' })).subscribe({ next: () => resolve() });
      });

      const calls = vi.mocked(response.header).mock.calls;
      const locationCall = calls.find(([key]) => key === 'Location');
      expect(locationCall).toBeUndefined();
    });

    it('does not set Location header when response data has no id', async () => {
      const { interceptor } = makeInterceptor();
      const request = makeRequest({ method: 'POST', url: '/api/v1/items' });
      const response = makeResponse(200);
      const ctx = makeContext(request, response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      const calls = vi.mocked(response.header).mock.calls;
      const locationCall = calls.find(([key]) => key === 'Location');
      expect(locationCall).toBeUndefined();
    });

    it('logs the request body for PUT/POST/PATCH when REQUEST_LOGGING is enabled', async () => {
      const { interceptor, logger } = makeInterceptor({ logBody: true });
      const request = makeRequest({ method: 'POST', body: { name: 'test' } });
      const ctx = makeContext(request, makeResponse());

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Request body'));
    });

    it('does not log request body for GET even when REQUEST_LOGGING is enabled', async () => {
      const { interceptor, logger } = makeInterceptor({ logBody: true });
      const request = makeRequest({ method: 'GET' });
      const ctx = makeContext(request, makeResponse());

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      const bodyCalls = vi.mocked(logger.log).mock.calls.filter(([m]) => String(m).includes('Request body'));
      expect(bodyCalls).toHaveLength(0);
    });

    it('uses the Content-Length header value when present', async () => {
      const { interceptor, logger } = makeInterceptor();
      const response = makeResponse();
      vi.mocked(response.getHeader).mockReturnValue('512');
      const ctx = makeContext(makeRequest(), response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(' 512 '), 'HTTP');
    });

    it('uses "0" as content-length when the header is absent', async () => {
      const { interceptor, logger } = makeInterceptor();
      const response = makeResponse();
      vi.mocked(response.getHeader).mockReturnValue(undefined as unknown as string);
      const ctx = makeContext(makeRequest(), response);

      await new Promise<void>((resolve) => {
        interceptor.intercept(ctx, makeCallHandler(null)).subscribe({ next: () => resolve() });
      });

      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining(' 0 '), 'HTTP');
    });
  });
});
