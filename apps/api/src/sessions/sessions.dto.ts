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
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class StartSessionDto {
  @IsUUID()
  waveId!: string;
}

/** One answer as the device recorded it (§ 8.3: response_ms, revision_count, client time). */
export class AnswerDto {
  @IsUUID()
  itemVersionId!: string;

  /** null = skipped, or an answer cleared again. */
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  chosenOptionId!: string | null;

  @IsOptional()
  @IsBoolean()
  flagged?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  revisionCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  responseMs?: number;

  @IsDateString()
  clientRecordedAt!: string;
}

export class AnswersBatchDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];

  @IsOptional() @IsString() @Length(0, 120) device?: string;
  @IsOptional() @IsString() @Length(0, 60) os?: string;
  @IsOptional() @IsString() @Length(0, 40) clientVersion?: string;
}

export class SubmitDto extends AnswersBatchDto {
  /** The device was offline when the child finished; this is the later sync. */
  @IsOptional()
  @IsBoolean()
  offline?: boolean;
}
