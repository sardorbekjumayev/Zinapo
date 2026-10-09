import { Module } from '@nestjs/common';
import { TaxonomyService } from './taxonomy.service';
import { ItemsService } from './items.service';
import { ReviewService } from './review.service';
import { FormsService } from './forms.service';
import { CandidatesRepository } from './candidates.repository';
import { FormsController, ItemsController, ReviewController, TaxonomyController } from './bank.controllers';

/**
 * task.md § 6 — `bank` (taxonomy, items, versions, options, review) and
 * `forms` (assembly, rule checks, freeze). One Nest module for both because
 * forms are made of item versions and share the candidate query (INV-08).
 *
 * `CandidatesRepository` is exported for M6's practice builder: there is one
 * door into a form, and anchors cannot pass through it into practice.
 */
@Module({
  controllers: [TaxonomyController, ItemsController, ReviewController, FormsController],
  providers: [TaxonomyService, ItemsService, ReviewService, FormsService, CandidatesRepository],
  exports: [CandidatesRepository, FormsService],
})
export class BankModule {}
