import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from '../../auth/session.service';
import { ACTOR_KEY } from '../actor';
import { ActorService } from '../actor.service';

export const COOKIE_ACCESS = 'zn_at';

/**
 * Verifies the `zn_at` cookie and attaches the Actor to the request.
 *
 * Every guarded route gets the Actor for free, so no controller has to reach
 * for cookies or re-derive roles. A missing or invalid token is always
 * `401 UNAUTHENTICATED` — the client refreshes and retries.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly session: SessionService,
    private readonly actors: ActorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = req.cookies?.[COOKIE_ACCESS];
    if (!token) throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });

    let personId: string;
    try {
      ({ sub: personId } = await this.session.verifyAccessToken(token));
    } catch {
      throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });
    }

    const actor = await this.actors.load(personId);
    // A valid token for a person who no longer exists (anonymised, merged) is
    // not a server error — it is simply not a session any more.
    if (!actor) throw new UnauthorizedException({ error: 'UNAUTHENTICATED' });

    Reflect.set(req, ACTOR_KEY, actor);
    return true;
  }
}
