-- ===========================================================================
-- Reference data: regions and the starter taxonomy.
-- ===========================================================================
-- Regions are the cohort unit, so they must exist before any child does.
-- The taxonomy (3 clusters, grade 0–2 skills, misconceptions) is the minimum
-- the item editor and the practice builder need to be usable; the season
-- manager extends it from the staff console.
-- ===========================================================================

-- 14 regions. `code` is the SOATO top level.
INSERT INTO region (id, code, name_uz, name_ru) VALUES
  ( 1, '1703', 'Qoraqalpogʻiston Respublikasi', 'Республика Каракалпакстан'),
  ( 2, '1706', 'Andijon viloyati',              'Андижанская область'),
  ( 3, '1708', 'Buxoro viloyati',               'Бухарская область'),
  ( 4, '1710', 'Jizzax viloyati',               'Джизакская область'),
  ( 5, '1718', 'Qashqadaryo viloyati',          'Кашкадарьинская область'),
  ( 6, '1722', 'Navoiy viloyati',               'Навоийская область'),
  ( 7, '1724', 'Namangan viloyati',             'Наманганская область'),
  ( 8, '1726', 'Samarqand viloyati',            'Самаркандская область'),
  ( 9, '1730', 'Surxondaryo viloyati',          'Сурхандарьинская область'),
  (10, '1733', 'Sirdaryo viloyati',             'Сырдарьинская область'),
  (11, '1727', 'Toshkent viloyati',             'Ташкентская область'),
  (12, '1735', 'Fargʻona viloyati',             'Ферганская область'),
  (13, '1737', 'Xorazm viloyati',               'Хорезмская область'),
  (14, '1726401', 'Toshkent shahri',            'город Ташкент')
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Topics — three clusters (task.md § 12 M3)
-- ---------------------------------------------------------------------------
INSERT INTO topic (code, cluster, grade_min, grade_max, name_uz, name_ru, sort) VALUES
  ('num.count',    'numeracy',  0, 2, 'Sanash va son tartibi',      'Счёт и порядок чисел',          10),
  ('num.addsub',   'numeracy',  1, 4, 'Qoʻshish va ayirish',        'Сложение и вычитание',          20),
  ('num.muldiv',   'numeracy',  2, 4, 'Koʻpaytirish va boʻlish',    'Умножение и деление',           30),
  ('num.fraction', 'numeracy',  3, 4, 'Kasrlar',                    'Дроби',                         40),
  ('num.word',     'numeracy',  2, 4, 'Matnli masalalar',           'Текстовые задачи',              50),
  ('rea.pattern',  'reasoning', 0, 4, 'Qoliplar va ketma-ketlik',   'Закономерности и последовательности', 60),
  ('rea.space',    'reasoning', 0, 4, 'Fazoviy tasavvur',           'Пространственное мышление',     70),
  ('rea.logic',    'reasoning', 2, 4, 'Mantiqiy xulosa',            'Логический вывод',              80),
  ('lan.read',     'language',  1, 4, 'Oʻqib tushunish',            'Понимание прочитанного',        90),
  ('lan.vocab',    'language',  0, 4, 'Soʻz boyligi',               'Словарный запас',              100),
  ('lan.listen',   'language',  0, 2, 'Tinglab tushunish',          'Понимание на слух',            110)
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Skills — grades 0–2 only (INV-11). These are what a parent of a grade 0–2
-- child sees: "11 of 18 skills secure".
-- ---------------------------------------------------------------------------
INSERT INTO skill (code, topic_code, grade, name_uz, name_ru) VALUES
  ('s.count.20',      'num.count',   0, '20 gacha sanash',               'Счёт до 20'),
  ('s.count.compare', 'num.count',   0, 'Sonlarni taqqoslash',           'Сравнение чисел'),
  ('s.count.100',     'num.count',   1, '100 gacha sanash',              'Счёт до 100'),
  ('s.count.place',   'num.count',   2, 'Xona birliklari',               'Разрядные единицы'),
  ('s.addsub.10',     'num.addsub',  1, '10 ichida qoʻshish-ayirish',    'Сложение и вычитание в пределах 10'),
  ('s.addsub.20',     'num.addsub',  1, '20 ichida oʻtish bilan',        'Переход через десяток в пределах 20'),
  ('s.addsub.100',    'num.addsub',  2, '100 ichida qoʻshish-ayirish',   'Сложение и вычитание в пределах 100'),
  ('s.muldiv.table',  'num.muldiv',  2, 'Koʻpaytirish jadvali',          'Таблица умножения'),
  ('s.word.onestep',  'num.word',    2, 'Bir amalli masala',             'Задача в одно действие'),
  ('s.pattern.next',  'rea.pattern', 0, 'Keyingi elementni topish',      'Найти следующий элемент'),
  ('s.pattern.rule',  'rea.pattern', 2, 'Qoidani aytib berish',          'Сформулировать правило'),
  ('s.space.shape',   'rea.space',   0, 'Shakllarni ajratish',           'Различение фигур'),
  ('s.space.rotate',  'rea.space',   1, 'Aylantirish va aks ettirish',   'Поворот и отражение'),
  ('s.logic.sort',    'rea.logic',   2, 'Belgiga koʻra guruhlash',       'Группировка по признаку'),
  ('s.read.sentence', 'lan.read',    1, 'Gapni tushunish',               'Понимание предложения'),
  ('s.read.short',    'lan.read',    2, 'Qisqa matnni tushunish',        'Понимание короткого текста'),
  ('s.vocab.core',    'lan.vocab',   0, 'Asosiy soʻzlar',                'Базовая лексика'),
  ('s.listen.follow', 'lan.listen',  0, 'Koʻrsatmani bajarish',          'Выполнение инструкции')
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Misconceptions — the currency of the educator view and the practice builder.
-- `explain_*` is written for the parent, not for the psychometrician.
-- ---------------------------------------------------------------------------
INSERT INTO misconception (code, topic_code, name_uz, name_ru, explain_uz, explain_ru) VALUES
  ('m.borrow.skip', 'num.addsub', 'Oʻtishni tashlab ketish', 'Пропуск перехода через десяток',
   'Bola xona birliklarini ayirganda “qarz olishni” unutadi: 42−17 ni 35 deb hisoblaydi.',
   'Ребёнок не «занимает» десяток при вычитании: считает 42−17 как 35.'),
  ('m.place.swap', 'num.count', 'Xonalarni almashtirish', 'Перестановка разрядов',
   'Bola 46 va 64 ni bir xil deb qabul qiladi — raqamlar oʻrni muhim ekani hali oʻrnashmagan.',
   'Ребёнок считает 46 и 64 равнозначными — позиция цифры ещё не закрепилась.'),
  ('m.muldiv.add', 'num.muldiv', 'Koʻpaytirish oʻrniga qoʻshish', 'Сложение вместо умножения',
   'Bola 6×4 ni 6+4 deb hisoblaydi: amal belgisini oʻqimay, odatlangan amalni bajaradi.',
   'Ребёнок считает 6×4 как 6+4: не читает знак, делает привычное действие.'),
  ('m.fraction.whole', 'num.fraction', 'Kasrni butun kabi solishtirish', 'Сравнение дробей как целых',
   'Bola 1/8 > 1/3 deb oʻylaydi, chunki 8 soni 3 dan katta.',
   'Ребёнок считает 1/8 > 1/3, потому что 8 больше 3.'),
  ('m.word.keyword', 'num.word', 'Kalit soʻzga ergashish', 'Опора на ключевое слово',
   'Bola masalaning mazmunini oʻqimay, “jami” soʻzini koʻrsa qoʻshadi, “qoldi” soʻzini koʻrsa ayiradi.',
   'Ребёнок не читает условие: видит «всего» — складывает, видит «осталось» — вычитает.'),
  ('m.pattern.local', 'rea.pattern', 'Faqat qoʻshni elementga qarash', 'Взгляд только на соседний элемент',
   'Bola qatorning umumiy qoidasini emas, oxirgi ikki elementning farqini takrorlaydi.',
   'Ребёнок повторяет разницу последних двух элементов, а не общее правило ряда.'),
  ('m.space.mirror', 'rea.space', 'Aylantirish va aks ettirishni aralashtirish', 'Смешение поворота и отражения',
   'Bola aylantirilgan shakl bilan koʻzgudagi aksini bir xil deb biladi.',
   'Ребёнок принимает повёрнутую фигуру и её зеркальное отражение за одно и то же.'),
  ('m.logic.converse', 'rea.logic', 'Teskari xulosa', 'Обращение импликации',
   '“Agar A boʻlsa, B” dan bola “Agar B boʻlsa, A” degan xulosani chiqaradi.',
   'Из «если A, то B» ребёнок выводит «если B, то A».'),
  ('m.read.surface', 'lan.read', 'Matndan birinchi uchragan raqamni olish', 'Выбор первого найденного числа',
   'Bola savolga javob izlamay, matnda koʻzga tashlangan birinchi sonni koʻchiradi.',
   'Ребёнок не ищет ответ на вопрос, а переписывает первое попавшееся число.'),
  ('m.vocab.sound', 'lan.vocab', 'Ohangdosh soʻzni tanlash', 'Выбор похожего по звучанию слова',
   'Bola maʼnosi emas, tovushi oʻxshash soʻzni tanlaydi.',
   'Ребёнок выбирает слово, похожее по звучанию, а не по смыслу.')
ON CONFLICT (code) DO NOTHING;
