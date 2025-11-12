import { INestApplicationContext, Injectable } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-streams-adapter';
import { Server, ServerOptions } from 'socket.io';
import { RedisClientT, RedisService } from '../services/redis';

@Injectable()
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private redisService: RedisService<RedisClientT>;

  constructor(app: INestApplicationContext) {
    super(app);
    this.redisService = app.get(RedisService);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = await this.redisService.getClient();
    if (!pubClient) {
      throw new Error('Failed to get Redis client: pubClient is undefined.');
    }

    this.adapterConstructor = createAdapter(pubClient);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIOServer(port: number, options?: ServerOptions): any {
    if (options) {
      options.connectionStateRecovery = {
        maxDisconnectionDuration: 2 * 60 * 1000, // clients can reconnect within 2 minutes
        skipMiddlewares: true, // do not call middlewares again upon reconnection
      };
    }
    const server = super.createIOServer(port, options) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
