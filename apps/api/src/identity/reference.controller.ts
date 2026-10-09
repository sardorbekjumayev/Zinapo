import { Controller, Get, Query } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { Guarded } from '../authz';
import { SchoolsQueryDto } from './dto/family.dto';

/**
 * Regions and schools for the add-child wizard and the enrolment form.
 *
 * Reference data, but behind a session anyway: there is no public page that
 * needs it, and an open list of every school is an enumeration nobody asked
 * for. Season managers maintain it (M4).
 */
@Controller('reference')
@Guarded()
export class ReferenceController {
  constructor(private readonly db: DbService) {}

  @Get('regions')
  regions() {
    return this.db.query(
      `SELECT id, name_uz AS "nameUz", name_ru AS "nameRu" FROM region ORDER BY id`,
    );
  }

  @Get('schools')
  schools(@Query() query: SchoolsQueryDto) {
    return this.db.query(
      `SELECT id, name, district, kind FROM school WHERE region_id = $1 ORDER BY name LIMIT 500`,
      [query.regionId],
    );
  }
}
