// إعداد pm2 — سببه الوحيد kill_timeout.
//
// pm2 يمهل العملية ١٦٠٠ مللي ثانية بعد الإشارة ثم يرسل SIGKILL. رسالة الوكيل
// تستغرق حتى ٢١ ثانية في القياس، فالمهلة الافتراضية تقطع الطلب الطويل مهما
// كان الإنهاء اللطيف مكتوباً في الكود. ٣٠ ثانية تغطي أطول ما قِسناه بهامش.
//
// pm2 لا يعيد قراءة هذا الملف عند restart — يُقرأ عند البدء من الملف فقط:
//   pm2 delete almoaser-ai && pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [{
    name: "almoaser-ai",
    script: "dist/index.js",
    cwd: "/home/almoaser-ai/apps/almoaser-ai",
    exec_mode: "fork",
    kill_timeout: 30000,
    // ننتظر listen قبل اعتبارها جاهزة بدل افتراض ذلك فور بدء العملية
    listen_timeout: 10000,
    env: { NODE_ENV: "production" },
  }],
};
