import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Actor, CurrentActor, Guarded, RequirePermission, STAFF_ROLES, StaffRole } from '../authz';
import { AdminService } from './admin.service';
import { OutcomesService } from './outcomes.service';

class ImportDto {
  @IsString()
  @Length(1, 200)
  fileName!: string;

  /** The CSV text (≤ 50 000 rows; the body limit is raised for this route). */
  @IsString()
  @Length(1, 20_000_000)
  csv!: string;
}

class MatchDto {
  @IsUUID()
  childId!: string;
}

class GrantDto {
  @IsString()
  @Length(7, 20)
  phone!: string;

  @IsIn(STAFF_ROLES as unknown as string[])
  role!: StaffRole;
}

class CancelLoginDto {
  @IsString()
  @Length(7, 20)
  phone!: string;
}

class ResendDto {
  @IsOptional()
  @IsIn(['guardian', 'educator'])
  kind?: 'guardian' | 'educator';
}

const year = (y?: string) => {
  if (y === undefined || y === '') return undefined;
  const n = Number(y);
  if (!Number.isInteger(n) || n < 2020 || n > 2100) throw new BadRequestException({ error: 'YEAR_INVALID' });
  return n;
};

/** § 8.5 "Outcomes operator" (`outcome.import`). The PINFL in the file never leaves the service. */
@Controller('staff/outcomes')
@Guarded()
@RequirePermission('outcome.import')
export class OutcomesController {
  constructor(private readonly outcomes: OutcomesService) {}

  @Get()
  summary(@Query('year') y?: string) {
    return this.outcomes.summary(year(y));
  }

  @Post('import')
  @HttpCode(200)
  import(@CurrentActor() actor: Actor, @Body() dto: ImportDto) {
    return this.outcomes.import(actor, dto.fileName, dto.csv);
  }

  @Get('pending')
  pending(@Query('year') y?: string) {
    return this.outcomes.pending(year(y));
  }

  @Get(':id/candidates')
  candidates(@Param('id') id: string) {
    return this.outcomes.candidates(id);
  }

  @Post(':id/match')
  @HttpCode(200)
  match(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: MatchDto) {
    return this.outcomes.match(actor, id, dto.childId);
  }

  @Post(':id/not-zinapo')
  @HttpCode(200)
  notZinapo(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.outcomes.notZinapo(actor, id);
  }
}

/** § 8.5 "Support" (`person.lookup`, `invite.resend`, `login.reset`). */
@Controller('staff/people')
@Guarded()
export class SupportController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  @RequirePermission('person.lookup')
  lookup(@CurrentActor() actor: Actor, @Query('phone') phone?: string) {
    if (!phone) throw new BadRequestException({ error: 'PHONE_REQUIRED' });
    return this.admin.lookup(actor, phone);
  }

  @Post('invites/:id/resend')
  @HttpCode(200)
  @RequirePermission('invite.resend')
  resend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ResendDto) {
    return this.admin.resendInvite(actor, dto.kind ?? 'guardian', id);
  }

  @Post('login-requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('login.reset')
  cancelLogin(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CancelLoginDto) {
    return this.admin.cancelLogin(actor, dto.phone, id);
  }
}

/** § 8.5 "Super admin": staff roles (`role.manage`) and the audit log (`audit.read`). */
@Controller('staff')
@Guarded()
export class SuperAdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('roles')
  @RequirePermission('role.manage')
  roles() {
    return this.admin.roles();
  }

  @Post('roles')
  @RequirePermission('role.manage')
  grant(@CurrentActor() actor: Actor, @Body() dto: GrantDto) {
    return this.admin.grant(actor, dto.phone, dto.role);
  }

  @Delete('roles/:assignmentId')
  @RequirePermission('role.manage')
  revoke(@CurrentActor() actor: Actor, @Param('assignmentId') id: string) {
    return this.admin.revoke(actor, id);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  audit(
    @Query('action') action?: string,
    @Query('phone') phone?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const date = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? v : undefined);
    return this.admin.auditLog({
      action: action && /^[a-z_.]{1,60}$/.test(action) ? action : undefined,
      phone,
      from: date(from),
      to: date(to),
      before: before && /^\d+$/.test(before) ? Number(before) : undefined,
      limit: limit && /^\d+$/.test(limit) ? Number(limit) : undefined,
    });
  }

  @Get('audit/actions')
  @RequirePermission('audit.read')
  actions() {
    return this.admin.auditActions();
  }
}
