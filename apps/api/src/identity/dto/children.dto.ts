import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** 14 digits, first in 1–6 (century + sex). The rest is checked in the service. */
const PINFL = /^[1-6]\d{13}$/;

export class CreateChildDto {
  @Matches(PINFL, { message: 'PINFL_MALFORMED' })
  pinfl!: string;

  @IsString()
  @Length(1, 120)
  familyName!: string;

  @IsString()
  @Length(1, 120)
  givenName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  patronymic?: string;

  @IsDateString()
  dob!: string;

  @IsInt()
  @Min(0)
  @Max(4)
  grade!: number;

  /** The SCHOOL's region, not the home address (task.md § 8.2). */
  @IsInt()
  @Min(1)
  @Max(14)
  schoolRegionId!: number;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  /**
   * `data_processing` is required; the other two are optional and independent
   * (task.md § 8.2). Sent together with the child so the profile is never
   * created without the consent that legitimises it.
   */
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ConsentInputDto)
  consents!: ConsentInputDto[];

  /**
   * Set when the parent arrived from an educator invite and left the access
   * toggle on. The educator is identified by the invite, never by a free-form
   * id — an educator must not be able to grant themselves access.
   */
  @IsOptional()
  @IsString()
  @Length(4, 64)
  inviteCode?: string;

  @IsOptional()
  @IsBoolean()
  shareWithInviter?: boolean;
}

export class ConsentInputDto {
  @Matches(/^(data_processing|third_party_transfer|marketing)$/)
  type!: 'data_processing' | 'third_party_transfer' | 'marketing';

  @IsBoolean()
  given!: boolean;
}

export class PatchChildDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  familyName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  givenName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  patronymic?: string;
}

/**
 * A new enrolment rather than an edit: the history is what lets a report say
 * "moved school in January" and keeps an old wave's cohort stable (the session
 * snapshots region and grade anyway).
 */
export class CreateEnrolmentDto {
  @IsInt()
  @Min(2025)
  @Max(2100)
  schoolYear!: number;

  @IsInt()
  @Min(0)
  @Max(4)
  grade!: number;

  @IsInt()
  @Min(1)
  @Max(14)
  schoolRegionId!: number;

  @IsOptional()
  @IsUUID()
  schoolId?: string;
}
