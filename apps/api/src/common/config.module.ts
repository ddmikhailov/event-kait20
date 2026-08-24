import { parseApiEnvironment } from '@event-registration/config';
import { Global, Module } from '@nestjs/common';

import { APP_CONFIG } from './tokens.js';

export type ApiConfig = ReturnType<typeof parseApiEnvironment>;

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): ApiConfig => parseApiEnvironment(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ApiConfigModule {}
