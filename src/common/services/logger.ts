// import { AuthOrgUserDto, AuthWorkerDto } from '@app/auth/dto/auth-user.dto';
import { Environment } from '../enums';
import { ConsoleLogger } from '@nestjs/common';
// import * as Sentry from '@sentry/node';

// const LevelMap: Record<string, Sentry.SeverityLevel> = {
//   log: 'log',
//   error: 'error',
//   warn: 'warning',
//   debug: 'debug',
//   verbose: 'info',
// };

export class Logger extends ConsoleLogger {
  private logMessage(
    level: string,
    message: unknown,
    ...optionalParams: unknown[]
  ): void {
    if (process.env.NODE_ENV == Environment.test && !process.env.TEST_LOGS) {
      return;
    }
    // Sentry.addBreadcrumb({
    //   message,
    //   level: LevelMap[level],
    //   data: {
    //     optionalParams,
    //   },
    // });

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
    const formattedMessage = safeMessage.replace(/[\r\n]+/g, '\\n ');
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

// export class IdealUserLogger extends IdealLogger {
//   private prependUserId(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//   ): string {
//     let userId = '';
//     if (user && user.hasOwnProperty('worker')) {
//       userId = (<AuthWorkerDto>user).worker.id as string;
//     } else if (user && user.hasOwnProperty('orgUser')) {
//       userId = (<AuthOrgUserDto>user).orgUser.id;
//     }
//     return `[${userId}] ${message}`;
//   }

//   log(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//     ...optionalParams: any[]
//   ): void {
//     message = this.prependUserId(user, message);
//     super.log(message, ...optionalParams);
//   }

//   error(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//     ...optionalParams: any[]
//   ): void {
//     message = this.prependUserId(user, message);
//     super.error(message, ...optionalParams);
//   }

//   warn(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//     ...optionalParams: any[]
//   ): void {
//     message = this.prependUserId(user, message);
//     super.warn(message, ...optionalParams);
//   }

//   debug(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//     ...optionalParams: any[]
//   ): void {
//     message = this.prependUserId(user, message);
//     super.debug(message, ...optionalParams);
//   }

//   verbose(
//     user: AuthWorkerDto | AuthOrgUserDto,
//     message: any,
//     ...optionalParams: any[]
//   ): void {
//     message = this.prependUserId(user, message);
//     super.verbose(message, ...optionalParams);
//   }
// }
