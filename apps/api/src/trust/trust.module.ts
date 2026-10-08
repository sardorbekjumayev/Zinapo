import { Global, Module } from '@nestjs/common';
import { CasesService } from './cases.service';

/**
 * task.md § 6 (`trust`). M2 ships only the case-opening half: add-child needs
 * to open an ownership dispute or a fifth-child review. The queue UI, the fraud
 * rules job and the resolutions are M8.
 */
@Global()
@Module({
  providers: [CasesService],
  exports: [CasesService],
})
export class TrustModule {}
