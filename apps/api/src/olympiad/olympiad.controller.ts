import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Actor, ChildAccess, CurrentActor, Guarded, RequirePermission } from '../authz';
import { OlympiadAdminService } from './olympiad-admin.service';
import { OlympiadResultsService } from './olympiad-results.service';
import { FamilyOlympiadService } from './family-olympiad.service';
import { FinalsService } from './finals.service';
import { STAGE_ORDER, StageKind, UUID } from './olympiad.common';
import {
  CheckInDto,
  CreateOlympiadDto,
  ProctorDto,
  RegisterDto,
  StageDto,
  StageFormDto,
  SyncDto,
  UpdateOlympiadDto,
  UpdateVenueDto,
  VenueDto,
} from './olympiad.dto';

const uuid = (v: string) => {
  if (!UUID.test(v)) throw new NotFoundException({ error: 'NOT_FOUND' });
  return v;
};

/** § 6.1 Staff › Olympiads — the operator (`olympiad.manage`). */
@Controller('staff/olympiads')
@Guarded()
@RequirePermission('olympiad.manage')
export class StaffOlympiadController {
  constructor(private readonly admin: OlympiadAdminService) {}

  @Get()
  list() {
    return this.admin.list();
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateOlympiadDto) {
    return this.admin.create(actor, dto);
  }

  @Get('forms')
  forms(@Query('grade') grade?: string) {
    const g = grade === undefined ? undefined : Number(grade);
    return this.admin.forms(Number.isInteger(g) ? g : undefined);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.admin.detail(uuid(id));
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateOlympiadDto) {
    return this.admin.update(actor, uuid(id), dto);
  }

  @Put(':id/stages/:kind')
  stage(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('kind') kind: string, @Body() dto: StageDto) {
    if (!(STAGE_ORDER as readonly string[]).includes(kind)) throw new BadRequestException({ error: 'STAGE_KIND_INVALID' });
    return this.admin.upsertStage(actor, uuid(id), kind as StageKind, dto);
  }

  @Put(':id/stages/:stageId/forms/:grade')
  setForm(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Param('grade') grade: string,
    @Body() dto: StageFormDto,
  ) {
    const g = Number(grade);
    if (!Number.isInteger(g) || g < 0 || g > 4) throw new BadRequestException({ error: 'GRADE_INVALID' });
    return this.admin.setForm(actor, uuid(id), uuid(stageId), g, dto.formId);
  }

  @Get(':id/stages/:stageId/entries')
  entries(@Param('id') id: string, @Param('stageId') stageId: string) {
    return this.admin.entries(uuid(id), uuid(stageId));
  }

  @Post(':id/venues')
  createVenue(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: VenueDto) {
    return this.admin.createVenue(actor, uuid(id), { ...dto, regionId: dto.regionId ?? null });
  }

  @Patch(':id/venues/:venueId')
  updateVenue(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('venueId') venueId: string, @Body() dto: UpdateVenueDto) {
    return this.admin.updateVenue(actor, uuid(id), venueId, dto);
  }

  @Post(':id/venues/:venueId/proctors')
  addProctor(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('venueId') venueId: string, @Body() dto: ProctorDto) {
    return this.admin.addProctor(actor, uuid(id), venueId, dto.phone);
  }

  @Delete(':id/venues/:venueId/proctors/:personId')
  removeProctor(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('venueId') venueId: string, @Param('personId') personId: string) {
    return this.admin.removeProctor(actor, uuid(id), venueId, uuid(personId));
  }

  @Post(':id/venues/:venueId/notify')
  @HttpCode(200)
  notify(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('venueId') venueId: string) {
    return this.admin.sendVenueDetails(actor, uuid(id), venueId);
  }
}

/** Results, awards, publication (`olympiad.results`). */
@Controller('staff/olympiads')
@Guarded()
@RequirePermission('olympiad.results')
export class StaffOlympiadResultsController {
  constructor(private readonly results: OlympiadResultsService) {}

  @Post(':id/stages/:stageId/results')
  @HttpCode(200)
  compute(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.results.compute(actor, id, stageId);
  }

  @Post(':id/stages/:stageId/publish')
  @HttpCode(200)
  publish(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('stageId') stageId: string) {
    return this.results.publish(actor, id, stageId);
  }

  @Get(':id/awards')
  awards(@Param('id') id: string) {
    return this.results.awards(id);
  }
}

/** § 8.5 "Proctor" — only the venues this proctor is assigned to. */
@Controller('staff/finals')
@Guarded()
@RequirePermission('final.proctor')
export class StaffFinalsController {
  constructor(private readonly finals: FinalsService) {}

  @Get()
  mine(@CurrentActor() actor: Actor) {
    return this.finals.myVenues(actor);
  }

  @Get(':venueId')
  roster(@CurrentActor() actor: Actor, @Param('venueId') venueId: string) {
    return this.finals.roster(actor, venueId);
  }

  @Post(':venueId/check-in')
  @HttpCode(200)
  checkIn(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Body() dto: CheckInDto) {
    return this.finals.checkIn(actor, venueId, dto.entryId, dto.adultMatchesOwner);
  }

  @Delete(':venueId/check-in/:entryId')
  undo(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Param('entryId') entryId: string) {
    return this.finals.undoCheckIn(actor, venueId, entryId);
  }

  @Get(':venueId/package')
  package(@CurrentActor() actor: Actor, @Param('venueId') venueId: string) {
    return this.finals.package(actor, venueId);
  }

  @Post(':venueId/sync')
  @HttpCode(200)
  sync(@CurrentActor() actor: Actor, @Param('venueId') venueId: string, @Body() dto: SyncDto) {
    return this.finals.sync(actor, venueId, dto.sessions);
  }
}

/**
 * § 6.1 Family › Olympiad. Reading and starting an online stage: any live
 * guardian. Registering and cancelling: the owner only (§ 3 — the co-guardian
 * may not register).
 */
@Controller('family/children')
@Guarded()
export class FamilyOlympiadController {
  constructor(private readonly family: FamilyOlympiadService) {}

  @Get(':id/olympiad')
  @ChildAccess('family_view')
  overview(@Param('id') id: string) {
    return this.family.overview(id);
  }

  @Post(':id/olympiad/:olympiadId/register')
  @ChildAccess('manage')
  register(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('olympiadId') olympiadId: string, @Body() dto: RegisterDto) {
    return this.family.register(actor, id, olympiadId, dto);
  }

  @Delete(':id/olympiad/entries/:entryId')
  @ChildAccess('manage')
  cancel(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.family.cancel(actor, id, entryId);
  }

  @Post(':id/olympiad/entries/:entryId/sessions')
  @ChildAccess('family_view')
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('entryId') entryId: string) {
    return this.family.start(actor, id, entryId);
  }
}

/** `/o/[slug]` before sign-in. */
@Controller('public')
export class PublicOlympiadController {
  constructor(private readonly family: FamilyOlympiadService) {}

  @Get('olympiads/:slug')
  view(@Param('slug') slug: string) {
    if (!/^[a-z0-9][a-z0-9-]{2,48}$/.test(slug)) throw new NotFoundException({ error: 'NOT_FOUND' });
    return this.family.publicView(slug);
  }
}
