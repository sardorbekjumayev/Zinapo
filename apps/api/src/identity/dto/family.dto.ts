import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsUUID,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * A phone as the parent types it. Normalised and checked to be Uzbek in the
 * service (`toE164`), so "90 312 45 67" and "+998903124567" are the same.
 */
export class PhoneDto {
  @IsString()
  @Length(7, 20)
  phone!: string;
}

/**
 * Ownership goes to a current co-guardian. The access page knows them by
 * person id; the permission matrix (and anyone scripting it) by phone. Either
 * identifies the same row — the service checks it is a live co-guardian.
 */
export class TransferDto {
  @IsOptional()
  @IsString()
  @Length(7, 20)
  phone?: string;

  @IsOptional()
  @IsUUID()
  personId?: string;
}

export class ApproveAccessDto {
  /** The last day of access, `YYYY-MM-DD`. INV-05: always set. */
  @IsDateString()
  validUntil!: string;
}

export class SetConsentDto {
  @IsBoolean()
  given!: boolean;
}

export class AnonymisationRequestDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class ChangelogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Cursor: the id of the last entry already shown. */
  @IsOptional()
  @Matches(/^\d{1,18}$/)
  before?: string;
}

export class SchoolsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  regionId!: number;
}

/** Guardian and educator invite codes are base64url tokens. */
export const INVITE_CODE = /^[A-Za-z0-9_-]{4,64}$/;
