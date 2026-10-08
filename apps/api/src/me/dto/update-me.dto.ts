import { IsIn, IsOptional, IsString, Length } from 'class-validator';

/** Locales: uz-Latn and ru ship; `kaa` is wired and empty (task.md § 7.1). */
export const LOCALES = ['uz', 'ru', 'en', 'kaa'] as const;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @IsIn(LOCALES)
  locale?: (typeof LOCALES)[number];
}

export class SetWorkspaceDto {
  @IsIn(['family', 'educator', 'staff'])
  workspace!: 'family' | 'educator' | 'staff';
}
