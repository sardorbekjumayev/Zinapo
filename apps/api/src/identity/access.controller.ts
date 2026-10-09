import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Actor, ChildAccess, CurrentActor, Guarded, RequirePermission } from '../authz';
import { AccessService } from './access.service';
import { PrivacyService } from './privacy.service';
import { ApproveAccessDto } from './dto/family.dto';

/**
 * task.md § 6.1 — Family › Educator access.
 *
 * The approve/decline routes are keyed by link id, not child id (that is the
 * § 6.1 shape), so the owner check lives in `AccessService.ownedLink`: the
 * link resolves only if the caller owns its child, and anything else is 404.
 */
@Controller('family')
@Guarded()
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get('children/:id/educators')
  @ChildAccess('family_view')
  list(@Param('id') id: string) {
    return this.access.forChild(id);
  }

  @Post('educator-requests/:linkId/approve')
  @HttpCode(200)
  approve(
    @CurrentActor() actor: Actor,
    @Param('linkId') linkId: string,
    @Body() dto: ApproveAccessDto,
  ) {
    return this.access.approve(actor, linkId, dto.validUntil);
  }

  @Post('educator-requests/:linkId/decline')
  @HttpCode(204)
  async decline(@CurrentActor() actor: Actor, @Param('linkId') linkId: string) {
    await this.access.decline(actor, linkId);
  }

  @Post('children/:id/educators/:linkId/revoke')
  @ChildAccess('manage')
  @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.access.revoke(actor, id, linkId);
  }

  @Post('children/:id/educators/:linkId/restore')
  @ChildAccess('manage')
  @HttpCode(200)
  restore(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('linkId') linkId: string) {
    return this.access.restore(actor, id, linkId);
  }
}

/**
 * § 3, "Request anonymisation — `super_admin` executes": runs a waiting request
 * now instead of after its grace window. The staff screen for it is M9.
 */
@Controller('staff/anonymisation-requests')
@Guarded()
export class StaffPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post(':id/execute')
  @RequirePermission('anonymisation.execute')
  @HttpCode(200)
  execute(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.privacy.executeNow(actor, id);
  }
}
