import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type InvitesMessages = typeof uz;

/**
 * Copy for reaching parents and becoming an educator (design/10, task.md
 * § 8.4.1–2): /educator/invites, /invite/[code], /educator/apply, /educator/pending.
 */
export const invitesMessages = forLocale<InvitesMessages>({
  uz,
  ru: ru as InvitesMessages,
  en: en as InvitesMessages,
});
