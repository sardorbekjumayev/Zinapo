import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type ReportMessages = typeof uz;

/** Copy for the parent report on /family/children/[id] (task.md § 8.1.3, M5). */
export const reportMessages = forLocale<ReportMessages>({ uz, ru: ru as ReportMessages, en: en as ReportMessages });
