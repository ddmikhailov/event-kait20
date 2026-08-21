import 'reflect-metadata';

import { parseApiEnvironment } from '@event-registration/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

const bootstrap = async () => {
  const environment = parseApiEnvironment(process.env);
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    credentials: true,
    origin: environment.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
  });

  await app.listen(environment.API_PORT);
  Logger.log(`API listening on port ${environment.API_PORT}`, 'Bootstrap');
};

void bootstrap();
