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
      width={32}
      height={32}
      loading="lazy"
      className={`${className} shrink-0 rounded-full object-cover${bordered ? " border border-border" : ""}`}
    />
  );
}
