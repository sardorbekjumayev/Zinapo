import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Actor, ChildAccess, ChildAccessResult, CurrentActor, Guarded, RequirePermission, ResolvedChild } from '../authz';
import { MeasurementService } from './measurement.service';
import { ReportingService } from './reporting.service';

class TriggerRunDto {
  @IsIn(['raw_band_v0', 'rasch_anchor_equating_v1'])
  method!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade?: number;
}

class RunsQueryDto {
  @IsOptional()
  @IsUUID()
  seasonId?: string;
}

/**
 * § 6.1 "GET /family/children/:id/report" — `parent_report` scope: a guardian,
 * or an educator for their OWN child only (§ 3). Everyone else gets 404.
 */
@Controller('family/children')
@Guarded()
export class ReportController {
  constructor(private readonly reporting: ReportingService) {}

  @Get(':id/report')
  @ChildAccess('parent_report')
  report(@ResolvedChild() access: ChildAccessResult) {
    return this.reporting.report(access);
  }
}

/** § 6.1 `/staff/calibration-runs` — the bank editor's (§ 8.5 "triggers calibration runs"). */
@Controller('staff/calibration-runs')
@Guarded()
export class CalibrationController {
  constructor(private readonly measurement: MeasurementService) {}

  @Get()
  @RequirePermission('calibration.run')
  list(@Query() q: RunsQueryDto) {
    return this.measurement.list(q.seasonId);
  }

  @Post()
  @RequirePermission('calibration.run')
  @HttpCode(202)
  trigger(@CurrentActor() actor: Actor, @Body() dto: TriggerRunDto) {
    return this.measurement.trigger(actor, dto.method, dto.grade);
  }

  @Post(':id/current')
  @RequirePermission('calibration.run')
  @HttpCode(200)
  current(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.measurement.makeCurrent(actor, id);
  }
}
