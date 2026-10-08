import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ACTOR_KEY, Actor } from '../actor';
import { ChildAccessResult, ChildPolicy, ChildScope } from '../policies/child.policy';

export const CHILD_ACCESS_KEY = 'znChildScope';
/** Where the resolved access lands on the request, for `@ResolvedChild()`. */
export const CHILD_ACCESS_RESULT = 'znChildAccess';

/**
 * Resolves `@ChildAccess(scope)`: takes the child id from the route and asks
 * `ChildPolicy`. A denial is `404 NOT_FOUND` — task.md § 4: never reveal that a
 * child exists to someone with no relationship to them. That makes "no such
 * child" and "not your child" indistinguishable, which is the point.
 */
@Injectable()
export class ChildAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly children: ChildPolicy,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<ChildScope>(CHILD_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const actor = Reflect.get(req, ACTOR_KEY) as Actor | undefined;
    if (!actor) throw new NotFoundException({ error: 'NOT_FOUND' });

    const params = req.params as Record<string, string | undefined>;
    const childId = params.childId ?? params.id;
    if (!childId || !UUID.test(childId)) throw new NotFoundException({ error: 'NOT_FOUND' });

    const access = await this.children.check(actor, childId, scope);
    if (!access) throw new NotFoundException({ error: 'NOT_FOUND' });

    Reflect.set(req, CHILD_ACCESS_RESULT, access);
    return true;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
