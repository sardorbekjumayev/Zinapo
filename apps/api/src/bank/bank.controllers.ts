import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Actor, CurrentActor, Guarded, RequirePermission, RequireStaffRole } from '../authz';
import { TaxonomyService } from './taxonomy.service';
import { ItemsService } from './items.service';
import { ReviewService } from './review.service';
import { FormsService } from './forms.service';
import {
  CreateMisconceptionDto,
  CreateSkillDto,
  CreateTopicDto,
  PatchMisconceptionDto,
  PatchSkillDto,
  PatchTopicDto,
} from './dto/taxonomy.dto';
import { CreateItemDto, ItemListQueryDto, SaveDraftDto, SetAnchorDto, SetTargetsDto } from './dto/items.dto';
import {
  CandidatesQueryDto,
  CreateFormDto,
  FillSlotDto,
  FormListQueryDto,
  SetPlanDto,
  SolveDto,
  VerdictDto,
} from './dto/forms.dto';

/** Everyone who works on items reads the taxonomy; only the bank editor changes it (M3-d). */
const BANK_PEOPLE = ['item_author', 'item_reviewer', 'bank_editor'] as const;

/** task.md § 6.1 — `/staff/taxonomy`. */
@Controller('staff/taxonomy')
@Guarded()
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  @RequireStaffRole(...BANK_PEOPLE)
  all() {
    return this.taxonomy.all();
  }

  @Post('topics')
  @RequirePermission('taxonomy.manage')
  createTopic(@CurrentActor() actor: Actor, @Body() dto: CreateTopicDto) {
    return this.taxonomy.createTopic(actor, dto);
  }

  @Patch('topics/:code')
  @RequirePermission('taxonomy.manage')
  patchTopic(@CurrentActor() actor: Actor, @Param('code') code: string, @Body() dto: PatchTopicDto) {
    return this.taxonomy.patchTopic(actor, code, dto);
  }

  @Post('skills')
  @RequirePermission('taxonomy.manage')
  createSkill(@CurrentActor() actor: Actor, @Body() dto: CreateSkillDto) {
    return this.taxonomy.createSkill(actor, dto);
  }

  @Patch('skills/:code')
  @RequirePermission('taxonomy.manage')
  patchSkill(@CurrentActor() actor: Actor, @Param('code') code: string, @Body() dto: PatchSkillDto) {
    return this.taxonomy.patchSkill(actor, code, dto);
  }

  @Post('misconceptions')
  @RequirePermission('taxonomy.manage')
  createMisconception(@CurrentActor() actor: Actor, @Body() dto: CreateMisconceptionDto) {
    return this.taxonomy.createMisconception(actor, dto);
  }

  @Patch('misconceptions/:code')
  @RequirePermission('taxonomy.manage')
  patchMisconception(@CurrentActor() actor: Actor, @Param('code') code: string, @Body() dto: PatchMisconceptionDto) {
    return this.taxonomy.patchMisconception(actor, code, dto);
  }

  @Post('misconceptions/:code/retire')
  @RequirePermission('taxonomy.manage')
  @HttpCode(200)
  retire(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.taxonomy.setMisconceptionRetired(actor, code, true);
  }

  @Post('misconceptions/:code/restore')
  @RequirePermission('taxonomy.manage')
  @HttpCode(200)
  restore(@CurrentActor() actor: Actor, @Param('code') code: string) {
    return this.taxonomy.setMisconceptionRetired(actor, code, false);
  }
}

/**
 * task.md § 6.1 — `/staff/items`. An author reads and writes only their own
 * items (`ItemsService` filters and checks); reviewers and the bank editor read
 * the whole bank. Approval, retirement and anchors are the bank editor's.
 */
@Controller('staff/items')
@Guarded()
export class ItemsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @RequireStaffRole(...BANK_PEOPLE)
  list(@CurrentActor() actor: Actor, @Query() q: ItemListQueryDto) {
    return this.items.list(actor, q);
  }

  @Put('targets')
  @RequirePermission('item.approve')
  setTargets(@CurrentActor() actor: Actor, @Body() dto: SetTargetsDto) {
    return this.items.setTargets(actor, dto.targets);
  }

  @Post()
  @RequireStaffRole('item_author', 'bank_editor')
  create(@CurrentActor() actor: Actor, @Body() dto: CreateItemDto) {
    return this.items.create(actor, dto);
  }

  @Get(':id')
  @RequireStaffRole(...BANK_PEOPLE)
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.items.get(actor, id);
  }

  @Put(':id/draft')
  @RequireStaffRole('item_author', 'bank_editor')
  saveDraft(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SaveDraftDto) {
    return this.items.saveDraft(actor, id, dto);
  }

  @Post(':id/submit')
  @RequireStaffRole('item_author', 'bank_editor')
  @HttpCode(200)
  submit(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.items.submit(actor, id);
  }

  /** "Create a new version" — the only way to change a frozen version (INV-09). */
  @Post(':id/versions')
  @RequireStaffRole('item_author', 'bank_editor')
  newVersion(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.items.newVersion(actor, id);
  }

  @Post(':id/approve')
  @RequirePermission('item.approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.items.approve(actor, id);
  }

  @Post(':id/retire')
  @RequirePermission('item.approve')
  @HttpCode(200)
  retire(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.items.retire(actor, id);
  }

  @Put(':id/anchor')
  @RequirePermission('item.approve')
  setAnchor(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SetAnchorDto) {
    return this.items.setAnchor(actor, id, dto);
  }
}

/** task.md § 6.1 — `/staff/review-queue`, `/staff/reviews`. */
@Controller('staff')
@Guarded()
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('review-queue')
  @RequirePermission('item.review')
  queue(@CurrentActor() actor: Actor) {
    return this.review.queue(actor);
  }

  @Get('reviews/:versionId')
  @RequirePermission('item.review')
  open(@CurrentActor() actor: Actor, @Param('versionId') versionId: string) {
    return this.review.open(actor, versionId);
  }

  @Post('reviews/:versionId/solve')
  @RequirePermission('item.review')
  @HttpCode(200)
  solve(@CurrentActor() actor: Actor, @Param('versionId') versionId: string, @Body() dto: SolveDto) {
    return this.review.solve(actor, versionId, dto.optionId);
  }

  @Post('reviews/:versionId/verdict')
  @RequirePermission('item.review')
  @HttpCode(200)
  verdict(@CurrentActor() actor: Actor, @Param('versionId') versionId: string, @Body() dto: VerdictDto) {
    return this.review.decide(actor, versionId, dto.verdict, dto.note);
  }
}

/** task.md § 6.1 — `/staff/forms` (+ rules, freeze). The bank editor's. */
@Controller('staff/forms')
@Guarded()
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequirePermission('form.build')
  list(@Query() q: FormListQueryDto) {
    return this.forms.list(q);
  }

  @Post()
  @RequirePermission('form.build')
  create(@CurrentActor() actor: Actor, @Body() dto: CreateFormDto) {
    return this.forms.create(actor, dto);
  }

  @Get(':id')
  @RequirePermission('form.build')
  get(@Param('id') id: string) {
    return this.forms.get(id);
  }

  @Get(':id/rules')
  @RequirePermission('form.build')
  async rules(@Param('id') id: string) {
    const form = await this.forms.get(id);
    return { rules: form.rules, canFreeze: form.canFreeze };
  }

  @Put(':id/plan')
  @RequirePermission('form.build')
  setPlan(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SetPlanDto) {
    return this.forms.setPlan(actor, id, dto.plan);
  }

  @Get(':id/positions/:position/candidates')
  @RequirePermission('form.build')
  candidates(
    @Param('id') id: string,
    @Param('position', ParseIntPipe) position: number,
    @Query() q: CandidatesQueryDto,
  ) {
    return this.forms.candidatesFor(id, position, q);
  }

  @Put(':id/positions/:position')
  @RequirePermission('form.build')
  fill(
    @CurrentActor() actor: Actor,
    @Param('id') id: string,
    @Param('position', ParseIntPipe) position: number,
    @Body() dto: FillSlotDto,
  ) {
    return this.forms.fill(actor, id, position, dto.itemVersionId);
  }

  @Post(':id/freeze')
  @RequirePermission('form.freeze')
  @HttpCode(200)
  freeze(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.forms.freeze(actor, id);
  }

  @Post(':id/copy')
  @RequirePermission('form.build')
  copy(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.forms.copy(actor, id);
  }
}
