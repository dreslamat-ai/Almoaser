/**
 * وجه سارة.
 *
 * الصورة نفسها المستعملة لشهد في AlmoaserPos: مساعِدتان في منتجين، وهويةٌ
 * بصرية واحدة تجعل من يعرف إحداهما يألف الأخرى.
 *
 * وتُعرَّف هنا مرّة: كانت أيقونة `Sparkles` مكرّرة في ثلاثة مواضع، فتغييرها
 * يعني تتبّعها في كلٍّ منها وسهوٌ في واحد يترك المحادثة بوجهين.
 */
export function SaraAvatar({ className = "size-8", bordered = true }: { className?: string; bordered?: boolean }) {
  return (
    <img
      src="/brand/sara-avatar.jpg"
      alt="سارة"
      // **الأبعاد الحقيقية للملفّ لا مقاسُ أصغر استعمال.** كانت 32×32 بينما
      // تُعرض في الترحيب بأربعة أضعافها، فيحجز المتصفّح مربّعاً صغيراً ثم
      // يقفز الشكل عند وصولها، ويختار مصدراً بدقّة أقلّ مما يعرض.
      width={480}
      height={480}
      // ولا تأجيل: وجهُها أوّل ما يُرى في الشاشة، والمؤجَّل يصل بعد أن تُقرأ
      loading="eager"
      decoding="async"
      className={`${className} shrink-0 rounded-full object-cover${bordered ? " border border-border" : ""}`}
    />
  );
}
