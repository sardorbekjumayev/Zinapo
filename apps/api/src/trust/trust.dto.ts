import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class AssignDto {
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  personId!: string | null;
}

export class NoteDto {
  @IsString()
  @Length(1, 4000)
  body!: string;
}

export class RequiredNoteDto {
  @IsString()
  @Length(3, 2000)
  note!: string;
}

export class OptionalNoteDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}

export class FifthDecisionDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;
}

export class DisputeDecisionDto {
  @IsIn(['keep', 'transfer'])
  decision!: 'keep' | 'transfer';

  @IsString()
  @Length(3, 2000)
  note!: string;
}

export class OwnerAnswerDto {
  @IsBoolean()
  keep!: boolean;
}
