import { Global, Module } from '@nestjs/common';
import { PinflService } from './pinfl.service';
import { ChildrenService } from './children.service';
import { ConsentsService } from './consents.service';
import { GuardiansService } from './guardians.service';
import { AccessService } from './access.service';
import { PrivacyService } from './privacy.service';
import { ChangelogService } from './changelog.service';
import { FamilyNotifier } from './family-notifier.service';
import { SeasonLookup } from './season.lookup';
import { FamilyController } from './family.controller';
import { GuardiansController } from './guardians.controller';
import { AccessController, StaffPrivacyController } from './access.controller';
import { ReferenceController } from './reference.controller';

/**
 * `identity` owns person, child, guardianship, consent and enrolment, plus the
 * family side of educator access and the privacy job (task.md § 6, M2).
 *
 * Global so that no module can be tempted to re-implement PINFL hashing
 * locally just to avoid an import — `PinflService` is the INV-06 boundary.
 */
@Global()
@Module({
  controllers: [
    FamilyController,
    GuardiansController,
    AccessController,
    StaffPrivacyController,
    ReferenceController,
  ],
  providers: [
    PinflService,
    ChildrenService,
    ConsentsService,
    GuardiansService,
    AccessService,
    PrivacyService,
    ChangelogService,
    FamilyNotifier,
    SeasonLookup,
  ],
  exports: [PinflService, ChildrenService, SeasonLookup, FamilyNotifier],
})
export class IdentityModule {}
