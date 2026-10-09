import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
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
import { TOPIC_CODE } from './taxonomy.dto';

export class CreateFormDto {
  @IsIn(['monitoring', 'practice', 'olympiad'])
  mode!: 'monitoring' | 'practice' | 'olympiad';

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade!: number;

  @IsString()
  @Length(1, 120)
  label!: string;

  /** design/14 "Create from template": pre-places the positions and their roles. */
  @IsOptional()
  @IsBoolean()
  template?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(4 * 3600)
  timeLimitSec?: number;
}

export class PlanSlotDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  position!: number;

  @IsIn(['scored', 'anchor', 'pretest'])
  role!: 'scored' | 'anchor' | 'pretest';
}

export class SetPlanDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => PlanSlotDto)
  plan!: PlanSlotDto[];
}

export class FillSlotDto {
  /** null clears the position. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  itemVersionId!: string | null;
}

export class CandidatesQueryDto {
  @IsOptional() @IsIn(['numeracy', 'reasoning', 'language']) cluster?: string;
  @IsOptional() @Matches(TOPIC_CODE) topic?: string;
  @IsOptional() @IsString() @Length(1, 40) q?: string;
}

export class FormListQueryDto {
  @IsOptional() @IsIn(['monitoring', 'practice', 'olympiad']) mode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(4) grade?: number;
}

export class SolveDto {
  @IsUUID()
  optionId!: string;
}

export class VerdictDto {
  @IsIn(['accept', 'revise', 'reject'])
  verdict!: 'accept' | 'revise' | 'reject';

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}
