# پنل مدیریت چرتکه (CHORTKE Admin)

پنل فارسی راست‌چین با تم مشکی و بنفش برای مدیریت کاربران و وضعیت آزمایشی/اشتراک.

## فایل‌ها
- `index.html`: رابط پنل مدیر.
- `supabase/functions/admin-api/index.ts`: عملیات مدیریتی سمت سرور.
- `supabase/schema.sql`: جدول تاریخچه تغییرات مدیریتی.

## راه‌اندازی
1. در Supabase → Authentication → Users یک حساب مدیر جداگانه بسازید.
2. فایل `supabase/schema.sql` را در SQL Editor اجرا کنید.
3. با Supabase CLI تابع `admin-api` را deploy کنید.
4. Secrets تابع را فقط در Supabase تنظیم کنید:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_EMAIL` (ایمیل دقیق مدیر)
5. در `index.html` مقدار `SUPABASE_URL` و `SUPABASE_ANON_KEY` را جایگزین کنید. کلید anon قابل استفاده در مرورگر است؛ کلید service_role هرگز نباید در این فایل باشد.
6. سایت را از GitHub Pages یا میزبان HTTPS رایگان منتشر کنید و دامنه را در Supabase Auth → URL Configuration به Redirect URLs اضافه کنید.

## امنیت و محدودیت‌های نسخه اولیه
- عملیات حساس فقط در Edge Function سمت سرور اجرا می‌شوند.
- Edge Function ایمیل مدیر را با `ADMIN_EMAIL` تطبیق می‌دهد.
- این پنل به‌تنهایی برنامه اندروید را قفل نمی‌کند؛ اپ CHORTKE باید جداگانه وضعیت اشتراک را از سرور بررسی کند.
- قبل از استفاده واقعی، حتماً با حساب آزمایشی تست کنید.
