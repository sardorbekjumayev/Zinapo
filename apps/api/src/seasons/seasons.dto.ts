import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

export class CreateSeasonDto {
  /** '2027/28' */
  @Matches(/^\d{4}\/\d{2}$/)
  code!: string;

  @IsString() @Length(1, 120) nameUz!: string;
  @IsString() @Length(1, 120) nameRu!: string;
  @IsDateString() startsOn!: string;
  @IsDateString() endsOn!: string;

  @IsOptional() @IsBoolean() makeCurrent?: boolean;
}

export class PatchSeasonDto {
  @IsOptional() @IsString() @Length(1, 120) nameUz?: string;
  @IsOptional() @IsString() @Length(1, 120) nameRu?: string;
  @IsOptional() @IsDateString() startsOn?: string;
  @IsOptional() @IsDateString() endsOn?: string;
}

/**
 * `POST /staff/waves` sets wave N of a grade: creates it, or moves its window
 * while it has not opened yet. One wave per (season, grade, ordinal).
 */
export class UpsertWaveDto {
  @IsOptional() @IsUUID() seasonId?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(4) grade!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(8) ordinal!: number;
  @IsDateString() opensAt!: string;
  @IsDateString() closesAt!: string;
  /** A frozen monitoring form of the same grade (INV-14 trigger checks it). */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() formId?: string | null;
}

export class PatchWaveDto {
  @IsOptional() @IsDateString() opensAt?: string;
  @IsOptional() @IsDateString() closesAt?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() formId?: string | null;
}

export class WaveQueryDto {
  @IsOptional() @IsUUID() seasonId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) grade?: number;
}

export class SchoolDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(14) regionId!: number;
  @IsIn(['general', 'presidential', 'specialised', 'private', 'other']) kind!: string;
  @IsString() @Length(2, 200) name!: string;
  @IsOptional() @IsString() @Length(0, 120) district?: string;
}

export class PatchSchoolDto {
  @IsOptional() @IsIn(['general', 'presidential', 'specialised', 'private', 'other']) kind?: string;
  @IsOptional() @IsString() @Length(2, 200) name?: string;
  @IsOptional() @IsString() @Length(0, 120) district?: string;
}

export class SchoolQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(14) regionId!: number;
  @IsOptional() @IsString() @Length(1, 80) q?: string;
}
