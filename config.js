/* 配置：把 Supabase 的两个值填进来，三人同步就通了。
 * 在 Supabase 项目 → 左下 Settings → API 里复制：
 *   Project URL      → 填 SUPABASE_URL
 *   anon public key  → 填 SUPABASE_ANON_KEY
 * 两个都留空时，App 仍可单机使用（不联网、不同步）。 */
window.APP_CONFIG = {
  SUPABASE_URL: "",       // 例：https://abcdxxxx.supabase.co
  SUPABASE_ANON_KEY: "",  // 例：eyJhbGciOi...（很长一串）
  BOOK: "home",           // 家庭账本ID（三部手机填同一个就共享同一本账）
  AI_ENDPOINT: ""         // AI精简接口（下一步再填）
};
