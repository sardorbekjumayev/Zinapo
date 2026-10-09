import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type OlympiadsMessages = typeof uz;

/** Copy for the olympiad operator's admin on /staff/olympiads (task.md § 8.5, M7). */
export const olympiadsMessages = forLocale<OlympiadsMessages>({
  uz,
  ru: ru as OlympiadsMessages,
  en: en as OlympiadsMessages,
});
