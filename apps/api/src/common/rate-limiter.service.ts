import { Inject, Injectable } from '@nestjs/common';

import type { ApiConfig } from './config.module.js';
import { ApiError } from './api-error.js';
import { APP_CONFIG } from './tokens.js';

type RateBucket = { count: number; resetAt: number };

@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, RateBucket>();

  public constructor(@Inject(APP_CONFIG) private readonly config: ApiConfig) {}

  public consume(scope: string, clientKey: string): void {
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
    }
    const key = `${scope}:${clientKey}`;
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.config.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
      });
      return;
    }

    if (current.count >= this.config.AUTH_RATE_LIMIT_MAX) {
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests');
    }

    current.count += 1;
  }
}
