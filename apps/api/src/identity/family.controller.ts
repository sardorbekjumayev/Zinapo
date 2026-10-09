import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Actor, ChildAccess, CurrentActor, Guarded } from '../authz';
import { ChildrenService } from './children.service';
import { ConsentsService, CONSENT_TYPES, ConsentType } from './consents.service';
import { PrivacyService } from './privacy.service';
import { ChangelogService } from './changelog.service';
import { CreateChildDto, CreateEnrolmentDto, PatchChildDto } from './dto/children.dto';
import {
  AnonymisationRequestDto,
  ChangelogQueryDto,
  INVITE_CODE,
  SetConsentDto,
} from './dto/family.dto';

/**
 * task.md § 6.1 — Family: children, enrolment, consents, privacy, change log.
 *
 * Every child route declares its scope and `ChildAccessGuard` resolves it by
 * SQL before the handler runs (task.md § 4):
 *   family_view — any live guardian (a co-guardian sees, read-only)
 *   manage      — the owner only
 * A denial is a 404, so a stranger cannot learn that a child id exists.
 */
@Controller('family')
@Guarded()
export class FamilyController {
  constructor(
    private readonly children: ChildrenService,
    private readonly consents: ConsentsService,
    private readonly privacy: PrivacyService,
    private readonly changelog: ChangelogService,
  ) {}

  // ------------------------------------------------------------ children

  @Get('children')
  list(@CurrentActor() actor: Actor) {
    return this.children.listForParent(actor);
  }

  /** Whether the add-child door is open to this person (§ 3, note M2-c). */
  @Get('children/can-create')
  canCreate(@CurrentActor() actor: Actor) {
    return { canCreate: this.children.canCreate(actor) };
  }

  /**
   * 201 with the new id; 200 when the same owner re-submits their own child;
   * 202 FIFTH_CHILD_REVIEW and 409 CHILD_ALREADY_REGISTERED carry a case id.
   */
  @Post('children')
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateChildDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.children.create(actor, dto);
    res.status(result.alreadyYours ? 200 : 201);
    return result;
  }

  @Get('children/:id')
  @ChildAccess('family_view')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const child = await this.children.get(actor, id);
    if (!child) throw new NotFoundException({ error: 'NOT_FOUND' });
    return child;
  }

  @Patch('children/:id')
  @ChildAccess('manage')
  patch(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: PatchChildDto) {
    return this.children.patch(actor, id, dto);
  }

  @Get('children/:id/enrolments')
  @ChildAccess('family_view')
  enrolments(@Param('id') id: string) {
    return this.children.enrolments(id);
  }

  @Post('children/:id/enrolments')
  @ChildAccess('manage')
  async addEnrolment(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() dto: CreateEnrolmentDto,
  ) {
    await this.privacy.assertNotPending(id);
    await this.children.addEnrolment(actor, id, dto);
    return this.children.enrolments(id);
  }

  /** design/02 "Open an ownership dispute" — the claimant confirms the case. */
  @Post('ownership-disputes/:caseId/confirm')
  @HttpCode(200)
  confirmDispute(
    @CurrentActor() actor: Actor,
    @Param('caseId', new ParseUUIDPipe()) caseId: string,
  ) {
    return this.children.confirmDispute(actor, caseId);
  }

  /** The wizard's invite banner and access toggle (design/02). */
  @Get('educator-invites/:code')
  async previewEducatorInvite(@Param('code') code: string) {
    const preview = INVITE_CODE.test(code) ? await this.children.previewInvite(code) : null;
    if (!preview) throw new NotFoundException({ error: 'NOT_FOUND' });
    return preview;
  }

  // ------------------------------------------------------------ consents

  @Get('consents')
  allConsents(@CurrentActor() actor: Actor) {
    return this.consents.forActor(actor);
  }

  @Get('children/:id/consents')
  @ChildAccess('family_view')
  childConsents(@Param('id') id: string) {
    return this.consents.forChild(id);
  }

  @Put('children/:id/consents/:type')
  @ChildAccess('manage')
  setConsent(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('type') type: string,
    @Body() dto: SetConsentDto,
  ) {
    if (!(CONSENT_TYPES as string[]).includes(type)) {
      throw new NotFoundException({ error: 'NOT_FOUND' });
    }
    return this.consents.set(actor, id, type as ConsentType, dto.given);
  }

  // ------------------------------------------------------------- privacy

  @Get('children/:id/anonymisation-request')
  @ChildAccess('family_view')
  async anonymisation(@Param('id') id: string) {
    return { request: await this.privacy.current(id) };
  }

  @Post('children/:id/anonymisation-request')
  @ChildAccess('manage')
  @HttpCode(202)
  requestAnonymisation(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Body() dto: AnonymisationRequestDto,
  ) {
    return this.privacy.request(actor, id, dto.reason);
  }

  @Delete('children/:id/anonymisation-request')
  @ChildAccess('manage')
  @HttpCode(204)
  async cancelAnonymisation(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.privacy.cancel(actor, id);
  }

  // ---------------------------------------------------------- change log

  @Get('children/:id/changelog')
  @ChildAccess('family_view')
  changes(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Query() query: ChangelogQueryDto,
  ) {
    return this.changelog.forChild(actor, id, { limit: query.limit ?? 20, before: query.before });
  }
}
