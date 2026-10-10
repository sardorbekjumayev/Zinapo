import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type OutcomesMessages = typeof uz;

/** Copy for /staff/outcomes — admission list import, matching review and the validation summary (task.md § 8.5, § 9). */
export const outcomesMessages = forLocale<OutcomesMessages>({
  uz,
  ru: ru as OutcomesMessages,
  en: en as OutcomesMessages,
});
