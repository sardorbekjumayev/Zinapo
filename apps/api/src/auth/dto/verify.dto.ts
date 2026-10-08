import { IsString, Matches } from 'class-validator';

export class VerifyDto {
  @IsString()
  @Matches(/^lr_[A-Za-z0-9_-]{10,64}$/)
  requestId!: string;

  @IsString()
  @Matches(/^\d{5}$/)
  code!: string;
}

export class StatusQueryDto {
  @IsString()
  @Matches(/^lr_[A-Za-z0-9_-]{10,64}$/)
  requestId!: string;
}
