import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type BankMessages = typeof uz;

/** Item bank list (design/11) and taxonomy copy. */
export const bankMessages = forLocale<BankMessages>({ uz, ru: ru as BankMessages, en: en as BankMessages });
