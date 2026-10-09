import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type ReviewMessages = typeof uz;

/** Copy for /staff/review — two-hand review (design/13). */
export const reviewMessages = forLocale<ReviewMessages>({ uz, ru: ru as ReviewMessages, en: en as ReviewMessages });
