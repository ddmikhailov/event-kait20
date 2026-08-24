import type { StaffRoleContract } from '@event-registration/contracts';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ApiError } from '../common/api-error.js';
import type { ApiConfig } from '../common/config.module.js';
import { APP_CONFIG, STAFF_SESSION_COOKIE } from '../common/tokens.js';
import { AuthService } from './auth.service.js';
import type { StaffRequest } from './auth.types.js';

const ROLES_KEY = 'staff-roles';

export const RequireRoles = (...roles: StaffRoleContract[]) =>
  SetMetadata(ROLES_KEY, roles);

export const readCookie = (
  request: Request,
  name: string,
): string | undefined => {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const [cookieName, ...valueParts] = part.trim().split('=');
    if (cookieName === name) return decodeURIComponent(valueParts.join('='));
  }

  return undefined;
};

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const rawToken = readCookie(request, STAFF_SESSION_COOKIE);

    if (!rawToken) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
    }

    request.auth = await this.auth.authenticate(rawToken);
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<StaffRoleContract[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<StaffRequest>();
    if (!roles.includes(request.auth.user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient permission');
    }

    return true;
  }
}

@Injectable()
export class OriginCsrfGuard implements CanActivate {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: ApiConfig,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    const origin = request.headers.origin;
    if (!origin || !this.config.CORS_ORIGINS.includes(origin)) {
      throw new ApiError(
        403,
        'ORIGIN_NOT_TRUSTED',
        'Request origin is not trusted',
      );
    }

    const rawToken = readCookie(request, STAFF_SESSION_COOKIE);
    if (!rawToken) return true;

    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || !this.auth.verifyCsrf(rawToken, csrf)) {
      throw new ApiError(403, 'CSRF_INVALID', 'CSRF validation failed');
    }

    return true;
  }
}
