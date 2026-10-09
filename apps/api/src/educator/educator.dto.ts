import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_PHONES_PER_BATCH } from './invites.service';
import { MAX_SET_SIZE } from './practice.service';

export class ApplyDto {
  @IsIn(['tutor', 'school_teacher', 'learning_centre'])
  kind!: 'tutor' | 'school_teacher' | 'learning_centre';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  regionId!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  schoolId?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(['numeracy', 'reasoning', 'language'], { each: true })
  subjects!: string[];
}

export class DecideApplicationDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class PreapproveDto {
  @IsString()
  @Length(7, 20)
  phone!: string;

  @IsOptional()
  @IsIn(['tutor', 'school_teacher', 'learning_centre'])
  kind?: 'tutor' | 'school_teacher' | 'learning_centre';

  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

export class InvitesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PHONES_PER_BATCH)
  @IsString({ each: true })
  @Length(0, 40, { each: true })
  phones!: string[];
}

export class MatchCheckDto {
  @IsString()
  @Length(14, 14)
  pinfl!: string;

  @IsString()
  @Length(1, 80)
  familyName!: string;
}

export class AccessRequestDto {
  @IsString()
  @Length(20, 64)
  matchToken!: string;
}

export class CreateGroupDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade?: number | null;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 300)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ChildIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsUUID('all', { each: true })
  childIds!: string[];
}

export class RemindDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @IsUUID('all', { each: true })
  childIds?: string[];
}

export class BuildPracticeDto {
  @IsIn(['misconception', 'topic'])
  source!: 'misconception' | 'topic';

  @IsString()
  @Length(1, 80)
  code!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  grade!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(MAX_SET_SIZE)
  size?: number;
}

export class SwapDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  position!: number;
}

export class AssignDto {
  @IsUUID()
  formId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @IsUUID('all', { each: true })
  childIds!: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  groupId?: string | null;
}
