import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Actor, ChildAccess, CurrentActor, Guarded } from '../authz';
import { RedisService } from '../redis/redis.service';
import { GuardiansService } from './guardians.service';
import { PrivacyService } from './privacy.service';
import { INVITE_CODE, PhoneDto, TransferDto } from './dto/family.dto';

/**
 * task.md § 11: rate limits on invites. A co-guardian invite sends an SMS to a
 * number the owner typed, so it is a way to message strangers; 20 a day is
 * generous for a family and useless for spam.
 */
const INVITES_PER_DAY = 20;

/**
 * task.md § 6.1 — Family › Guardians, and the invitee's side of an invite.
 *
 * The owner side is `@ChildAccess('manage')`. The invitee side needs only a
 * session: the invite is bound to the invitee's verified phone, which is the
 * whole authorisation (see `GuardiansService.loadUsable`).
 */
@Controller('family')
@Guarded()
export class GuardiansController {
  constructor(
    private readonly guardians: GuardiansService,
    private readonly privacy: PrivacyService,
    private readonly redis: RedisService,
  ) {}

  @Get('children/:id/guardians')
  @ChildAccess('family_view')
  list(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.guardians.forChild(actor, id);
  }

  @Post('children/:id/co-guardian-invites')
  @ChildAccess('manage')
  async invite(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: PhoneDto) {
    await this.privacy.assertNotPending(id);
    await this.limit(actor);
    return this.guardians.inviteCoGuardian(actor, id, dto.phone);
  }

  @Delete('children/:id/guardian-invites/:inviteId')
  @ChildAccess('manage')
  @HttpCode(204)
  async cancelInvite(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('inviteId', new ParseUUIDPipe()) inviteId: string,
  ) {
    await this.guardians.cancelInvite(actor, id, inviteId);
  }

  @Delete('children/:id/guardians/:personId')
  @ChildAccess('manage')
  @HttpCode(204)
  async remove(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('personId', new ParseUUIDPipe()) personId: string,
  ) {
    await this.guardians.removeCoGuardian(actor, id, personId);
  }

  @Post('children/:id/ownership-transfer')
  @ChildAccess('manage')
  async offerTransfer(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: TransferDto) {
    await this.privacy.assertNotPending(id);
    await this.limit(actor);
    return this.guardians.offerTransfer(actor, id, dto);
  }

  @Delete('children/:id/ownership-transfer')
  @ChildAccess('manage')
  @HttpCode(204)
  async cancelTransfer(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.guardians.cancelTransfer(actor, id);
  }

  // --------------------------------------------------------- the invitee

  /** Invitations addressed to my own phone — onboarding offers them. */
  @Get('guardian-invites')
  incoming(@CurrentActor() actor: Actor) {
    return this.guardians.incoming(actor);
  }

  @Get('guardian-invites/:code')
  preview(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.guardians.preview(actor, checked(code));
  }

  @Post('guardian-invites/:code/accept')
  @HttpCode(200)
  accept(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.guardians.accept(actor, checked(code));
  }

  @Post('guardian-invites/:code/decline')
  @HttpCode(204)
  async decline(@CurrentActor() actor: Actor, @Param('code') code: string) {
    await this.guardians.decline(actor, checked(code));
  }

  private async limit(actor: Actor): Promise<void> {
    const key = `rl:guardian-invite:${actor.personId}`;
    const n = await this.redis.client.incr(key);
    if (n === 1) await this.redis.client.expire(key, 86_400);
    if (n > INVITES_PER_DAY) {
      throw new HttpException({ error: 'RATE_LIMITED' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function checked(code: string): string {
  if (!INVITE_CODE.test(code)) throw new NotFoundException({ error: 'INVITE_INVALID' });
  return code;
}
