import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type TrustMessages = typeof uz;

/** Copy for the staff trust & safety queue, /staff/cases and /staff/cases/[id] (task.md § 8.5, M8). */
export const trustMessages = forLocale<TrustMessages>({ uz, ru: ru as TrustMessages, en: en as TrustMessages });
