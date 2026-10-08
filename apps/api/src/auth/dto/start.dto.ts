import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class StartDto {
  @IsString()
  @Length(4, 20)
  phone!: string;

  @IsOptional()
  @IsIn(['uz', 'ru', 'en'])
  lang?: 'uz' | 'ru' | 'en';
}
