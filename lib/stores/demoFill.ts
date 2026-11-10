/**
 * DEMO NAMES AND PRICES (owner, 2026-11-10: "for the sake of demo, add a key on each store page to add arbitrary
 * title & prices on all items that have green light … make sense based on rough estimate of the market for that
 * category of store … if either exists do not add demo title and prices").
 *
 * A product that has a light on the walk, and has NEITHER a name NOR a price, takes a made-up name (English and
 * Farsi) and a price that fit the store's kind: a bookshop gets books at book prices, a dry-nuts shop gets nuts.
 * A product with a name or a price is left exactly as it is. Each one filled is marked `demo`, so «Remove» takes
 * the made-up ones away again and nothing else; a product its owner then edits stops being a demo one.
 *
 * Free, no AI. Prices are rough Canadian shop prices (CAD). The same store always gets the same names and prices.
 *
 * Pure: imports only types, so `node --test` runs it.
 */

import type { Product } from "../splats/catalogue";

/** [English, Farsi, lowest $, highest $] */
type Row = [string, string, number, number];
/** [English suffix, Farsi suffix, price ×]: the same thing again, another edition or size. */
type Variant = [string, string, number];
type Kind = { id: string; say: string; match: RegExp; rows: Row[]; variants: Variant[] };

const SIZES: Variant[] = [["large", "بزرگ", 1.6], ["gift pack", "بسته هدیه", 1.9], ["small", "کوچک", 0.65]];

export const KINDS: Kind[] = [
  {
    id: "books", say: "a bookshop", match: /book|کتاب|نشر|publish/i,
    variants: [["hardcover", "جلد سخت", 1.45], ["illustrated edition", "چاپ مصور", 1.8], ["pocket edition", "قطع جیبی", 0.7]],
    rows: [
      ["Divan of Hafez", "دیوان حافظ", 24, 48], ["Shahnameh", "شاهنامه فردوسی", 38, 85], ["Masnavi", "مثنوی معنوی", 34, 70],
      ["Golestan of Saadi", "گلستان سعدی", 18, 32], ["Bustan of Saadi", "بوستان سعدی", 18, 32], ["Rubaiyat of Khayyam", "رباعیات خیام", 16, 38],
      ["Divan of Shams", "دیوان شمس تبریزی", 34, 68], ["The Blind Owl", "بوف کور", 14, 22], ["Savushun", "سووشون", 18, 28],
      ["My Uncle Napoleon", "دایی جان ناپلئون", 22, 36], ["Kelidar, volume 1", "کلیدر، جلد اول", 26, 40], ["Missing Soluch", "جای خالی سلوچ", 18, 28],
      ["Symphony of the Dead", "سمفونی مردگان", 17, 27], ["The Little Black Fish", "ماهی سیاه کوچولو", 9, 16], ["Eight Books", "هشت کتاب", 19, 30],
      ["Collected Poems of Forough Farrokhzad", "مجموعه اشعار فروغ فرخزاد", 18, 30], ["Collected Poems of Ahmad Shamlou", "مجموعه اشعار احمد شاملو", 28, 46],
      ["Collected Poems of Parvin Etesami", "دیوان پروین اعتصامی", 20, 34], ["Kalila and Dimna", "کلیله و دمنه", 22, 38], ["Khosrow and Shirin", "خسرو و شیرین", 20, 34],
      ["Layla and Majnun", "لیلی و مجنون", 20, 34], ["The Conference of the Birds", "منطق‌الطیر", 20, 36], ["One Thousand and One Nights", "هزار و یک شب", 36, 72],
      ["Her Eyes", "چشم‌هایش", 15, 24], ["The Neighbours", "همسایه‌ها", 18, 28], ["Tangsir", "تنگسیر", 15, 24],
      ["The School Principal", "مدیر مدرسه", 12, 20], ["I Turn Off the Lights", "چراغ‌ها را من خاموش می‌کنم", 16, 26], ["Things We Left Unsaid", "عادت می‌کنیم", 16, 26],
      ["The Colonel", "زوال کلنل", 18, 28], ["Persian Cooking", "هنر آشپزی", 32, 58], ["A History of Iran", "تاریخ ایران", 30, 55],
      ["Tales of Good Children", "قصه‌های خوب برای بچه‌های خوب", 14, 24], ["The Little Prince", "شازده کوچولو", 12, 20], ["One Hundred Years of Solitude", "صد سال تنهایی", 22, 34],
      ["Les Misérables", "بینوایان", 34, 60], ["Crime and Punishment", "جنایت و مکافات", 26, 42], ["The Stranger", "بیگانه", 13, 21],
      ["Nineteen Eighty-Four", "۱۹۸۴", 16, 26], ["Animal Farm", "قلعه حیوانات", 11, 18], ["The Alchemist", "کیمیاگر", 15, 24],
      ["Blindness", "کوری", 17, 27], ["The Old Man and the Sea", "پیرمرد و دریا", 12, 19], ["War and Peace", "جنگ و صلح", 44, 78],
      ["The Brothers Karamazov", "برادران کارامازوف", 36, 62], ["Persian for Beginners", "آموزش زبان فارسی", 22, 40], ["Persian Calligraphy", "آموزش خوشنویسی", 20, 38],
      ["Persian–English Dictionary", "فرهنگ فارسی–انگلیسی", 28, 52],
    ],
  },
  {
    id: "nuts", say: "a dry-nuts shop", match: /\bnuts?\b|dried fruit|آجیل|خشکبار|تنقلات/i, variants: SIZES,
    rows: [
      ["Roasted pistachios, 500 g", "پسته شور، ۵۰۰ گرم", 16, 24], ["Raw pistachio kernels, 250 g", "مغز پسته خام، ۲۵۰ گرم", 15, 22], ["Raw almonds, 500 g", "بادام خام، ۵۰۰ گرم", 10, 15],
      ["Roasted cashews, 500 g", "بادام هندی بو داده، ۵۰۰ گرم", 12, 18], ["Walnut halves, 500 g", "مغز گردو، ۵۰۰ گرم", 10, 16], ["Hazelnuts, 500 g", "فندق، ۵۰۰ گرم", 11, 16],
      ["Mixed nuts (ajil), 500 g", "آجیل مخلوط، ۵۰۰ گرم", 14, 22], ["Sweet mixed nuts, 500 g", "آجیل شیرین، ۵۰۰ گرم", 12, 18], ["Roasted watermelon seeds, 400 g", "تخمه هندوانه، ۴۰۰ گرم", 7, 11],
      ["Roasted pumpkin seeds, 400 g", "تخمه کدو، ۴۰۰ گرم", 8, 12], ["Sunflower seeds, 400 g", "تخمه آفتابگردان، ۴۰۰ گرم", 5, 8], ["Roasted chickpeas, 400 g", "نخودچی، ۴۰۰ گرم", 5, 8],
      ["Golden raisins, 500 g", "کشمش پلویی، ۵۰۰ گرم", 6, 9], ["Green raisins, 500 g", "کشمش سبز، ۵۰۰ گرم", 7, 11], ["Dried mulberries, 400 g", "توت خشک، ۴۰۰ گرم", 10, 15],
      ["Dried figs, 500 g", "انجیر خشک، ۵۰۰ گرم", 11, 17], ["Dried apricots, 500 g", "برگه زردآلو، ۵۰۰ گرم", 9, 14], ["Barberries, 200 g", "زرشک، ۲۰۰ گرم", 8, 13],
      ["Mazafati dates, 600 g", "خرمای مضافتی، ۶۰۰ گرم", 8, 12], ["Piarom dates, 500 g", "خرمای پیارم، ۵۰۰ گرم", 13, 19], ["Saffron, 2 g", "زعفران، ۲ گرم", 12, 18],
      ["Dried limes, 200 g", "لیمو عمانی، ۲۰۰ گرم", 5, 8], ["Fruit leather (lavashak)", "لواشک", 4, 8], ["Pistachio nougat (gaz), 450 g", "گز پسته‌ای، ۴۵۰ گرم", 13, 20],
      ["Sohan, 400 g", "سوهان، ۴۰۰ گرم", 11, 16], ["Rock candy with saffron", "نبات زعفرانی", 6, 10], ["Sugar-coated almonds (noghl)", "نقل بادامی", 7, 11],
      ["Slivered pistachios, 100 g", "خلال پسته، ۱۰۰ گرم", 11, 16], ["Slivered almonds, 150 g", "خلال بادام، ۱۵۰ گرم", 6, 9], ["Dried sour cherries, 300 g", "آلبالو خشک، ۳۰۰ گرم", 8, 12],
    ],
  },
  {
    id: "sweets", say: "a pastry shop", match: /sweet|pastry|pastries|bakery|confection|cake|شیرینی|قنادی|نان|کیک/i, variants: SIZES,
    rows: [
      ["Baklava, box of 12", "باقلوا، جعبه ۱۲ عددی", 16, 24], ["Zoolbia and bamieh, 500 g", "زولبیا و بامیه، ۵۰۰ گرم", 10, 15], ["Chickpea cookies, 400 g", "شیرینی نخودچی، ۴۰۰ گرم", 10, 15],
      ["Rice cookies (nan berenji), 400 g", "نان برنجی، ۴۰۰ گرم", 10, 15], ["Raisin cookies, 400 g", "شیرینی کشمشی، ۴۰۰ گرم", 9, 14], ["Walnut cookies, 400 g", "شیرینی گردویی، ۴۰۰ گرم", 10, 15],
      ["Napoleon pastry", "شیرینی ناپلئونی", 4, 6], ["Cream roll", "رولت خامه‌ای", 4, 6], ["Cream puffs, box of 6", "نان خامه‌ای، جعبه ۶ عددی", 10, 14],
      ["Saffron cake", "کیک زعفرانی", 18, 28], ["Yazdi cupcakes, pack of 6", "کیک یزدی، بسته ۶ عددی", 7, 10], ["Koloocheh, pack of 6", "کلوچه، بسته ۶ عددی", 7, 11],
      ["Gaz, 450 g", "گز، ۴۵۰ گرم", 13, 20], ["Sohan, 400 g", "سوهان، ۴۰۰ گرم", 11, 16], ["Qottab, 400 g", "قطاب، ۴۰۰ گرم", 12, 17],
      ["Pashmak, 250 g", "پشمک، ۲۵۰ گرم", 6, 9], ["Barbari bread", "نان بربری", 3, 5], ["Sangak bread", "نان سنگک", 4, 6],
      ["Sweet bread (shirmal)", "نان شیرمال", 4, 6], ["Mixed dry pastries, 1 kg", "شیرینی خشک مخلوط، ۱ کیلو", 22, 30], ["Mixed fresh pastries, 1 kg", "شیرینی تر مخلوط، ۱ کیلو", 24, 34],
      ["Halva, 400 g", "حلوا، ۴۰۰ گرم", 9, 13], ["Saffron ice cream, 1 L", "بستنی زعفرانی، ۱ لیتر", 11, 15], ["Birthday cake", "کیک تولد", 38, 60],
    ],
  },
  {
    id: "clothing", say: "a clothing shop", match: /cloth|fashion|apparel|boutique|wear|dress|پوشاک|لباس|مزون|بوتیک/i,
    variants: [["second colour", "رنگ دوم", 1], ["premium", "ممتاز", 1.5], ["on sale", "حراج", 0.7]],
    rows: [
      ["Cotton T-shirt", "تی‌شرت نخی", 18, 32], ["Linen shirt", "پیراهن کتان", 45, 78], ["Silk scarf", "روسری ابریشمی", 35, 85],
      ["Cotton scarf", "شال نخی", 18, 32], ["Wool shawl", "شال پشمی", 40, 75], ["Manteau", "مانتو", 85, 160],
      ["Summer dress", "پیراهن تابستانی", 60, 120], ["Evening dress", "لباس مجلسی", 140, 320], ["Blouse", "بلوز", 38, 70],
      ["Knit sweater", "پلیور بافت", 55, 95], ["Cardigan", "ژاکت", 60, 105], ["Jeans", "شلوار جین", 55, 98],
      ["Trousers", "شلوار پارچه‌ای", 50, 90], ["Skirt", "دامن", 42, 78], ["Blazer", "کت تک", 110, 210],
      ["Winter coat", "پالتو", 150, 320], ["Rain jacket", "بارانی", 90, 160], ["Leather belt", "کمربند چرمی", 28, 55],
      ["Leather handbag", "کیف چرمی", 95, 240], ["Wallet", "کیف پول", 30, 65], ["Socks, 3 pairs", "جوراب، ۳ جفت", 12, 20],
      ["Sneakers", "کفش کتانی", 70, 130], ["Leather shoes", "کفش چرمی", 110, 210], ["Hat", "کلاه", 22, 42],
      ["Gloves", "دستکش", 20, 40], ["Tie", "کراوات", 28, 55], ["Pyjamas", "لباس خواب", 35, 60],
      ["Children's dress", "پیراهن بچگانه", 28, 55], ["Baby set", "ست نوزادی", 30, 55], ["Embroidered vest", "جلیقه سوزن‌دوزی", 65, 130],
    ],
  },
  {
    id: "jewellery", say: "a jewellery shop", match: /jewel|gold|silver|watch|جواهر|طلا|نقره|زیور|ساعت/i,
    variants: [["with turquoise", "با فیروزه", 1.4], ["18k gold", "طلای ۱۸ عیار", 3.2], ["small", "ظریف", 0.7]],
    rows: [
      ["Silver ring", "انگشتر نقره", 45, 120], ["Turquoise ring", "انگشتر فیروزه", 90, 260], ["Agate ring", "انگشتر عقیق", 70, 190],
      ["Silver necklace", "گردنبند نقره", 60, 160], ["Gold-plated necklace", "گردنبند آب‌طلا", 55, 140], ["Pendant with calligraphy", "آویز خوشنویسی", 65, 180],
      ["Silver bracelet", "دستبند نقره", 55, 150], ["Bead bracelet", "دستبند مهره‌ای", 25, 60], ["Silver earrings", "گوشواره نقره", 40, 110],
      ["Pearl earrings", "گوشواره مروارید", 70, 190], ["Anklet", "پابند", 35, 80], ["Brooch", "سنجاق سینه", 40, 95],
      ["Prayer beads (tasbih)", "تسبیح", 25, 90], ["Cufflinks", "دکمه سردست", 45, 110], ["Wrist watch", "ساعت مچی", 120, 380],
      ["Gold chain, 18k", "زنجیر طلا ۱۸ عیار", 380, 950], ["Gold ring, 18k", "انگشتر طلا ۱۸ عیار", 320, 880], ["Gold bangle, 18k", "النگو طلا ۱۸ عیار", 650, 1600],
      ["Jewellery box", "جعبه جواهر", 35, 85], ["Enamel pendant", "آویز میناکاری", 45, 120],
    ],
  },
  {
    id: "rugs", say: "a rug shop", match: /\brugs?\b|carpet|kilim|فرش|قالی|گلیم|گبه/i,
    variants: [["larger size", "اندازه بزرگ‌تر", 1.8], ["silk", "ابریشم", 2.6], ["small", "کوچک", 0.55]],
    rows: [
      ["Tabriz rug, 2 × 3 m", "فرش تبریز، ۲ × ۳ متر", 2400, 5200], ["Kashan rug, 2 × 3 m", "فرش کاشان، ۲ × ۳ متر", 2200, 4800], ["Isfahan rug, 1.5 × 2.3 m", "فرش اصفهان، ۱٫۵ × ۲٫۳ متر", 2800, 6500],
      ["Qom silk rug, 1 × 1.5 m", "فرش ابریشم قم، ۱ × ۱٫۵ متر", 3200, 7800], ["Nain rug, 2 × 3 m", "فرش نایین، ۲ × ۳ متر", 2600, 5600], ["Heriz rug, 2.5 × 3.5 m", "فرش هریس، ۲٫۵ × ۳٫۵ متر", 2900, 6200],
      ["Shiraz tribal rug, 1.5 × 2 m", "قالی شیراز، ۱٫۵ × ۲ متر", 900, 1900], ["Gabbeh, 1 × 1.5 m", "گبه، ۱ × ۱٫۵ متر", 380, 850], ["Kilim, 1.2 × 1.8 m", "گلیم، ۱٫۲ × ۱٫۸ متر", 260, 620],
      ["Kilim runner, 0.8 × 3 m", "کناره گلیم، ۰٫۸ × ۳ متر", 320, 700], ["Baluch rug, 1 × 1.6 m", "قالیچه بلوچ، ۱ × ۱٫۶ متر", 420, 950], ["Hamadan runner, 0.8 × 3 m", "کناره همدان، ۰٫۸ × ۳ متر", 650, 1400],
      ["Turkmen rug, 1.2 × 1.8 m", "قالیچه ترکمن، ۱٫۲ × ۱٫۸ متر", 700, 1600], ["Kilim cushion cover", "کوسن گلیم", 45, 95], ["Pictorial rug, framed", "تابلو فرش", 480, 1500],
      ["Machine-made rug, 2 × 3 m", "فرش ماشینی، ۲ × ۳ متر", 320, 780],
    ],
  },
  {
    id: "beauty", say: "a beauty shop", match: /beauty|cosmetic|perfume|skin|salon|آرایش|عطر|بهداشتی|زیبایی/i, variants: SIZES,
    rows: [
      ["Eau de parfum, 50 ml", "ادوپرفیوم، ۵۰ میل", 65, 140], ["Rose water, 500 ml", "گلاب، ۵۰۰ میل", 7, 12], ["Lipstick", "رژ لب", 16, 34],
      ["Mascara", "ریمل", 15, 30], ["Foundation", "کرم پودر", 28, 55], ["Eyeshadow palette", "پالت سایه چشم", 30, 62],
      ["Nail polish", "لاک ناخن", 9, 16], ["Face cream, 50 ml", "کرم صورت، ۵۰ میل", 26, 58], ["Hand cream", "کرم دست", 9, 18],
      ["Sunscreen SPF 50", "ضد آفتاب SPF 50", 20, 38], ["Shampoo, 400 ml", "شامپو، ۴۰۰ میل", 10, 22], ["Hair conditioner, 400 ml", "نرم‌کننده مو، ۴۰۰ میل", 10, 22],
      ["Argan hair oil", "روغن آرگان", 18, 36], ["Henna powder, 200 g", "حنا، ۲۰۰ گرم", 7, 13], ["Sefidab scrub", "سفیدآب", 4, 8],
      ["Handmade soap", "صابون دست‌ساز", 6, 12], ["Body lotion, 250 ml", "لوسیون بدن، ۲۵۰ میل", 14, 28], ["Makeup brush set", "ست براش آرایشی", 25, 52],
      ["Kohl eyeliner", "سرمه", 8, 16], ["Face mask, pack of 5", "ماسک صورت، بسته ۵ عددی", 12, 24],
    ],
  },
  {
    id: "electronics", say: "an electronics shop", match: /electr|phone|mobile|computer|gadget|موبایل|الکترونیک|کامپیوتر|دیجیتال/i,
    variants: [["black", "مشکی", 1], ["pro model", "مدل پرو", 1.6], ["refurbished", "بازسازی شده", 0.7]],
    rows: [
      ["Phone case", "قاب موبایل", 15, 35], ["Screen protector", "محافظ صفحه", 10, 22], ["USB-C cable, 1 m", "کابل USB-C، ۱ متر", 10, 20],
      ["Fast charger, 30 W", "شارژر سریع ۳۰ وات", 22, 42], ["Power bank, 10,000 mAh", "پاوربانک ۱۰۰۰۰", 28, 55], ["Wireless earbuds", "هدفون بی‌سیم", 45, 130],
      ["Bluetooth speaker", "اسپیکر بلوتوث", 40, 110], ["Headphones", "هدفون", 55, 160], ["Smart watch", "ساعت هوشمند", 120, 320],
      ["Wireless mouse", "ماوس بی‌سیم", 20, 45], ["Keyboard", "کیبورد", 35, 90], ["USB flash drive, 64 GB", "فلش ۶۴ گیگ", 12, 22],
      ["Memory card, 128 GB", "کارت حافظه ۱۲۸ گیگ", 20, 38], ["Car phone holder", "پایه موبایل خودرو", 16, 32], ["Wi-Fi router", "مودم روتر", 70, 160],
      ["Webcam", "وب‌کم", 45, 95], ["Tablet, 10 inch", "تبلت ۱۰ اینچ", 220, 480], ["Laptop sleeve", "کاور لپ‌تاپ", 22, 45],
    ],
  },
  {
    id: "home", say: "a homeware shop", match: /home|kitchen|decor|houseware|furnitur|خانه|آشپزخانه|دکور|لوازم|ظروف|مبل/i, variants: SIZES,
    rows: [
      ["Tea glasses, set of 6", "استکان چای، ۶ عددی", 18, 34], ["Teapot", "قوری", 24, 48], ["Samovar", "سماور", 120, 280],
      ["Persian rice cooker", "پلوپز", 65, 130], ["Copper pot", "قابلمه مسی", 70, 150], ["Serving tray", "سینی پذیرایی", 22, 48],
      ["Dinner plates, set of 6", "بشقاب، ۶ عددی", 40, 85], ["Cutlery set, 24 pieces", "قاشق و چنگال، ۲۴ پارچه", 55, 120], ["Crystal bowl", "کاسه کریستال", 28, 60],
      ["Sugar bowl", "قندان", 14, 28], ["Sofreh tablecloth", "سفره", 16, 34], ["Termeh table runner", "رومیزی ترمه", 45, 110],
      ["Cushion cover", "کاور کوسن", 18, 36], ["Scented candle", "شمع معطر", 14, 28], ["Vase", "گلدان", 25, 65],
      ["Wall clock", "ساعت دیواری", 30, 70], ["Picture frame", "قاب عکس", 15, 34], ["Bath towel set", "ست حوله", 35, 70],
      ["Bed sheet set", "ست ملحفه", 60, 130], ["Kettle", "کتری", 35, 75], ["Spice jars, set of 6", "جا ادویه، ۶ عددی", 20, 38],
      ["Mortar and pestle", "هاون", 22, 44],
    ],
  },
  {
    id: "crafts", say: "an art and handicraft shop", match: /gallery|\barts?\b|craft|gift|souvenir|antique|صنایع دستی|گالری|هنر|کادو|سوغات|عتیقه/i,
    variants: [["large", "بزرگ", 1.7], ["signed by the artist", "با امضای هنرمند", 2.2], ["small", "کوچک", 0.6]],
    rows: [
      ["Enamel (minakari) plate", "بشقاب میناکاری", 55, 140], ["Enamel vase", "گلدان میناکاری", 70, 180], ["Khatam jewellery box", "جعبه خاتم", 45, 130],
      ["Khatam picture frame", "قاب خاتم", 40, 95], ["Khatam backgammon set", "تخته نرد خاتم", 180, 420], ["Engraved copper tray (ghalamzani)", "سینی قلم‌زنی", 90, 240],
      ["Hand-painted copper bowl", "کاسه مسی نقاشی شده", 45, 110], ["Turquoise-inlaid vase", "گلدان فیروزه‌کوبی", 110, 290], ["Ghalamkar tablecloth", "رومیزی قلمکار", 35, 85],
      ["Termeh table runner", "رومیزی ترمه", 45, 120], ["Miniature painting", "نگارگری مینیاتور", 120, 380], ["Calligraphy panel", "تابلو خوشنویسی", 95, 320],
      ["Ceramic bowl, Lalejin", "کاسه سفالی لالجین", 22, 55], ["Ceramic pomegranate", "انار سفالی", 18, 42], ["Blue pottery plate", "بشقاب سفال آبی", 28, 65],
      ["Hand-blown glass vase", "گلدان شیشه دست‌ساز", 35, 90], ["Persian tile, framed", "کاشی هفت‌رنگ قاب شده", 45, 120], ["Hand-woven kilim bag", "کیف گلیم", 40, 95],
      ["Brass candle holder", "شمعدان برنجی", 35, 85], ["Marquetry (moarragh) panel", "تابلو معرق", 140, 420], ["Painted wooden pen case", "قلمدان نقاشی شده", 40, 110],
      ["Felt slippers", "دمپایی نمدی", 22, 45], ["Silver tea-glass holders, set of 6", "گالش استکان، ۶ عددی", 60, 150], ["Mirror and candlesticks set", "آینه و شمعدان", 220, 650],
      ["Oil painting, framed", "تابلو رنگ روغن", 180, 650], ["Hand-printed greeting cards, set of 5", "کارت تبریک دست‌ساز، ۵ عددی", 12, 24],
    ],
  },
  {
    id: "grocery", say: "a grocery", match: /grocer|market|supermarket|food|deli|butcher|سوپر|بقالی|خواربار|مواد غذایی|غذا|قصابی|میوه/i, variants: SIZES,
    rows: [
      ["Basmati rice, 4.5 kg", "برنج باسماتی، ۴٫۵ کیلو", 17, 26], ["Iranian rice, 4.5 kg", "برنج ایرانی، ۴٫۵ کیلو", 32, 48], ["Black tea, 500 g", "چای سیاه، ۵۰۰ گرم", 9, 15],
      ["Earl Grey tea, 500 g", "چای معطر، ۵۰۰ گرم", 10, 16], ["Saffron, 1 g", "زعفران، ۱ گرم", 7, 11], ["Pomegranate molasses", "رب انار", 6, 10],
      ["Tomato paste", "رب گوجه", 3, 5], ["Sour grape juice (ab-ghooreh)", "آبغوره", 4, 7], ["Rose water", "گلاب", 4, 7],
      ["Mixed pickles (torshi)", "ترشی مخلوط", 6, 9], ["Pickled garlic", "سیر ترشی", 7, 11], ["Pickled cucumbers", "خیارشور", 5, 8],
      ["Dried herbs for ghormeh sabzi", "سبزی قورمه خشک", 5, 8], ["Dried limes", "لیمو عمانی", 5, 8], ["Barberries, 150 g", "زرشک، ۱۵۰ گرم", 6, 10],
      ["Split peas, 900 g", "لپه، ۹۰۰ گرم", 4, 7], ["Red kidney beans, 900 g", "لوبیا قرمز، ۹۰۰ گرم", 4, 7], ["Lentils, 900 g", "عدس، ۹۰۰ گرم", 4, 7],
      ["Kashk", "کشک", 6, 9], ["Feta cheese, 400 g", "پنیر فتا، ۴۰۰ گرم", 7, 11], ["Yogurt drink (doogh), 1.5 L", "دوغ، ۱٫۵ لیتر", 4, 6],
      ["Lavash bread", "نان لواش", 3, 5], ["Sangak bread", "نان سنگک", 4, 6], ["Halva, 400 g", "حلوا ارده، ۴۰۰ گرم", 7, 11],
      ["Tahini", "ارده", 7, 11], ["Date syrup", "شیره خرما", 6, 10], ["Sour cherry jam", "مربای آلبالو", 6, 9],
      ["Carrot jam", "مربای هویج", 6, 9], ["Honey, 500 g", "عسل، ۵۰۰ گرم", 10, 17], ["Sugar cubes, 1 kg", "قند، ۱ کیلو", 5, 8],
      ["Rock candy", "نبات", 5, 8], ["Turmeric, 200 g", "زردچوبه، ۲۰۰ گرم", 4, 7], ["Advieh spice mix", "ادویه مخلوط", 5, 8],
      ["Sumac, 200 g", "سماق، ۲۰۰ گرم", 5, 8], ["Fried onions", "پیاز داغ", 5, 8], ["Noodles for ash (reshteh)", "رشته آش", 3, 6],
      ["Vermicelli for rice (reshteh polo)", "رشته پلویی", 3, 6], ["Mazafati dates, 600 g", "خرمای مضافتی، ۶۰۰ گرم", 8, 12], ["Pistachios, 400 g", "پسته، ۴۰۰ گرم", 13, 19],
      ["Fruit leather (lavashak)", "لواشک", 3, 6], ["Olive oil, 1 L", "روغن زیتون، ۱ لیتر", 14, 22], ["Sour cherry syrup", "شربت آلبالو", 6, 9],
    ],
  },
];

/** A store of no kind we know: things any shop might sell, at prices nobody would question. */
const GENERAL: Kind = {
  id: "general", say: "a general shop", match: /^$/, variants: SIZES,
  rows: [
    ["Gift box", "جعبه هدیه", 18, 40], ["Scented candle", "شمع معطر", 14, 28], ["Notebook", "دفتر یادداشت", 9, 18],
    ["Mug", "ماگ", 12, 22], ["Tote bag", "کیف پارچه‌ای", 15, 28], ["Greeting card", "کارت تبریک", 4, 8],
    ["Picture frame", "قاب عکس", 15, 34], ["Key ring", "جاکلیدی", 6, 14], ["Tea glasses, set of 6", "استکان چای، ۶ عددی", 18, 34],
    ["Cushion cover", "کاور کوسن", 18, 36], ["Handmade soap", "صابون دست‌ساز", 6, 12], ["Wall calendar", "تقویم دیواری", 12, 22],
    ["Pen set", "ست خودکار", 14, 30], ["Vase", "گلدان", 25, 60], ["Serving tray", "سینی", 22, 48],
    ["Scarf", "شال", 20, 45], ["Umbrella", "چتر", 18, 34], ["Water bottle", "قمقمه", 15, 28],
    ["Board game", "بازی فکری", 25, 55], ["Phone case", "قاب موبایل", 15, 30],
  ],
};

export type DemoStore = { slug: string; category?: string; nameEn?: string; nameFa?: string };

/** What kind of store it is: by its category first; a category that says nothing, by its name. */
export function kindOf(store: DemoStore): Kind {
  for (const text of [store.category ?? "", `${store.nameEn ?? ""} ${store.nameFa ?? ""}`]) {
    const k = text.trim() ? KINDS.find((x) => x.match.test(text)) : undefined;
    if (k) return k;
  }
  return GENERAL;
}

/** FNV-1a: a number from a text, the same every time. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** A price as a shop writes it: 4.49 / 4.99 under $10, x.99 under $100, to the $5 under $1000, to the $50 above. */
export function shopPrice(dollars: number): number {
  if (dollars < 10) return Math.max(99, Math.round(dollars * 2) * 50 - 1);
  if (dollars < 100) return Math.round(dollars) * 100 - 1;
  if (dollars < 1000) return Math.round(dollars / 5) * 500;
  return Math.round(dollars / 50) * 5000;
}

/** Waits for a demo name and price: it has a light, and neither a name nor a price. */
const waits = (p: Product, lit: Set<number>) => lit.has(p.n) && !p.en?.trim() && !p.fa?.trim() && p.priceCents === null;

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4));

export type DemoResult = { products: Product[]; filled: number; skipped: number; kind: string; say: string };

/**
 * The products with a demo name and price on every lit one that has neither. `skipped` is the lit products left
 * alone because they have a name or a price. What the crew saw of a product (`seen`) picks its name when a name
 * in the store's kind fits it ("jar of pickles" → the pickles); otherwise the names are dealt out in an order
 * that is the store's own. A name dealt a second time comes as another edition or size, at that one's price.
 */
export function demoFill(products: Product[], lit: Set<number>, store: DemoStore): DemoResult {
  const kind = kindOf(store);
  const order = kind.rows.map((_, i) => i).sort((a, b) => hash(`${store.slug}|${kind.rows[a][0]}`) - hash(`${store.slug}|${kind.rows[b][0]}`));
  const rowWords = kind.rows.map((r) => words(r[0]));
  const used = kind.rows.map(() => 0);
  let filled = 0, skipped = 0, next = 0;
  const out = products.map((p) => {
    if (!waits(p, lit)) { if (lit.has(p.n)) skipped++; return p; }
    const saw = p.seen ? words(p.seen) : new Set<string>();
    let i = -1;
    if (saw.size) {
      // The names that share a word with what was seen; of those, the one dealt least so far.
      const fits = order.filter((r) => [...rowWords[r]].some((w) => saw.has(w)));
      if (fits.length) i = fits.reduce((a, b) => (used[b] < used[a] ? b : a));
    }
    if (i < 0) {
      // The next name in the store's order that has been dealt least.
      const least = Math.min(...used);
      for (let k = 0; k < order.length; k++) { const r = order[(next + k) % order.length]; if (used[r] === least) { i = r; next = (next + k + 1) % order.length; break; } }
    }
    const [en, fa, lo, hi] = kind.rows[i];
    const turn = used[i]++;
    const v = turn === 0 ? null : kind.variants[(turn - 1) % kind.variants.length];
    const base = lo + (hi - lo) * ((hash(`${store.slug}|price|${en}`) % 1000) / 999);
    filled++;
    return {
      ...p,
      en: (v ? `${en} (${v[0]})` : en).slice(0, 120),
      fa: (v ? `${fa} (${v[1]})` : fa).slice(0, 120),
      priceCents: shopPrice(base * (v ? v[2] : 1)),
      demo: true as const,
    };
  });
  return { products: out, filled, skipped, kind: kind.id, say: kind.say };
}

/** The demo names and prices taken away again: each demo product is as the crew found it, with no name and no price. */
export function demoClear(products: Product[]): { products: Product[]; cleared: number } {
  let cleared = 0;
  const out = products.map((p) => {
    if (!p.demo) return p;
    cleared++;
    const { en: _en, fa: _fa, demo: _demo, ...rest } = p;
    return { ...rest, priceCents: null };
  });
  return { products: out, cleared };
}

/** How many products carry a demo name and price now. */
export const demoCount = (products: Product[]) => products.filter((p) => p.demo).length;
