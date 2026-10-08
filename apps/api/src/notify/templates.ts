import { Template } from './notify.types';

type Dict = Record<Template, (v: Record<string, string | number>) => string>;

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

  access_requested: (v) =>
    `${v.educator} ${v.child}ning hisobotlarini koʻrish uchun ruxsat soʻradi.\n\n` +
    `Ruxsat bersangiz, u natijalar va xato turlarini koʻradi; PINFL, telefon raqamingiz va boshqa farzandlaringizni koʻrmaydi.\n\n` +
    `Soʻrov ${v.expires} gacha amal qiladi: ${v.link}`,

  access_granted: (v) =>
    `${v.child} uchun ruxsat berildi: ${v.educator}, ${v.until} gacha.\n\n` +
    `Muddat tugagach, ruxsat oʻzi yopiladi. Istalgan vaqtda oʻchirishingiz mumkin.`,

  access_revoked: (v) =>
    `${v.child} uchun ruxsat oʻchirildi: ${v.educator}.\n\n` +
    `U endi hisobotlarni koʻrmaydi. Xohlasangiz, keyinroq qayta berishingiz mumkin.`,

  access_expiring: (v) =>
    `${v.educator}ning ${v.child} hisobotlariga ruxsati ${v.until} da tugaydi (${v.days} kun qoldi).\n\n` +
    `Davom ettirishni xohlasangiz, “Ruxsat va roziliklar” boʻlimida muddatni uzaytirasiz.`,

  co_guardian_invite: (v) =>
    `${v.inviter} sizni ${v.child} profiliga ikkinchi vasiy sifatida qoʻshmoqchi.\n\n` +
    `Qabul qilsangiz, hisobotlarni koʻrasiz va monitoringni boshlab berasiz. Roziliklar va ruxsatlarni esa profil egasi boshqaradi.\n${v.link}`,

  ownership_transfer: (v) =>
    `${v.inviter} ${v.child} profilining egaligini sizga oʻtkazmoqchi.\n\n` +
    `Qabul qilsangiz, roziliklar va ustozlarga ruxsat berish sizga oʻtadi. ${v.inviter} ikkinchi vasiy boʻlib qoladi.\n${v.link}`,

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

  access_requested: (v) =>
    `${v.educator} просит доступ к отчётам ${v.child}.\n\n` +
    `Если вы откроете доступ, репетитор увидит результаты и типы ошибок; ПИНФЛ, ваш номер и других ваших детей — нет.\n\n` +
    `Запрос действует до ${v.expires}: ${v.link}`,

  access_granted: (v) =>
    `Доступ к ${v.child} открыт: ${v.educator}, до ${v.until}.\n\n` +
    `Когда срок истечёт, доступ закроется сам. Вы можете отключить его в любой момент.`,

  access_revoked: (v) =>
    `Доступ к ${v.child} закрыт: ${v.educator}.\n\n` +
    `Отчёты он больше не видит. При желании вы сможете открыть доступ снова.`,

  access_expiring: (v) =>
    `Доступ ${v.educator} к отчётам ${v.child} истекает ${v.until} (осталось ${v.days} дн.).\n\n` +
    `Если хотите продлить, сделайте это в разделе «Доступ и согласия».`,

  co_guardian_invite: (v) =>
    `${v.inviter} хочет добавить вас вторым опекуном в профиль ${v.child}.\n\n` +
    `Вы будете видеть отчёты и сможете запускать мониторинг. Согласиями и доступами управляет владелец профиля.\n${v.link}`,

  ownership_transfer: (v) =>
    `${v.inviter} хочет передать вам владение профилем ${v.child}.\n\n` +
    `После принятия согласия и доступ репетиторам перейдут к вам. ${v.inviter} останется вторым опекуном.\n${v.link}`,

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

export function render(
  template: Template,
  locale: string,
  vars: Record<string, string | number>,
): string {
  const dict = DICTS[locale] ?? uz;
  return dict[template](vars);
}
