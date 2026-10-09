import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Actor, ChildAccess, CurrentActor, Guarded, RequirePermission } from '../authz';
import { QueueService } from './queue.service';
import { CaseKind } from './cases.service';
import { AssignDto, DisputeDecisionDto, FifthDecisionDto, NoteDto, OptionalNoteDto, OwnerAnswerDto, RequiredNoteDto } from './trust.dto';

const KINDS: CaseKind[] = ['ownership_dispute', 'fifth_child', 'educator_application', 'fraud_flag'];

/**
 * § 6.1 Staff › Trust & safety — the one queue. Reading needs `case.read`,
 * deciding `case.resolve`, suspending an educator's links `link.suspend`
 * (all three are trust_safety's). Educator applications are decided with
 * M6's `/staff/educator-applications/:personId/decision`.
 */
@Controller('staff/cases')
@Guarded()
export class StaffCasesController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  @RequirePermission('case.read')
  list(@CurrentActor() actor: Actor, @Query('kind') kind?: string, @Query('bucket') bucket?: string, @Query('mine') mine?: string) {
    return this.queue.list(actor, {
      kind: KINDS.includes(kind as CaseKind) ? (kind as CaseKind) : undefined,
      bucket: bucket === 'waiting' || bucket === 'closed' ? bucket : 'open',
      mine: mine === '1' || mine === 'true',
    });
  }

  @Get('staff')
  @RequirePermission('case.read')
  staff() {
    return this.queue.staff();
  }

  @Get(':id')
  @RequirePermission('case.read')
  detail(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.queue.detail(actor, id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('case.resolve')
  assign(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.queue.assign(actor, id, dto.personId);
  }

  @Post(':id/notes')
  @RequirePermission('case.resolve')
  note(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.queue.note(actor, id, dto.body);
  }

  @Post(':id/suspend-links')
  @HttpCode(200)
  @RequirePermission('case.resolve', 'link.suspend')
  suspend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: OptionalNoteDto) {
    return this.queue.suspendLinks(actor, id, dto.note?.trim() || null);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RequirePermission('case.resolve')
  dismiss(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RequiredNoteDto) {
    return this.queue.dismiss(actor, id, dto.note.trim());
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermission('case.resolve', 'link.suspend')
  confirm(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RequiredNoteDto) {
    return this.queue.confirm(actor, id, dto.note.trim());
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('case.resolve')
  close(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: OptionalNoteDto) {
    return this.queue.close(actor, id, dto.note?.trim() || null);
  }

  @Post(':id/fifth-child')
  @HttpCode(200)
  @RequirePermission('case.resolve')
  fifth(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: FifthDecisionDto) {
    return this.queue.decideFifth(actor, id, dto.decision, dto.note?.trim() || null);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  @RequirePermission('case.resolve')
  dispute(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: DisputeDecisionDto) {
    return this.queue.decideDispute(actor, id, dto.decision, dto.note.trim());
  }
}

/** The family side: disputes (statements) and answering a suspended link. */
@Controller('family')
@Guarded()
export class FamilyTrustController {
  constructor(private readonly queue: QueueService) {}

  @Get('disputes')
  disputes(@CurrentActor() actor: Actor) {
    return this.queue.familyDisputes(actor);
  }

  @Get('disputes/:caseId')
  dispute(@CurrentActor() actor: Actor, @Param('caseId') caseId: string) {
    return this.queue.familyDispute(actor, caseId);
  }

  @Post('disputes/:caseId/statements')
  statement(@CurrentActor() actor: Actor, @Param('caseId') caseId: string, @Body() dto: NoteDto) {
    return this.queue.addStatement(actor, caseId, dto.body);
  }

  @Post('children/:id/educators/:linkId/answer')
  @HttpCode(200)
  @ChildAccess('manage')
  answer(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('linkId') linkId: string, @Body() dto: OwnerAnswerDto) {
    return this.queue.ownerAnswer(actor, id, linkId, dto.keep);
  }
}
