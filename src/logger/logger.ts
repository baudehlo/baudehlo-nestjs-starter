// import { AuthOrgUserDto, AuthWorkerDto } from '@app/auth/dto/auth-user.dto';
import { ConsoleLogger, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ClsService } from 'nestjs-cls';
import { Environment } from '../common/enums';

const LevelMap: Record<string, Sentry.SeverityLevel> = {
  log: 'log',
  error: 'error',
  warn: 'warning',
  debug: 'debug',
  verbose: 'info',
};

@Injectable()
export class LoggerService extends ConsoleLogger {
  constructor(private readonly cls: ClsService) {
    super({
      colors: !process.env.NO_COLOR,
    });
  }

  private logMessage(level: string, message: unknown, ...optionalParams: unknown[]): void {
    if (process.env.NODE_ENV == Environment.test && !process.env.TEST_LOGS) {
      return;
    }

    let safeMessage: string;
    if (typeof message === 'string') {
      safeMessage = message;
    } else {
      try {
        safeMessage = JSON.stringify(message);
      } catch {
        safeMessage = String(message);
      }
    }
    const requestId = this.cls.getId();
    const formattedMessage = `[${requestId ?? 'CORE'}] ${safeMessage.replace(/[\r\n]+/g, '\\n ')}`;

    Sentry.addBreadcrumb({
      message: formattedMessage,
      level: LevelMap[level],
      data: {
        optionalParams,
      },
    });

    switch (level) {
      case 'log':
        super.log(formattedMessage, ...optionalParams);
        break;
      case 'error':
        super.error(formattedMessage, ...optionalParams);
        break;
      case 'warn':
        super.warn(formattedMessage, ...optionalParams);
        break;
      case 'debug':
        super.debug(formattedMessage, ...optionalParams);
        break;
      case 'verbose':
        super.verbose(formattedMessage, ...optionalParams);
        break;
      default:
        super.log(formattedMessage, ...optionalParams);
    }
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logMessage('log', message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logMessage('error', message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logMessage('warn', message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logMessage('debug', message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logMessage('verbose', message, ...optionalParams);
  }
}

const systemLogger = new ConsoleLogger('PROCESS');
process.on('warning', (warning) => {
  systemLogger.warn(warning.name, warning.message, warning.stack);
});
process.on('unhandledRejection', (reason, promise) => {
  systemLogger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  Sentry.captureException(reason);
});
process.on('uncaughtException', (error) => {
  systemLogger.error('Uncaught Exception thrown:', error.message, error.stack);
  Sentry.captureException(error);
  process.exit(1);
});
