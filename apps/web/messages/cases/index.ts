import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type CasesMessages = typeof uz;

/** Copy for /staff/cases — the educator applications tab (task.md § 8.5, M6). */
export const casesMessages = forLocale<CasesMessages>({ uz, ru: ru as CasesMessages, en: en as CasesMessages });
