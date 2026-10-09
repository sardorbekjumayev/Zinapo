import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Actor, ChildAccess, CurrentActor, Guarded, RequireWorkspace } from '../authz';
import { SessionsService } from './sessions.service';
import { AnswersBatchDto, BeginDto, StartSessionDto, SubmitDto } from './sessions.dto';

/**
 * § 6.1 Family › "Reports and sessions": the child's waves and starting one at
 * home. `family_view` is any live guardian — the owner and the co-guardian may
 * both launch (§ 3), an educator may not from here.
 */
@Controller('family/children')
@Guarded()
export class FamilySessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id/waves')
  @ChildAccess('family_view')
  waves(@Param('id') id: string) {
    return this.sessions.wavesFor(id);
  }

  @Post(':id/sessions')
  @ChildAccess('family_view')
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: StartSessionDto) {
    return this.sessions.start(actor, id, dto.waveId, 'home');
  }
}

/**
 * § 3 "Launch a monitoring session — educator: linked child, in office". The
 * educator's door: `educator_view` resolves only through an ACTIVE link
 * (`v_educator_visible_child`, INV-15). The educator workspace UI is M6.
 */
@Controller('educator/children')
@Guarded()
export class EducatorSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post(':id/sessions')
  @RequireWorkspace('educator')
  @ChildAccess('educator_view')
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: StartSessionDto) {
    return this.sessions.start(actor, id, dto.waveId, 'educator_office');
  }
}

/** § 6.1 "Kid mode / sessions" — shared by family, educator and (M7) proctor. */
@Controller('sessions')
@Guarded()
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id/bundle')
  bundle(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sessions.bundle(actor, id);
  }

  /** The child pressed Start: the clock begins now (idempotent). */
  @Post(':id/begin')
  @HttpCode(200)
  begin(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: BeginDto) {
    return this.sessions.begin(actor, id, dto.language);
  }

  @Post(':id/responses')
  @HttpCode(200)
  responses(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AnswersBatchDto) {
    return this.sessions.saveAnswers(actor, id, dto.answers, dto);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SubmitDto) {
    return this.sessions.submit(actor, id, dto.answers, dto);
  }

  @Get(':id/result')
  result(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sessions.result(actor, id);
  }
}
