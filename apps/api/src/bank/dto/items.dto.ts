import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MISCONCEPTION_CODE, SKILL_CODE, TOPIC_CODE } from './taxonomy.dto';

export const STEM_FORMATS = ['text', 'image', 'image_audio'] as const;
export type StemFormat = (typeof STEM_FORMATS)[number];

/** A media ref is a key the API issued (`image/<uuid>.png`), never a path. */
const MEDIA_REF = /^(image|audio)\/[0-9a-f-]{36}\.(png|jpg|svg|mp3)$/;

export class CreateItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade!: number;

  @Matches(TOPIC_CODE)
  topicCode!: string;

  /** Required for grades 0–2 (the skill is their unit, INV-11). */
  @IsOptional()
  @Matches(SKILL_CODE)
  skillCode?: string;

  /** What a correct answer shows, one line (design/12). */
  @IsString()
  @Length(1, 300)
  construct!: string;
}

/**
 * One answer option as the editor holds it. In a draft anything may be blank;
 * `submit` is where completeness is enforced (and the schema re-checks INV-10).
 */
export class DraftOptionDto {
  @IsString()
  @Length(0, 500)
  labelUz!: string;

  @IsString()
  @Length(0, 500)
  labelRu!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(MEDIA_REF)
  imageRef?: string | null;

  @IsBoolean()
  isKey!: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @Matches(MISCONCEPTION_CODE)
  misconceptionCode?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  rationale?: string | null;
}

/** `PUT /staff/items/:id/draft` — every field optional, sent whole or in part. */
export class SaveDraftDto {
  // Item-level: only while no version of the item has ever been submitted.
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) grade?: number;
  @IsOptional() @Matches(TOPIC_CODE) topicCode?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(SKILL_CODE) skillCode?: string | null;
  @IsOptional() @IsString() @Length(1, 300) construct?: string;

  // Version-level.
  @IsOptional() @IsIn(STEM_FORMATS) stemFormat?: StemFormat;
  @IsOptional() @IsString() @Length(0, 4000) stemUz?: string;
  @IsOptional() @IsString() @Length(0, 4000) stemRu?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MEDIA_REF) imageRef?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MEDIA_REF) audioRefUz?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MEDIA_REF) audioRefRu?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1)
  expectedP?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => DraftOptionDto)
  options?: DraftOptionDto[];
}

export class ItemListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) grade?: number;
  @IsOptional() @IsIn(['numeracy', 'reasoning', 'language']) cluster?: string;
  @IsOptional() @IsIn(['draft', 'in_review', 'accepted', 'approved', 'rejected', 'retired']) status?: string;
  /** design/11 role filter: core, horizontal anchor, vertical anchor, pretest-only. */
  @IsOptional() @IsIn(['core', 'anchor_h', 'anchor_v', 'pretest']) role?: string;
  @IsOptional() @IsIn(['uz', 'ru']) lang?: string;
  @IsOptional() @Matches(TOPIC_CODE) topic?: string;
  /** Search by code, e.g. "G4-NUM-0137" or a fragment of it. */
  @IsOptional() @IsString() @Length(1, 40) q?: string;
  @IsOptional() @IsIn(['all', 'mine']) scope?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(100) perPage?: number;
}

export class SetAnchorDto {
  @IsBoolean()
  isAnchor!: boolean;

  @IsOptional()
  @IsIn(['horizontal', 'vertical'])
  kind?: 'horizontal' | 'vertical';
}

export class TargetDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(4) grade!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(5000) target!: number;
}

export class SetTargetsDto {
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => TargetDto)
  targets!: TargetDto[];
}
