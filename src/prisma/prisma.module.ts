import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { CacheModule } from '@nestjs/cache-manager';
import { Logger } from 'src/common/services/logger';

@Global()
@Module({
  imports: [CacheModule.register()],
  providers: [Logger, PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {
  // with the help of `DynamicModule` we can import `PrismaModule` with existing client.
  static forTest(prismaClient: PrismaClient): DynamicModule {
    return {
      module: PrismaModule,
      providers: [
        {
          provide: PrismaService,
          useFactory: () => prismaClient as PrismaService,
        },
      ],
      exports: [PrismaService],
    };
  }
}
