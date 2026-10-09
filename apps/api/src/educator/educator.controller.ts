import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import {
  Actor,
  ChildAccess,
  ChildAccessResult,
  CurrentActor,
  Guarded,
  RequireApprovedEducator,
  RequirePermission,
  ResolvedChild,
} from '../authz';
import { clientIp } from '../auth/cookies';
import { INVITE_CODE } from '../identity/dto/family.dto';
import { ApplicationService } from './application.service';
import { InvitesService } from './invites.service';
import { GroupsService } from './groups.service';
import { PracticeService } from './practice.service';
import {
  AccessRequestDto,
  ApplyDto,
  AssignDto,
  BuildPracticeDto,
  ChildIdsDto,
  CreateGroupDto,
  DecideApplicationDto,
  InvitesDto,
  MatchCheckDto,
  PreapproveDto,
  RemindDto,
  SwapDto,
  UpdateGroupDto,
} from './educator.dto';

/** § 6.1 Educator › Application — any signed-in person may apply. */
@Controller('educator')
@Guarded()
export class EducatorApplicationController {
  constructor(private readonly applications: ApplicationService) {}

  @Get('profile')
  profile(@CurrentActor() actor: Actor) {
    return this.applications.profile(actor);
  }

  @Post('apply')
  apply(@CurrentActor() actor: Actor, @Body() dto: ApplyDto) {
    return this.applications.apply(actor, dto);
  }
}

/**
 * § 6.1 Educator › Invites and access requests. Approved educators only
 * (403 otherwise — a capability, not a secret).
 */
@Controller('educator')
@Guarded()
@RequireApprovedEducator()
export class EducatorInvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Post('invites')
  @HttpCode(200)
  send(@CurrentActor() actor: Actor, @Body() dto: InvitesDto) {
    return this.invites.send(actor, dto.phones);
  }

  @Get('invites')
  list(@CurrentActor() actor: Actor) {
    return this.invites.list(actor);
  }

  @Post('invites/remind')
  @HttpCode(200)
  remind(@CurrentActor() actor: Actor) {
    return this.invites.remind(actor);
  }

  @Post('invites/:id/resend')
  @HttpCode(200)
  resend(@CurrentActor() actor: Actor, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.invites.resend(actor, id);
  }

  @Get('match-check/limits')
  limits(@CurrentActor() actor: Actor) {
    return this.invites.limits(actor);
  }

  @Post('match-check')
  @HttpCode(200)
  matchCheck(@CurrentActor() actor: Actor, @Body() dto: MatchCheckDto, @Req() req: Request) {
    return this.invites.matchCheck(actor, dto.pinfl, dto.familyName, clientIp(req) || null);
  }

  @Post('access-requests')
  requestAccess(@CurrentActor() actor: Actor, @Body() dto: AccessRequestDto) {
    return this.invites.requestAccess(actor, dto.matchToken);
  }
}

/** § 6.1 Educator › Groups and pupils. INV-15: every child read goes through the link view. */
@Controller('educator')
@Guarded()
@RequireApprovedEducator()
export class EducatorGroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get('groups')
  list(@CurrentActor() actor: Actor) {
    return this.groups.list(actor);
  }

  @Post('groups')
  create(@CurrentActor() actor: Actor, @Body() dto: CreateGroupDto) {
    return this.groups.create(actor, dto.name, dto.grade ?? null, dto.note ?? null);
  }

  @Patch('groups/:id')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(actor, id, dto);
  }

  @Post('groups/:id/members')
  @HttpCode(200)
  addMembers(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ChildIdsDto) {
    return this.groups.addMembers(actor, id, dto.childIds);
  }

  @Delete('groups/:id/members/:childId')
  removeMember(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('childId') childId: string) {
    return this.groups.removeMember(actor, id, childId);
  }

  @Get('groups/:id/overview')
  overview(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('waveId') waveId?: string) {
    return this.groups.overview(actor, id, waveId);
  }

  @Post('groups/:id/reminders')
  @HttpCode(200)
  remind(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RemindDto) {
    return this.groups.remind(actor, id, dto.childIds);
  }

  @Get('children')
  children(@CurrentActor() actor: Actor) {
    return this.groups.children(actor);
  }

  @Get('my-children')
  myChildren(@CurrentActor() actor: Actor) {
    return this.groups.myChildren(actor);
  }

  /** § 8.4.5 the pupil view — a 404 unless the link is ACTIVE (`educator_view`). */
  @Get('children/:id')
  @ChildAccess('educator_view')
  pupil(@CurrentActor() actor: Actor, @Param('id') id: string, @ResolvedChild() access: ChildAccessResult) {
    return this.groups.pupil(actor, id, access.canSeePercentile);
  }
}

/** § 6.1 Educator › Practice. */
@Controller('educator/practice')
@Guarded()
@RequireApprovedEducator()
export class EducatorPracticeController {
  constructor(private readonly practice: PracticeService) {}

  @Get('topics')
  topics(@Query('grade') grade: string) {
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 0 || g > 4) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.practice.topics(g);
  }

  @Post('forms')
  build(@CurrentActor() actor: Actor, @Body() dto: BuildPracticeDto) {
    return this.practice.build(actor, dto);
  }

  @Get('forms/:id')
  preview(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.practice.preview(actor, id);
  }

  @Post('forms/:id/swap')
  @HttpCode(200)
  swap(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SwapDto) {
    return this.practice.swap(actor, id, dto.position);
  }

  @Post('assignments')
  assign(@CurrentActor() actor: Actor, @Body() dto: AssignDto) {
    return this.practice.assign(actor, dto);
  }

  @Get('assignments')
  list(@CurrentActor() actor: Actor, @Query('groupId') groupId?: string) {
    return this.practice.list(actor, groupId && /^[0-9a-f-]{36}$/i.test(groupId) ? groupId : undefined);
  }

  @Get('assignments/:id/results')
  results(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.practice.results(actor, id);
  }

  @Post('assignments/:id/repeat')
  repeat(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ChildIdsDto) {
    return this.practice.repeat(actor, id, dto.childIds);
  }

  @Delete('assignments/:id')
  undo(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.practice.undo(actor, id);
  }
}

/** The family side of practice: the list ("count only") and starting a set in kid mode. */
@Controller('family/children')
@Guarded()
export class FamilyPracticeController {
  constructor(private readonly practice: PracticeService) {}

  @Get(':id/practice')
  @ChildAccess('family_view')
  list(@Param('id') id: string) {
    return this.practice.forChild(id);
  }

  @Post(':id/practice/:assignmentId/sessions')
  @ChildAccess('family_view')
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('assignmentId') assignmentId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.practice.start(actor, id, assignmentId);
  }
}

/** § 8.4.1 for trust & safety: decide applications, vouch for the first educators. */
@Controller('staff')
@Guarded()
@RequirePermission('educator.decide')
export class StaffEducatorController {
  constructor(private readonly applications: ApplicationService) {}

  @Get('educator-applications')
  list(@Query('status') status?: string) {
    return this.applications.applications(status === 'decided' ? 'decided' : 'applied');
  }

  @Post('educator-applications/:personId/decision')
  @HttpCode(200)
  decide(@CurrentActor() actor: Actor, @Param('personId') personId: string, @Body() dto: DecideApplicationDto) {
    if (!/^[0-9a-f-]{36}$/i.test(personId)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.applications.decide(actor, personId, dto.decision, dto.note?.trim() || null);
  }

  @Get('educator-preapprovals')
  preapprovals() {
    return this.applications.preapprovals();
  }

  @Post('educator-preapprovals')
  preapprove(@CurrentActor() actor: Actor, @Body() dto: PreapproveDto) {
    return this.applications.preapprove(actor, dto.phone, dto.kind ?? 'tutor', dto.note?.trim() || null);
  }

  @Delete('educator-preapprovals/:id')
  cancel(@CurrentActor() actor: Actor, @Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.applications.cancelPreapproval(actor, id);
  }
}

/** `/invite/[code]` before sign-in: who invited you (nothing for a dead code). */
@Controller('public')
export class PublicInviteController {
  constructor(private readonly invites: InvitesService) {}

  @Get('educator-invites/:code')
  preview(@Param('code') code: string) {
    if (!INVITE_CODE.test(code)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.invites.publicPreview(code);
  }
}
