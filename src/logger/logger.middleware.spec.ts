import { ArgumentsHost, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));

import { LoggerService } from './logger';
import { LoggerMiddlewareOrGuard } from './logger.middleware';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeLogger(): LoggerService {
  const cls = { getId: vi.fn().mockReturnValue('req-id') } as unknown as ClsService;
  const logger = new LoggerService(cls);
  vi.spyOn(logger, 'log').mockReturnValue(undefined);
  vi.spyOn(logger, 'error').mockReturnValue(undefined);
  return logger;
}

function makeExecutionContext(overrides: Partial<FastifyRequest> = {}): ExecutionContext {
  const request: Partial<FastifyRequest> = {
    method: 'GET',
    originalUrl: '/api/v1/items',
    ip: '1.2.3.4',
    headers: {},
    ...overrides,
  };
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
    }),
  } as unknown as ExecutionContext;
}

function makeArgumentsHost(request: Partial<FastifyRequest>, response: Partial<FastifyReply>): ArgumentsHost {
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getRequest: vi.fn().mockReturnValue(request),
      getResponse: vi.fn().mockReturnValue(response),
    }),
  } as unknown as ArgumentsHost;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('LoggerMiddlewareOrGuard', () => {
  let guard: LoggerMiddlewareOrGuard;
  let logger: LoggerService;

  beforeEach(() => {
    logger = makeLogger();
    guard = new LoggerMiddlewareOrGuard(logger);
  });

  describe('canActivate()', () => {
    it('returns true to allow the request through', () => {
      const ctx = makeExecutionContext();
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('logs the incoming request method and URL', () => {
      const ctx = makeExecutionContext({ method: 'POST', originalUrl: '/api/v1/things' });
      guard.canActivate(ctx);
      expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('POST /api/v1/things'), 'HTTP');
    });

    it('stores a high-resolution start time in request headers', () => {
      const request: Partial<FastifyRequest> = {
        method: 'GET',
        originalUrl: '/test',
        ip: '1.2.3.4',
        headers: {} as Record<string, string>,
      };
      const ctx = {
        switchToHttp: vi.fn().mockReturnValue({
          getRequest: vi.fn().mockReturnValue(request),
        }),
      } as unknown as ExecutionContext;

      guard.canActivate(ctx);

      expect(request.headers!['x-start-time']).toBeDefined();
      expect(typeof request.headers!['x-start-time']).toBe('string');
    });
  });

  describe('catch()', () => {
    let sendMock: ReturnType<typeof vi.fn>;
    let statusMock: ReturnType<typeof vi.fn>;
    let response: Partial<FastifyReply>;

    beforeEach(() => {
      sendMock = vi.fn();
      statusMock = vi.fn().mockReturnValue({ send: sendMock });
      response = { status: statusMock } as unknown as Partial<FastifyReply>;
    });

    it('sends the correct status code and error payload', () => {
      const exception = new HttpException('Not Found', HttpStatus.NOT_FOUND);
      const request: Partial<FastifyRequest> = {
        method: 'GET',
        url: '/api/v1/missing',
        headers: {},
        ip: '1.2.3.4',
      };
      guard.catch(exception, makeArgumentsHost(request, response));

      expect(statusMock).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: HttpStatus.NOT_FOUND,
          error: 'NOT_FOUND',
          path: '/api/v1/missing',
        }),
      );
    });

    it('includes a timestamp in the error payload', () => {
      const exception = new HttpException('Bad Request', HttpStatus.BAD_REQUEST);
      guard.catch(exception, makeArgumentsHost({ method: 'POST', url: '/x', headers: {}, ip: '1.2.3.4' }, response));
      expect(sendMock.mock.calls[0][0]).toHaveProperty('timestamp');
    });

    it('logs the error with response time', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);
      const request: Partial<FastifyRequest> = {
        method: 'DELETE',
        url: '/api/v1/resource',
        headers: { 'x-start-time': process.hrtime.bigint().toString() },
        ip: '127.0.0.1',
      };
      guard.catch(exception, makeArgumentsHost(request, response));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('DELETE /api/v1/resource'), 'HTTP');
    });

    it('handles missing x-start-time header gracefully', () => {
      const exception = new HttpException('Teapot', HttpStatus.I_AM_A_TEAPOT);
      const request: Partial<FastifyRequest> = { method: 'GET', url: '/t', headers: {}, ip: '1.2.3.4' };
      expect(() => guard.catch(exception, makeArgumentsHost(request, response))).not.toThrow();
    });

    it('handles x-start-time as an array', () => {
      const exception = new HttpException('OK', HttpStatus.OK);
      const request: Partial<FastifyRequest> = {
        method: 'GET',
        url: '/t',
        headers: { 'x-start-time': [process.hrtime.bigint().toString()] as unknown as string },
        ip: '1.2.3.4',
      };
      expect(() => guard.catch(exception, makeArgumentsHost(request, response))).not.toThrow();
    });
  });
});
