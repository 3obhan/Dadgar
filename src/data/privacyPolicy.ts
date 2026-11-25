export interface PrivacyPolicySection {
  titleFa: string;
  titleEn: string;
  contentFa: string;
  contentEn: string;
}

export const PRIVACY_POLICY_SECTIONS: PrivacyPolicySection[] = [
  {
    titleFa: '۱. احترام به حریم خصوصی طرفین دعوا',
    titleEn: '1. Confidentiality of Party Statements',
    contentFa:
      'تمامی اطلاعات ورودی، اظهارات طرفین و مستندات ثبت‌شده در سامانه داوری آقای قاضی صرفاً جهت تحلیل بی‌طرفانه و انشای دادنامه استفاده می‌شوند و تحت هیچ شرایطی به اشخاص ثالث فروخته یا واگذار نمی‌گردند.',
    contentEn:
      'All case narratives, party claims, and exhibits entered into Mr. Judge are processed strictly for impartial deliberation and decree issuance. We never sell, monetize, or disclose your dispute details to third parties.',
  },
  {
    titleFa: '۲. ذخیره‌سازی محلی و کنترل کامل کاربر',
    titleEn: '2. Local Storage & Full User Control',
    contentFa:
      'آرشیو احکام و پیش‌نویس پرونده‌ها به صورت محلی در حافظه مرورگر کاربر (Local Storage) ذخیره می‌شود و کاربر در هر لحظه می‌تواند با دکمه «پاکسازی آرشیو» تمامی آن‌ها را حذف نماید.',
    contentEn:
      'Case history and decrees are saved within the user’s local browser storage. Users maintain full control to wipe their history at any time with a single click.',
  },
  {
    titleFa: '۳. دسترسی کاملاً رایگان و عدم دریافت اطلاعات مالی',
    titleEn: '3. 100% Free Access & Zero Financial Data Collection',
    contentFa:
      'تمامی امکانات سامانه آقای قاضی — از جمله تبدیل هوشمند گفتار به متن، داوری پیشرفته هوش مصنوعی و صدور سند رسمی تک‌برگی ممهور — به صورت ۱۰۰٪ رایگان ارائه می‌شود. این برنامه هرگز اطلاعات بانکی یا شماره کارت شما را درخواست یا ذخیره نمی‌کند.',
    contentEn:
      'All features of Mr. Judge — including AI voice-to-text transcription, impartial AI deliberation, and official 1-page certified decree issuance — are provided 100% free of charge. We never request or store any payment card or financial data.',
  },
  {
    titleFa: '۴. رمزنگاری و امنیت پردازش هوش مصنوعی',
    titleEn: '4. AI Pipeline & Encryption Standards',
    contentFa:
      'تمام تبادل اطلاعات از طریق پروتکل‌های امن و رمزنگاری‌شده (HTTPS / TLS) صورت می‌پذیرد و لوایح پرونده‌ها برای آموزش عمومی هوش مصنوعی استفاده نمی‌شوند.',
    contentEn:
      'All data transfers utilize secure encrypted protocols (HTTPS / TLS). Submitted case arguments are confidential and are not used for public model retraining.',
  },
  {
    titleFa: '۵. عدم وابستگی به محاکم دولتی',
    titleEn: '5. Non-Governmental Arbitration Scope',
    contentFa:
      'سامانه آقای قاضی یک نهاد غیردولتی مبتنی بر هوش مصنوعی و عقل سلیم است و دادنامه‌های صادره جنبه مشورتی و صلح‌جویانه دارند و اثر مستقیم احکام محاکم قضایی دادگستری را دارا نیستند.',
    contentEn:
      'Mr. Judge is an independent AI-assisted rational dispute resolution platform. Decrees serve as advisory, rational evaluations to foster amicable settlement without government court power.',
  },
];
