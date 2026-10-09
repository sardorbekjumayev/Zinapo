import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type PracticeMessages = typeof uz;

/** Copy for the practice builder, the practice list and the family practice card (task.md § 8.4.6, M6). */
export const practiceMessages = forLocale<PracticeMessages>({
  uz,
  ru: ru as PracticeMessages,
  en: en as PracticeMessages,
});
