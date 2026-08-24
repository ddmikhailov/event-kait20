import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { ApiConfig } from './common/config.module.js';
import { APP_CONFIG } from './common/tokens.js';

const bootstrap = async () => {
  const app = await NestFactory.create(AppModule);
  const environment = app.get<ApiConfig>(APP_CONFIG);

  configureApplication(app, environment);

  await app.listen(environment.API_PORT);
  Logger.log(`API listening on port ${environment.API_PORT}`, 'Bootstrap');
};

void bootstrap();
