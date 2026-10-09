import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type FinalsMessages = typeof uz;

/** Copy for the proctor console and the offline runner (task.md § 8.5 "Proctor", § 11, M7). */
export const finalsMessages = forLocale<FinalsMessages>({ uz, ru: ru as FinalsMessages, en: en as FinalsMessages });
