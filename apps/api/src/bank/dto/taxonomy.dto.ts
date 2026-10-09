import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

/** `num.addsub`, `rea.space` — cluster prefix, dot, slug (005_reference_data.sql). */
export const TOPIC_CODE = /^(num|rea|lan)\.[a-z0-9_]{2,30}$/;
/** `s.addsub.10` */
export const SKILL_CODE = /^s\.[a-z0-9_]{2,30}(\.[a-z0-9_]{1,30})?$/;
/** `m.borrow.skip` */
export const MISCONCEPTION_CODE = /^m\.[a-z0-9_]{2,30}(\.[a-z0-9_]{1,30})?$/;

export const CLUSTERS = ['numeracy', 'reasoning', 'language'] as const;
export type Cluster = (typeof CLUSTERS)[number];

class Names {
  @IsString()
  @Length(1, 120)
  nameUz!: string;

  @IsString()
  @Length(1, 120)
  nameRu!: string;
}

export class CreateTopicDto extends Names {
  @Matches(TOPIC_CODE)
  code!: string;

  @IsIn(CLUSTERS)
  cluster!: Cluster;

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sort?: number;
}

export class PatchTopicDto {
  @IsOptional() @IsString() @Length(1, 120) nameUz?: string;
  @IsOptional() @IsString() @Length(1, 120) nameRu?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) gradeMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) gradeMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(9999) sort?: number;
}

export class CreateSkillDto extends Names {
  @Matches(SKILL_CODE)
  code!: string;

  @Matches(TOPIC_CODE)
  topicCode!: string;

  /** Skills are the grade 0–2 instrument (task.md § 1.9, INV-11). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2)
  grade!: number;
}

export class PatchSkillDto {
  @IsOptional() @IsString() @Length(1, 120) nameUz?: string;
  @IsOptional() @IsString() @Length(1, 120) nameRu?: string;
}

export class CreateMisconceptionDto extends Names {
  @Matches(MISCONCEPTION_CODE)
  code!: string;

  @Matches(TOPIC_CODE)
  topicCode!: string;

  /** Written for the parent, not the psychometrician. */
  @IsString()
  @Length(1, 600)
  explainUz!: string;

  @IsString()
  @Length(1, 600)
  explainRu!: string;
}

export class PatchMisconceptionDto {
  @IsOptional() @IsString() @Length(1, 120) nameUz?: string;
  @IsOptional() @IsString() @Length(1, 120) nameRu?: string;
  @IsOptional() @IsString() @Length(1, 600) explainUz?: string;
  @IsOptional() @IsString() @Length(1, 600) explainRu?: string;
}
