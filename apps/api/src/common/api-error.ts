import { randomUUID } from 'node:crypto';

import type { ErrorCode } from '@event-registration/contracts';
import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const parseContract = <T>(schema: ZodType<T>, value: unknown): T => {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Request validation failed',
        { fields: error.issues.map((issue) => issue.path.join('.')) },
      );
    }

    throw error;
  }
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'CONFLICT',
            'Request could not be completed',
          );
    const requestId = String(request.headers['x-request-id'] ?? randomUUID());

    response.status(apiError.status).json({
      error: {
        code: apiError.code,
        message: apiError.message,
        requestId,
        ...(apiError.details ? { details: apiError.details } : {}),
      },
    });
  }
}
