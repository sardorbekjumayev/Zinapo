import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type AdminMessages = typeof uz;

/** Copy for the M9 support and super admin screens: /staff/people, /staff/roles, /staff/audit (task.md § 8.5). */
export const adminMessages = forLocale<AdminMessages>({ uz, ru: ru as AdminMessages, en: en as AdminMessages });
