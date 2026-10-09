import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type WizardMessages = typeof uz;

/** The add-child wizard (design/02-add-child.html). */
export const wizardMessages = forLocale<WizardMessages>({ uz, ru: ru as WizardMessages, en: en as WizardMessages });
