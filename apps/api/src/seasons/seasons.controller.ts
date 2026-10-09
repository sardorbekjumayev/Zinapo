import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Actor, CurrentActor, Guarded, RequirePermission } from '../authz';
import { SeasonsService } from './seasons.service';
import {
  CreateSeasonDto,
  PatchSchoolDto,
  PatchSeasonDto,
  PatchWaveDto,
  SchoolDto,
  SchoolQueryDto,
  UpsertWaveDto,
  WaveQueryDto,
} from './seasons.dto';

/** task.md § 6.1 — `/staff/seasons`, `/staff/waves`, plus schools. The season manager's. */
@Controller('staff')
@Guarded()
export class SeasonsController {
  constructor(private readonly seasons: SeasonsService) {}

  @Get('seasons')
  @RequirePermission('season.manage')
  list() {
    return this.seasons.seasons();
  }

  @Post('seasons')
  @RequirePermission('season.manage')
  create(@CurrentActor() actor: Actor, @Body() dto: CreateSeasonDto) {
    return this.seasons.createSeason(actor, dto);
  }

  @Patch('seasons/:id')
  @RequirePermission('season.manage')
  patch(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PatchSeasonDto) {
    return this.seasons.patchSeason(actor, id, dto);
  }

  @Post('seasons/:id/current')
  @RequirePermission('season.manage')
  @HttpCode(200)
  current(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.seasons.makeCurrent(actor, id);
  }

  @Get('waves')
  @RequirePermission('season.manage')
  waves(@Query() q: WaveQueryDto) {
    return this.seasons.waves(q);
  }

  @Get('waves/forms/:grade')
  @RequirePermission('season.manage')
  forms(@Param('grade', ParseIntPipe) grade: number) {
    return this.seasons.formsFor(grade);
  }

  @Post('waves')
  @RequirePermission('season.manage')
  upsert(@CurrentActor() actor: Actor, @Body() dto: UpsertWaveDto) {
    return this.seasons.upsertWave(actor, dto);
  }

  @Patch('waves/:id')
  @RequirePermission('season.manage')
  patchWave(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PatchWaveDto) {
    return this.seasons.patchWave(actor, id, dto);
  }

  @Post('waves/:id/reminders')
  @RequirePermission('reminder.bulk')
  @HttpCode(200)
  remind(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.seasons.remind(actor, id);
  }

  @Get('schools')
  @RequirePermission('season.manage')
  schools(@Query() q: SchoolQueryDto) {
    return this.seasons.schools(q.regionId, q.q);
  }

  @Post('schools')
  @RequirePermission('season.manage')
  createSchool(@CurrentActor() actor: Actor, @Body() dto: SchoolDto) {
    return this.seasons.createSchool(actor, dto);
  }

  @Patch('schools/:id')
  @RequirePermission('season.manage')
  patchSchool(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: PatchSchoolDto) {
    return this.seasons.patchSchool(actor, id, dto);
  }
}
