import { CaseSample } from '../types.ts';

export const SAMPLE_CASES: CaseSample[] = [
  {
    id: 'case_car_deposit',
    titleFa: 'اختلاف بر سر بیعانه خرید خودرو بدون مبایعه‌نامه کتبی',
    titleEn: 'Used Car Deposit Dispute Without a Written Bill of Sale',
    categoryFa: 'معاملات خودرو',
    categoryEn: 'Automotive & Private Sales',
    partyANameFa: 'سهراب (خریدار)',
    partyANameEn: 'Daniel Carter (Buyer)',
    partyAClaimFa:
      'مبلغ ۵۰ میلیون تومان برای بیعانه یک دستگاه پژو ۲۰۶ کارت‌به‌کارت کردم، اما فروشنده فردای آن روز قیمت را ۱۰ درصد بالا برد و نه خودرو را با قیمت توافق‌شده تحویل می‌دهد و نه بیعانه را برمی‌گرداند.',
    partyAClaimEn:
      'I sent a $1,000 Zelle deposit to hold a used Honda Civic at the listed price. The next morning, the seller raised the asking price by 10% and now refuses to either honor the original price or refund my deposit.',
    partyBNameFa: 'بهرام (فروشنده)',
    partyBNameEn: 'Marcus Reed (Seller)',
    partyBClaimFa:
      'بیعانه برای نگه داشتن خودرو بود و سایر مشتریان را رد کردم. قرار شفاهی ما تسویه کامل تا ۲۴ ساعت بود که خریدار انجام نداد و من متضرر شدم.',
    partyBClaimEn:
      'The deposit was meant to hold the vehicle and I turned away two other local buyers. Our verbal understanding was full payment within 24 hours, which he missed.',
  },
  {
    id: 'case_freelance_web',
    titleFa: 'اختلاف کارفرما و برنامه‌نویس بر سر امکانات خارج از قرارداد',
    titleEn: 'Client vs. Software Developer Dispute Over Scope Creep',
    categoryFa: 'قرارداد کار و فناوری',
    categoryEn: 'Tech & Freelance Contracts',
    partyANameFa: 'امیر (برنامه‌نویس)',
    partyANameEn: 'Rachel Brooks (Developer)',
    partyAClaimFa:
      'طبق توافق اولیه، وب‌سایت فروشگاهی با ۵ صفحه طراحی و روی هاست تحویل شد، اما کارفرما اکنون پنل اختصاصی پیامک و اپلیکیشن موبایل بدون هزینه اضافه می‌خواهد و قسط نهایی ۳۰ میلیون تومانی را گرو نگه داشته است.',
    partyAClaimEn:
      'Per our signed scope, I built and deployed the 5-page e-commerce storefront on schedule. The client now demands a custom mobile app and automated SMS suite at no extra charge while withholding the final $1,500 milestone.',
    partyBNameFa: 'مهدی (کارفرما)',
    partyBNameEn: 'Kevin Miller (Client)',
    partyBClaimFa:
      'سایت دارای خطا در درگاه پرداخت است و بدون سیستم ارسال پیامک، فروشگاه عملاً برای مشتری قابل استفاده نیست و کار ناتمام تلقی می‌شود.',
    partyBClaimEn:
      'The checkout flow still has unresolved bugs on mobile Safari, and without order-status text notifications the storefront is not launch-ready. Final payment was tied to functional delivery.',
  },
  {
    id: 'case_scope_culture',
    titleFa: 'مناظره منطقی دربارهٔ دامنهٔ ادعای فرهنگی و هنری',
    titleEn: 'Logical Debate Over Universal vs. Domain-Bounded Claims',
    categoryFa: 'منطق، فرهنگ و واقعیت عینی',
    categoryEn: 'Logic, Culture & Objective Scope',
    partyANameFa: 'کیان (مدعی کلی)',
    partyANameEn: 'Lucas Bennett',
    partyAClaimFa:
      'موسیقی سنتی ایران بهترین و کامل‌ترین موسیقی در تمام تاریخ بشریت و کل جهان است و هیچ سبک دیگری در دنیا به پای آن نمی‌رسد.',
    partyAClaimEn:
      'The Beatles are objectively the greatest musical artists in all of human history across every genre, era, and culture in the world.',
    partyBNameFa: 'آرش (مدعی مقید)',
    partyBNameEn: 'Hannah Parker',
    partyBClaimFa:
      'ردیف موسیقی دستگاهی ایران یکی از غنی‌ترین و ریشه‌دارترین سنت‌های موسیقایی در حوزهٔ فرهنگی خود و خاورمیانه است و مقایسه مطلق با کل تاریخ جهان بدون معیار یکسان منطقی نیست.',
    partyBClaimEn:
      'The Beatles were one of the most commercially and culturally influential British rock bands of the 1960s, whereas ranking any group as the absolute best across all human history lacks a universal objective metric.',
  },
];
