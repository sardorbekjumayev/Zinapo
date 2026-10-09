import { Template } from './notify.types';

type Vars = Record<string, string | number>;

/** Formatting the templates need and the caller cannot know: the recipient's locale. */
interface Fmt {
  /** An ISO date (`2027-05-31…`) as words in the recipient's language; anything else as is. */
  date: (value: string | number | undefined) => string;
}

type Dict = Record<Template, (v: Vars, f: Fmt) => string>;

/**
 * task.md § 10. The voice is the one from `design/*.html`: plain, specific, and
 * it never shows a score or a PINFL.
 *
 * Each message answers three things in order — what happened, to which child,
 * and what the parent can do about it. A notification a parent cannot act on is
 * a notification we should not have sent.
 */

const uz: Dict = {
  educator_invite: (v) =>
    `${v.educator} sizni Zinapoʻga taklif qildi (kod ${v.code}).\n\n` +
    `Kirib, farzandingizni qoʻshasiz va ustoz nimani koʻrishini oʻzingiz hal qilasiz.\n${v.link}`,

  access_requested: (v, f) =>
    `${v.educator} ${v.child}ning hisobotlarini koʻrish uchun ruxsat soʻradi.\n\n` +
    `Ruxsat bersangiz, u natijalar va xato turlarini koʻradi; PINFL, telefon raqamingiz va boshqa farzandlaringizni koʻrmaydi.\n\n` +
    `Soʻrov ${f.date(v.expires)} gacha amal qiladi: ${v.link}`,

  access_granted: (v, f) =>
    `${v.child} uchun ruxsat berildi: ${v.educator}, ${f.date(v.until)} gacha.\n\n` +
    `Muddat tugagach, ruxsat oʻzi yopiladi. Istalgan vaqtda oʻchirishingiz mumkin.`,

  access_revoked: (v) =>
    `${v.child} uchun ruxsat oʻchirildi: ${v.educator}.\n\n` +
    `U endi hisobotlarni koʻrmaydi. Xohlasangiz, keyinroq qayta berishingiz mumkin.`,

  access_expiring: (v, f) =>
    `${v.educator}ning ${v.child} hisobotlariga ruxsati ${f.date(v.until)} da tugaydi (${v.days} kun qoldi).\n\n` +
    `Davom ettirishni xohlasangiz, “Ruxsat va roziliklar” boʻlimida muddatni uzaytirasiz.`,

  co_guardian_invite: (v) =>
    `${v.inviter} sizni ${v.child} profiliga ikkinchi vasiy sifatida qoʻshmoqchi.\n\n` +
    `Qabul qilsangiz, hisobotlarni koʻrasiz va monitoringni boshlab berasiz. Roziliklar va ruxsatlarni esa profil egasi boshqaradi.\n${v.link}`,

  ownership_transfer: (v) =>
    `${v.inviter} ${v.child} profilining egaligini sizga oʻtkazmoqchi.\n\n` +
    `Qabul qilsangiz, roziliklar va ustozlarga ruxsat berish sizga oʻtadi. ${v.inviter} ikkinchi vasiy boʻlib qoladi.\n${v.link}`,

  co_guardian_joined: (v) =>
    `${v.guardian} ${v.child} profiliga ikkinchi vasiy sifatida qoʻshildi.\n\n` +
    `U hisobotlarni koʻradi, lekin roziliklar va ruxsatlarni oʻzgartira olmaydi. Istalgan vaqtda olib tashlashingiz mumkin.`,

  guardian_removed: (v) =>
    `${v.child} profiliga kirishingiz yopildi. Buni profil egasi ${v.owner} qildi.\n\n` +
    `Xato deb hisoblasangiz, u bilan bogʻlaning.`,

  ownership_changed: (v) =>
    `${v.child} profilining egasi endi ${v.owner}.\n\n` +
    `Roziliklar va ustozlarga ruxsat berishni endi u boshqaradi. ${v.previous} ikkinchi vasiy boʻlib qoldi.`,

  consent_changed: (v) =>
    `${v.child}: “${consentName('uz', v.consent)}” roziligi ${v.given ? 'berildi' : 'qaytarib olindi'}.` +
    (v.consent === 'data_processing' && !v.given
      ? `\n\nMonitoring toʻxtatildi. Oldingi natijalar saqlanadi.`
      : ''),

  anonymisation_requested: (v, f) =>
    `${v.child} maʼlumotlarini oʻchirish soʻraldi.\n\n` +
    `${f.date(v.executeAfter)} gacha soʻrovni bekor qilish mumkin, keyin profil anonimlashtiriladi: ism, PINFL va hisobotlar oʻchadi, barcha ruxsatlar yopiladi.\n${v.link}`,

  anonymisation_cancelled: (v) =>
    `${v.child} maʼlumotlarini oʻchirish soʻrovi bekor qilindi. Profil avvalgidek ishlaydi.`,

  anonymisation_done: (v) =>
    `Soʻrovingiz bajarildi: ${v.child} profili anonimlashtirildi.\n\n` +
    `Ism, PINFL va hisobotlar oʻchirildi. Savollarga javoblar hech kimga bogʻlanmagan holda faqat savollar statistikasi uchun qoldi.`,

  educator_access_granted: (v, f) =>
    `${v.child}ning ota-onasi hisobotlarni koʻrishga ruxsat berdi — ${f.date(v.until)} gacha.\n${v.link}`,

  educator_access_ended: (v) =>
    `${v.child} hisobotlariga ruxsatingiz yopildi.\n\nBolaning tarixi u bilan qoladi; ota-onasi xohlasa, ruxsatni qayta beradi.`,

  wave_open: (v) =>
    `${v.child} uchun ${v.wave} ochildi va ${v.closes} da yopiladi.\n\n` +
    `Uyda yoki ustoz huzurida topshirish mumkin — 30 daqiqacha vaqt oladi.\n${v.link}`,

  wave_reminder: (v) =>
    `${v.child} ${v.wave} ni hali topshirmagan. ${v.closes} da yopiladi.\n\n` +
    `Topshirmasa, bu monitoring “topshirilmagan” deb qoladi — nol deb hisoblanmaydi, lekin oʻsishni koʻrsatmaydi.\n${v.link}`,

  report_ready: (v) =>
    `${v.child} uchun ${v.wave} hisoboti tayyor.\n\n${v.link}`,

  olympiad_registered: (v) =>
    `${v.child} ${v.olympiad} ga roʻyxatdan oʻtdi.\n\n${v.details}`,

  final_venue_details: (v) =>
    `${v.olympiad} yakuniy bosqichi: ${v.date}, ${v.venue}.\n${v.address}\n\n` +
    `${v.child} bilan voyaga yetgan hamroh kelishi shart. Hamroh profil egasi boʻlmasa, bu qayd etiladi.`,

  case_needs_owner_confirmation: (v) =>
    `${v.child} profiliga ruxsatlarni vaqtincha toʻxtatdik va tasdiqlashingizni soʻraymiz.\n\n` +
    `${v.reason}\n\nBu ${v.child}ning maʼlumotlarini himoya qilish uchun. Tekshirib, javob bering: ${v.link}`,
};

const ru: Dict = {
  educator_invite: (v) =>
    `${v.educator} приглашает вас в Zinapo (код ${v.code}).\n\n` +
    `После входа вы добавите ребёнка и сами решите, что увидит репетитор.\n${v.link}`,

  access_requested: (v, f) =>
    `${v.educator} просит доступ к отчётам ${v.child}.\n\n` +
    `Если вы откроете доступ, репетитор увидит результаты и типы ошибок; ПИНФЛ, ваш номер и других ваших детей — нет.\n\n` +
    `Запрос действует до ${f.date(v.expires)}: ${v.link}`,

  access_granted: (v, f) =>
    `Доступ к ${v.child} открыт: ${v.educator}, до ${f.date(v.until)}.\n\n` +
    `Когда срок истечёт, доступ закроется сам. Вы можете отключить его в любой момент.`,

  access_revoked: (v) =>
    `Доступ к ${v.child} закрыт: ${v.educator}.\n\n` +
    `Отчёты он больше не видит. При желании вы сможете открыть доступ снова.`,

  access_expiring: (v, f) =>
    `Доступ ${v.educator} к отчётам ${v.child} истекает ${f.date(v.until)} (осталось ${v.days} дн.).\n\n` +
    `Если хотите продлить, сделайте это в разделе «Доступ и согласия».`,

  co_guardian_invite: (v) =>
    `${v.inviter} хочет добавить вас вторым опекуном в профиль ${v.child}.\n\n` +
    `Вы будете видеть отчёты и сможете запускать мониторинг. Согласиями и доступами управляет владелец профиля.\n${v.link}`,

  ownership_transfer: (v) =>
    `${v.inviter} хочет передать вам владение профилем ${v.child}.\n\n` +
    `После принятия согласия и доступ репетиторам перейдут к вам. ${v.inviter} останется вторым опекуном.\n${v.link}`,

  co_guardian_joined: (v) =>
    `${v.guardian} добавлен вторым опекуном в профиль ${v.child}.\n\n` +
    `Он видит отчёты, но не может менять согласия и доступы. Удалить его можно в любой момент.`,

  guardian_removed: (v) =>
    `Ваш доступ к профилю ${v.child} закрыт. Это сделал владелец профиля ${v.owner}.\n\n` +
    `Если это ошибка, свяжитесь с ним.`,

  ownership_changed: (v) =>
    `Владелец профиля ${v.child} теперь ${v.owner}.\n\n` +
    `Согласиями и доступом репетиторов теперь управляет он. ${v.previous} остаётся вторым опекуном.`,

  consent_changed: (v) =>
    `${v.child}: согласие «${consentName('ru', v.consent)}» ${v.given ? 'дано' : 'отозвано'}.` +
    (v.consent === 'data_processing' && !v.given
      ? `\n\nМониторинг остановлен. Прежние результаты сохранены.`
      : ''),

  anonymisation_requested: (v, f) =>
    `Запрошено удаление данных ${v.child}.\n\n` +
    `До ${f.date(v.executeAfter)} запрос можно отменить, затем профиль будет обезличен: имя, ПИНФЛ и отчёты удалятся, все доступы закроются.\n${v.link}`,

  anonymisation_cancelled: (v) =>
    `Запрос на удаление данных ${v.child} отменён. Профиль работает как прежде.`,

  anonymisation_done: (v) =>
    `Ваш запрос выполнен: профиль ${v.child} обезличен.\n\n` +
    `Имя, ПИНФЛ и отчёты удалены. Ответы на вопросы остались только для статистики вопросов и ни с кем не связаны.`,

  educator_access_granted: (v, f) =>
    `Родители ${v.child} открыли вам доступ к отчётам — до ${f.date(v.until)}.\n${v.link}`,

  educator_access_ended: (v) =>
    `Ваш доступ к отчётам ${v.child} закрыт.\n\nИстория ребёнка остаётся с ним; родители могут открыть доступ снова.`,

  wave_open: (v) =>
    `Для ${v.child} открылась ${v.wave} и закроется ${v.closes}.\n\n` +
    `Можно пройти дома или у репетитора — это занимает до 30 минут.\n${v.link}`,

  wave_reminder: (v) =>
    `${v.child} ещё не прошёл ${v.wave}. Она закрывается ${v.closes}.\n\n` +
    `Если не пройти, волна останется «не пройдена» — это не ноль, но и роста она не покажет.\n${v.link}`,

  report_ready: (v) => `Отчёт ${v.child} за ${v.wave} готов.\n\n${v.link}`,

  olympiad_registered: (v) => `${v.child} зарегистрирован на ${v.olympiad}.\n\n${v.details}`,

  final_venue_details: (v) =>
    `Финал ${v.olympiad}: ${v.date}, ${v.venue}.\n${v.address}\n\n` +
    `С ${v.child} должен приехать совершеннолетний сопровождающий. Если это не владелец профиля, мы это зафиксируем.`,

  case_needs_owner_confirmation: (v) =>
    `Мы временно приостановили доступы к профилю ${v.child} и просим вас их подтвердить.\n\n` +
    `${v.reason}\n\nЭто защита данных ${v.child}. Проверьте и ответьте: ${v.link}`,
};

/** `kaa` falls back to uz until the Karakalpak copy exists (task.md § 14.4). */
const DICTS: Record<string, Dict> = { uz, ru, en: uz, kaa: uz };

const CONSENT_NAMES: Record<'uz' | 'ru', Record<string, string>> = {
  uz: {
    data_processing: 'Shaxsiy maʼlumotlarni qayta ishlash',
    third_party_transfer: 'Olimpiada hamkorlariga uzatish',
    marketing: 'Yangiliklar va takliflar',
  },
  ru: {
    data_processing: 'Обработка персональных данных',
    third_party_transfer: 'Передача партнёрам олимпиады',
    marketing: 'Новости и предложения',
  },
};

function consentName(lang: 'uz' | 'ru', type: string | number | undefined): string {
  return CONSENT_NAMES[lang][String(type)] ?? String(type);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

function formatter(locale: string): Fmt {
  return {
    date: (value) => {
      if (value === undefined) return '';
      const raw = String(value);
      if (!ISO_DATE.test(raw)) return raw;
      const d = new Date(raw.length === 10 ? `${raw}T12:00:00+05:00` : raw);
      if (Number.isNaN(d.getTime())) return raw;
      // "2027-yil 31-may" — spelled out, as on the web (apps/web/lib/format.ts):
      // ICU's uz-Latn data differs between runtimes.
      if (locale !== 'ru') {
        const t = new Date(d.getTime() + 5 * 3_600_000);
        return `${t.getUTCFullYear()}-yil ${t.getUTCDate()}-${UZ_MONTHS[t.getUTCMonth()]}`;
      }
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Tashkent',
      }).format(d);
    },
  };
}

export function render(template: Template, locale: string, vars: Vars): string {
  const dict = DICTS[locale] ?? uz;
  return dict[template](vars, formatter(DICTS[locale] === ru ? 'ru' : 'uz'));
}
