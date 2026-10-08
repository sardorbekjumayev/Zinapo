import { Lang } from '../auth/login-request.types';

type Dict = Record<string, string>;

const uz: Dict = {
  askPhone: 'Zinapoʻga kirish uchun telefon raqamingizni yuboring.',
  sharePhoneBtn: 'Raqamni yuborish',
  code:
    'Kirish kodi: *{code}*. 2 daqiqa amal qiladi.\n' +
    'Kodni hech kimga bermang — Zinapo hech qachon kodni soʻramaydi.\n' +
    'Soʻrov: {ua}, {time}.',
  newCodeBtn: 'Yangi kod',
  notMeBtn: 'Bu men emasman',
  phoneMismatch:
    'Bu raqam saytda kiritilgan raqamga mos kelmadi. Saytga qaytib, toʻgʻri raqamni kiriting.',
  ownNumberOnly: 'Iltimos, pastdagi tugma orqali oʻz raqamingizni yuboring.',
  linkExpired: 'Havola eskirgan. Saytga qaytib, qaytadan urinib koʻring.',
  linkUsed: 'Bu havola boshqa Telegram akkaunt bilan ochilgan.',
  startFromSite: 'Kirishni zinapo.uz saytidan boshlang.',
  removeKb: 'Rahmat! Kodni tayyorlayapmiz…',
  cancelled: 'Soʻrov bekor qilindi. Agar bu siz boʻlmasangiz, hech narsa qilish shart emas.',
  maxCodes: 'Bu soʻrov uchun kod limiti tugadi. Saytga qaytib, qaytadan boshlang.',
  cooldown: 'Yangi kodni {n} soniyadan keyin soʻrang.',
  noActiveRequest: 'Faol soʻrov topilmadi. Saytga qaytib, qaytadan boshlang.',
  greeting: 'Salom! Men Zinapo botiman. Kirish uchun zinapo.uz saytidan boshlang.',
};

const ru: Dict = {
  askPhone: 'Чтобы войти в Zinapo, отправьте свой номер телефона.',
  sharePhoneBtn: 'Отправить номер',
  code:
    'Код для входа: *{code}*. Действует 2 минуты.\n' +
    'Никому не сообщайте код — Zinapo никогда его не спрашивает.\n' +
    'Запрос: {ua}, {time}.',
  newCodeBtn: 'Новый код',
  notMeBtn: 'Это не я',
  phoneMismatch:
    'Этот номер не совпадает с введённым на сайте. Вернитесь на сайт и введите верный номер.',
  ownNumberOnly: 'Пожалуйста, отправьте свой номер кнопкой ниже.',
  linkExpired: 'Ссылка устарела. Вернитесь на сайт и попробуйте снова.',
  linkUsed: 'Эта ссылка уже открыта другим аккаунтом Telegram.',
  startFromSite: 'Начните вход на сайте zinapo.uz.',
  removeKb: 'Спасибо! Готовим код…',
  cancelled: 'Запрос отменён. Если это были не вы, ничего делать не нужно.',
  maxCodes: 'Лимит кодов для этого запроса исчерпан. Вернитесь на сайт и начните заново.',
  cooldown: 'Запросите новый код через {n} сек.',
  noActiveRequest: 'Активный запрос не найден. Вернитесь на сайт и начните заново.',
  greeting: 'Здравствуйте! Я бот Zinapo. Чтобы войти, начните на сайте zinapo.uz.',
};

const en: Dict = {
  askPhone: 'To sign in to Zinapo, share your phone number.',
  sharePhoneBtn: 'Share my number',
  code:
    'Sign-in code: *{code}*. Valid for 2 minutes.\n' +
    'Never share it — Zinapo will never ask you for this code.\n' +
    'Request: {ua}, {time}.',
  newCodeBtn: 'New code',
  notMeBtn: 'This wasn’t me',
  phoneMismatch:
    'This number doesn’t match the one entered on the site. Go back and enter the right number.',
  ownNumberOnly: 'Please share your own number with the button below.',
  linkExpired: 'This link has expired. Go back to the site and try again.',
  linkUsed: 'This link was already opened by another Telegram account.',
  startFromSite: 'Start signing in at zinapo.uz.',
  removeKb: 'Thanks! Preparing your code…',
  cancelled: 'The request was cancelled. If this wasn’t you, there is nothing else to do.',
  maxCodes: 'No codes left for this request. Go back to the site and start again.',
  cooldown: 'Ask for a new code in {n} s.',
  noActiveRequest: 'No active request found. Go back to the site and start again.',
  greeting: 'Hi! I am the Zinapo bot. To sign in, start at zinapo.uz.',
};

const DICTS: Record<Lang, Dict> = { uz, ru, en };

/** The bot follows the `lang` chosen on the site, not Telegram's language_code. */
export function t(lang: Lang | undefined, key: string, vars: Record<string, string | number> = {}): string {
  const dict = DICTS[lang ?? 'uz'] ?? uz;
  const template = dict[key] ?? uz[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/** "Chrome · Windows" style summary for the anti-phishing line. */
export function describeUa(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Brauzer';

  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';

  return os ? `${browser} · ${os}` : browser;
}

export function hhmm(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('uz-UZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tashkent',
  });
}
