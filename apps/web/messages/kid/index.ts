import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type KidMessages = typeof uz;

/** Kid-mode player: ready, test, review, done and their error states. */
export const kidMessages = forLocale<KidMessages>({ uz, ru: ru as KidMessages, en: en as KidMessages });
