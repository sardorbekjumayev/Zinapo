import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type FormsMessages = typeof uz;

/** Copy for /staff/forms and /staff/forms/[id] — the form builder (design/14). */
export const formsMessages = forLocale<FormsMessages>({ uz, ru: ru as FormsMessages, en: en as FormsMessages });
