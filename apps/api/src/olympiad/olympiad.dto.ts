import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { STAGE_ORDER } from './olympiad.common';

export class CreateOlympiadDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,48}$/)
  slug!: string;

  @IsString()
  @Length(2, 120)
  titleUz!: string;

  @IsString()
  @Length(2, 120)
  titleRu!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  gradeMin!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  gradeMax!: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  certificateTopPct?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  qualifyTopPct?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000)
  miniFinalTopN?: number;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  bonusRate?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  cupTopN?: number;
}

export class UpdateOlympiadDto {
  @IsOptional() @IsString() @Length(2, 120) titleUz?: string;
  @IsOptional() @IsString() @Length(2, 120) titleRu?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) gradeMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) gradeMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) certificateTopPct?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) qualifyTopPct?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) miniFinalTopN?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) bonusRate?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) cupTopN?: number;
}

export class StageDto {
  @IsDateString() opensAt!: string;
  @IsDateString() closesAt!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() registrationClosesAt?: string | null;
}

export const STAGE_KINDS = STAGE_ORDER as readonly string[];

export class StageFormDto {
  @IsUUID() formId!: string;
}

export class VenueDto {
  @IsUUID() stageId!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) regionId?: number | null;
  @IsString() @Length(2, 120) name!: string;
  @IsString() @Length(2, 300) address!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) capacity!: number;
  @IsDateString() startsAt!: string;
}

export class UpdateVenueDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(1) regionId?: number | null;
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(2, 300) address?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) capacity?: number;
  @IsOptional() @IsDateString() startsAt?: string;
}

export class ProctorDto {
  @IsString() @Length(7, 20) phone!: string;
}

export class RegisterDto {
  @IsOptional() @IsUUID() stageId?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() venueId?: string | null;
  /** /o/[slug]?src= — deep-link attribution. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @Length(1, 64) @Matches(/^[\w.-]+$/) source?: string | null;
}

export class CheckInDto {
  @IsUUID() entryId!: string;
  @IsBoolean() adultMatchesOwner!: boolean;
}

export class SyncAnswerDto {
  @IsUUID() itemVersionId!: string;
  @ValidateIf((_, v) => v !== null) @IsUUID() chosenOptionId!: string | null;
  @IsDateString() clientRecordedAt!: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Type(() => Number) @IsInt() @Min(0) responseMs?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) revisionCount?: number;
  @IsOptional() @IsBoolean() flagged?: boolean;
}

export class SyncSessionDto {
  @IsUUID() sessionId!: string;
  @IsDateString() startedAt!: string;
  @IsDateString() submittedAt!: string;
  @IsOptional() @IsString() @Length(0, 120) device?: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => SyncAnswerDto) answers!: SyncAnswerDto[];
}

export class SyncDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => SyncSessionDto) sessions!: SyncSessionDto[];
}

export class StageKindParam {
  @IsIn(STAGE_ORDER as unknown as string[]) kind!: string;
}
