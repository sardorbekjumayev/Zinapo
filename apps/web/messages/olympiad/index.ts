import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type OlympiadMessages = typeof uz;

/** Copy for the parent's olympiad page and the public landing (task.md § 8.1.6, M7). */
export const olympiadMessages = forLocale<OlympiadMessages>({ uz, ru: ru as OlympiadMessages, en: en as OlympiadMessages });
