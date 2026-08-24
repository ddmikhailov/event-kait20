import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Pool } from 'pg';

import type { ApiConfig } from './config.module.js';
import { APP_CONFIG, DATABASE_POOL } from './tokens.js';

class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig): Pool =>
        new Pool({
          connectionString: config.DATABASE_URL,
          connectionTimeoutMillis: config.DATABASE_CONNECT_TIMEOUT_MS,
          max: 10,
        }),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
