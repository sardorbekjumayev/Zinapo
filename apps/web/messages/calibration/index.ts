import uz from './uz.json';
import ru from './ru.json';
import en from './en.json';
import { forLocale } from '@/lib/ns';

export type CalibrationMessages = typeof uz;

/** Copy for /staff/calibration — the bank editor's calibration runs (task.md § 8.5, § 9). */
export const calibrationMessages = forLocale<CalibrationMessages>({
  uz,
  ru: ru as CalibrationMessages,
  en: en as CalibrationMessages,
});
