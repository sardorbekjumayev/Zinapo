import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type DisputesMessages = typeof uz;

/**
 * Copy for /family/disputes, the owner's answer to a suspended educator link on
 * /family/access, and the dispute entry points (task.md § 8.2, § 8.5, M8).
 */
export const disputesMessages = forLocale<DisputesMessages>({ uz, ru: ru as DisputesMessages, en: en as DisputesMessages });
