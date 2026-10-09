import { Module } from '@nestjs/common';
import { SeasonsService } from './seasons.service';
import { SeasonsController } from './seasons.controller';

/** task.md § 6 — `seasons`: season, wave, region, school. The season manager's. */
@Module({
  controllers: [SeasonsController],
  providers: [SeasonsService],
})
export class SeasonsModule {}
