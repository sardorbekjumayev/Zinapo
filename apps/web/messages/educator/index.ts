import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type EducatorMessages = typeof uz;

/** Copy for the teacher cabinet: groups, the pupil view, "My children" (task.md § 8.4, design/08, M6). */
export const educatorMessages = forLocale<EducatorMessages>({ uz, ru: ru as EducatorMessages, en: en as EducatorMessages });
