import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type FamilyMessages = typeof uz;

/** Shared family copy: grades, roles, consent names, common buttons. */
export const familyMessages = forLocale<FamilyMessages>({ uz, ru: ru as FamilyMessages, en: en as FamilyMessages });
