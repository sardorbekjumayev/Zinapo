import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type AccessMessages = typeof uz;

/** Copy for /family/access, /family/consents and /family/privacy (design/06). */
export const accessMessages = forLocale<AccessMessages>({ uz, ru: ru as AccessMessages, en: en as AccessMessages });
