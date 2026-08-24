import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ApiExceptionFilter } from './common/api-error.js';
import type { ApiConfig } from './common/config.module.js';

export const configureApplication = (
  app: INestApplication,
  config: ApiConfig,
): void => {
  const trustedOrigins = new Set(config.CORS_ORIGINS);

  app.enableCors({
    credentials: true,
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      callback(null, Boolean(origin && trustedOrigins.has(origin)));
    },
  });
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
};
