import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type EditorMessages = typeof uz;

/** Copy for /staff/items/new and /staff/items/[id] (design/12). */
export const editorMessages = forLocale<EditorMessages>({ uz, ru: ru as EditorMessages, en: en as EditorMessages });
