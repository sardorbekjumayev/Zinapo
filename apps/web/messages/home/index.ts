import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type HomeMessages = typeof uz;

/** Family home, child page, guardian-invite landing. */
export const homeMessages = forLocale<HomeMessages>({ uz, ru: ru as HomeMessages, en: en as HomeMessages });
