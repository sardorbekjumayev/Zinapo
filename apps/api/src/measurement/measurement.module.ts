import { Module } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { ReportingService } from './reporting.service';
import { CalibrationController, ReportController } from './measurement.controller';

/**
 * task.md § 6 — `measurement` (calibration runs and the derived layer, written
 * by the job only) and `reporting` (the parent report read model).
 */
@Module({
  controllers: [ReportController, CalibrationController],
  providers: [MeasurementService, ReportingService],
  exports: [MeasurementService],
})
export class MeasurementModule {}
