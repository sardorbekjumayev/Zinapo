import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type SeasonsMessages = typeof uz;

/** Copy for /staff/seasons — seasons, the wave calendar, reminders, schools (task.md § 8.5). */
export const seasonsMessages = forLocale<SeasonsMessages>({ uz, ru: ru as SeasonsMessages, en: en as SeasonsMessages });
