import { Global, Module } from '@nestjs/common';
import { PinflService } from './pinfl.service';

/**
 * `identity` owns person, child, guardianship, consent and enrolment
 * (task.md § 6). M1 ships only `PinflService` — the INV-06 boundary — because
 * the seed and the add-child wizard both need it; the rest arrives with M2.
 *
 * Global so that no module can be tempted to re-implement PINFL hashing
 * locally just to avoid an import.
 */
@Global()
@Module({
  providers: [PinflService],
  exports: [PinflService],
})
export class IdentityModule {}
