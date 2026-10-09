import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type WavesMessages = typeof uz;

/** Copy for the family "waves" card on /family/children/[id] (task.md § 8.1.4). */
export const wavesMessages = forLocale<WavesMessages>({ uz, ru: ru as WavesMessages, en: en as WavesMessages });
