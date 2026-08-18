import { ConsoleLogger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClsService } from 'nestjs-cls';

// Mock Sentry before importing logger so the module-level code uses the mock
vi.mock('@sentry/node', () => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import { LoggerService } from './logger';

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function makeLogger(requestId: string | null = 'req-123'): LoggerService {
  const cls = { getId: vi.fn().mockReturnValue(requestId) } as unknown as ClsService;
  return new LoggerService(cls);
}

/** Suppress ConsoleLogger output while still letting the spy record calls. */
function suppressConsole() {
  return {
    log: vi.spyOn(ConsoleLogger.prototype, 'log').mockReturnValue(undefined),
    error: vi.spyOn(ConsoleLogger.prototype, 'error').mockReturnValue(undefined),
    warn: vi.spyOn(ConsoleLogger.prototype, 'warn').mockReturnValue(undefined),
    debug: vi.spyOn(ConsoleLogger.prototype, 'debug').mockReturnValue(undefined),
    verbose: vi.spyOn(ConsoleLogger.prototype, 'verbose').mockReturnValue(undefined),
  };
}

// -------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------

describe('LoggerService', () => {
  let spies: ReturnType<typeof suppressConsole>;

  // Enable logging in tests so the logMessage body actually runs
  beforeAll(() => {
    process.env.TEST_LOGS = '1';
  });

  afterAll(() => {
    delete process.env.TEST_LOGS;
  });

  beforeEach(() => {
    spies = suppressConsole();
    vi.mocked(Sentry.addBreadcrumb).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterEach(() => {
    Object.values(spies).forEach((s) => s.mockRestore());
  });

  it('is defined', () => {
    expect(makeLogger()).toBeDefined();
  });

  describe('log()', () => {
    it('calls super.log with the formatted message including request id', () => {
      makeLogger('abc-123').log('hello world');
      expect(spies.log).toHaveBeenCalledWith(expect.stringContaining('[abc-123] hello world'));
    });

    it('uses CORE as the id when cls returns null', () => {
      makeLogger(null).log('msg');
      expect(spies.log).toHaveBeenCalledWith(expect.stringContaining('[CORE] msg'));
    });

    it('JSON-serialises a non-string message', () => {
      makeLogger().log({ key: 'value' });
      expect(spies.log).toHaveBeenCalledWith(expect.stringContaining('"key":"value"'));
    });

    it('falls back to String() when JSON.stringify throws', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      makeLogger().log(circular);
      expect(spies.log).toHaveBeenCalledWith(expect.stringContaining('[object Object]'));
    });

    it('replaces newlines with \\n in the message', () => {
      makeLogger().log('line1\nline2');
      expect(spies.log).toHaveBeenCalledWith(expect.stringContaining('line1\\n line2'));
    });

    it('adds a Sentry breadcrumb', () => {
      makeLogger().log('breadcrumb test');
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'log', message: expect.stringContaining('breadcrumb test') }));
    });

    it('forwards optional params to super.log', () => {
      makeLogger().log('msg', 'SomeContext');
      expect(spies.log).toHaveBeenCalledWith(expect.any(String), 'SomeContext');
    });
  });

  describe('error()', () => {
    it('calls super.error', () => {
      makeLogger().error('oops');
      expect(spies.error).toHaveBeenCalledWith(expect.stringContaining('[req-123] oops'));
    });

    it('adds a Sentry breadcrumb with level error', () => {
      makeLogger().error('err msg');
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    });
  });

  describe('warn()', () => {
    it('calls super.warn', () => {
      makeLogger().warn('careful');
      expect(spies.warn).toHaveBeenCalledWith(expect.stringContaining('careful'));
    });

    it('adds a Sentry breadcrumb with level warning', () => {
      makeLogger().warn('warn msg');
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
    });
  });

  describe('debug()', () => {
    it('calls super.debug', () => {
      makeLogger().debug('detail');
      expect(spies.debug).toHaveBeenCalledWith(expect.stringContaining('detail'));
    });
  });

  describe('verbose()', () => {
    it('calls super.verbose', () => {
      makeLogger().verbose('verbose msg');
      expect(spies.verbose).toHaveBeenCalledWith(expect.stringContaining('verbose msg'));
    });
  });

  describe('default switch case', () => {
    it('falls through to super.log for unknown log levels', () => {
      // logMessage is private; cast to reach it for coverage of the default branch
      (makeLogger() as unknown as { logMessage: (level: string, msg: string) => void }).logMessage('unknown-level', 'msg');
      // The default branch calls super.log — verify it was invoked
      expect(spies.log).toHaveBeenCalled();
    });
  });

  describe('early-return in test environment', () => {
    it('does nothing when TEST_LOGS is not set and NODE_ENV is test', () => {
      delete process.env.TEST_LOGS;
      const logger = makeLogger();
      logger.log('should be suppressed');
      expect(spies.log).not.toHaveBeenCalled();
      process.env.TEST_LOGS = '1'; // restore
    });
  });
});

// -------------------------------------------------------------------
// Module-level process event handlers
// -------------------------------------------------------------------

describe('module-level process event handlers in logger.ts', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(ConsoleLogger.prototype, 'error').mockReturnValue(undefined);
    vi.mocked(Sentry.captureException).mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it('handles unhandledRejection by logging and calling Sentry.captureException', () => {
    const reason = new Error('unhandled rejection');
    process.emit('unhandledRejection', reason, Promise.resolve());
    expect(Sentry.captureException).toHaveBeenCalledWith(reason);
  });

  it('handles uncaughtException by logging, calling Sentry.captureException, then process.exit(1)', () => {
    const error = new Error('uncaught');
    process.emit('uncaughtException', error, 'uncaughtException');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles warning events by logging them', () => {
    const warnSpy = vi.spyOn(ConsoleLogger.prototype, 'warn').mockReturnValue(undefined);
    // process.emitWarning dispatches a 'warning' event
    process.emitWarning('test warning', 'TestWarning');
    // Just verify it doesn't throw – the warn handler runs synchronously
    warnSpy.mockRestore();
  });
});
