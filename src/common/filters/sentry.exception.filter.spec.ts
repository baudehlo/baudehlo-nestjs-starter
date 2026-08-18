import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ClsService } from 'nestjs-cls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Sentry
vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

// Stub out BaseExceptionFilter so we don't need ApplicationRef / HttpAdapterHost
vi.mock('@nestjs/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@nestjs/core')>();
  return {
    ...original,
    BaseExceptionFilter: class {
      catch() {
        return;
      }
    },
  };
});

import * as Sentry from '@sentry/node';
import { LoggerService } from 'src/logger/logger';
import { SentryExceptionFilter } from './sentry.exception.filter';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeLogger(): LoggerService {
  const cls = { getId: vi.fn().mockReturnValue('r1') } as unknown as ClsService;
  const logger = new LoggerService(cls);
  vi.spyOn(logger, 'log').mockReturnValue(undefined);
  vi.spyOn(logger, 'error').mockReturnValue(undefined);
  return logger;
}

function makeHost(statusFn: ReturnType<typeof vi.fn>): ArgumentsHost {
  const send = vi.fn();
  statusFn.mockReturnValue({ send });
  const response: Partial<FastifyReply> = { status: statusFn };
  return {
    switchToHttp: vi.fn().mockReturnValue({
      getResponse: vi.fn().mockReturnValue(response),
    }),
  } as unknown as ArgumentsHost;
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('SentryExceptionFilter', () => {
  let filter: SentryExceptionFilter;
  let logger: LoggerService;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Prevent any process.exit(1) calls from the constructor's event handlers
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    logger = makeLogger();
    filter = new SentryExceptionFilter(logger);
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    // Remove the listeners this filter instance added to keep the count stable
    process.removeAllListeners('unhandledRejection');
    process.removeAllListeners('uncaughtException');
  });

  it('instantiates successfully', () => {
    expect(filter).toBeInstanceOf(SentryExceptionFilter);
  });

  describe('catch()', () => {
    it('logs the exception as JSON', () => {
      const statusSpy = vi.fn();
      const host = makeHost(statusSpy);
      const exception = { code: 42, msg: 'bad' };

      filter.catch(exception, host);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"code":42'));
    });

    it('captures the exception with Sentry', () => {
      const statusSpy = vi.fn();
      const host = makeHost(statusSpy);

      filter.catch(new Error('sentry-test'), host);

      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
    });

    it('logs the stack trace when exception is an Error', () => {
      const statusSpy = vi.fn();
      const host = makeHost(statusSpy);
      const err = new Error('with stack');

      filter.catch(err, host);

      expect(logger.error).toHaveBeenCalledWith(err.stack);
    });

    it('sends a 500 response in non-production mode', () => {
      const statusSpy = vi.fn();
      const host = makeHost(statusSpy);

      filter.catch(new Error('test'), host);

      expect(statusSpy).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('recovers gracefully if response.send throws', () => {
      const send = vi.fn().mockImplementation(() => {
        throw new Error('send failed');
      });
      const statusSpy = vi.fn().mockReturnValue({ send });
      const response: Partial<FastifyReply> = { status: statusSpy };
      const host: ArgumentsHost = {
        switchToHttp: vi.fn().mockReturnValue({
          getResponse: vi.fn().mockReturnValue(response),
        }),
      } as unknown as ArgumentsHost;

      // Should not throw – the inner catch absorbs the error
      expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Catastrophic failure'));
    });
  });

  describe('constructor process event handlers', () => {
    it('handles unhandledRejection by logging and calling process.exit(1)', () => {
      const err = new Error('filter-unhandled');
      process.emit('unhandledRejection', err, Promise.resolve());
      // logger.error is called; exit is mocked
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles uncaughtException by logging and calling process.exit(1)', () => {
      const err = new Error('filter-uncaught');
      process.emit('uncaughtException', err, 'uncaughtException');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
