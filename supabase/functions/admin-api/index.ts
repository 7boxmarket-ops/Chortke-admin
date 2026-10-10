import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "روش درخواست پشتیبانی نمی‌شود." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
  if (!url || !serviceKey || !adminEmail) return json({ error: "تنظیمات سمت سرور کامل نیست." }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "ابتدا وارد حساب مدیر شوید." }, 401);

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await adminClient.auth.getUser(token);
  const caller = authData?.user;
  if (authError || !caller?.email || caller.email.toLowerCase() !== adminEmail) {
    return json({ error: "دسترسی فقط برای مدیر مجاز است." }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "درخواست نامعتبر است." }, 400); }

  const action = String(body.action || "");
  const now = new Date().toISOString();

  if (action === "dashboard" || action === "users") {
    const { data: authList, error: listError } = await adminClient.auth.admin.listUsers({
      page: 1, perPage: 1000,
    });
    if (listError) return json({ error: "دریافت کاربران ناموفق بود." }, 500);

    const { data: profiles, error: profileError } = await adminClient
      .from("profiles")
      .select("id, username, phone, trial_started_at, trial_ends_at, subscription_ends_at, subscription_status");
    if (profileError) return json({ error: "دریافت اطلاعات اشتراک ناموفق بود. ساختار جدول profiles را بررسی کنید." }, 500);

    const pmap = new Map((profiles || []).map((p: any) => [p.id, p]));
    const users = (authList?.users || []).map((u: any) => {
      const p: any = pmap.get(u.id) || {};
      const trialEnd = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : 0;
      const subEnd = p.subscription_ends_at ? new Date(p.subscription_ends_at).getTime() : 0;
      let status = p.subscription_status || "trial";
      if (subEnd > Date.now()) status = "active";
      else if (trialEnd > Date.now() && status !== "active") status = "trial";
      else if (status !== "active") status = "expired";
      return {
        id: u.id,
        email: u.email || "",
        username: p.username || "",
        phone: p.phone || "",
        created_at: u.created_at,
        trial_started_at: p.trial_started_at || null,
        trial_ends_at: p.trial_ends_at || null,
        subscription_ends_at: p.subscription_ends_at || null,
        subscription_status: status,
      };
    });
    const counts = {
      total: users.length,
      active: users.filter((u: any) => u.subscription_status === "active").length,
      trial: users.filter((u: any) => u.subscription_status === "trial").length,
      expired: users.filter((u: any) => u.subscription_status === "expired").length,
    };
    return json({ users, counts });
  }

  if (action === "update") {
    const userId = String(body.user_id || "");
    const status = String(body.status || "");
    const days = Number(body.days ?? 30);
    if (!userId || !["trial", "active", "expired"].includes(status)) {
      return json({ error: "اطلاعات کاربر یا وضعیت اشتراک معتبر نیست." }, 400);
    }
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return json({ error: "مدت باید بین ۱ تا ۳۶۵۰ روز باشد." }, 400);
    }

    const end = new Date(Date.now() + days * 86400000).toISOString();
    const patch: Record<string, unknown> = { subscription_status: status };
    if (status === "active") patch.subscription_ends_at = end;
    if (status === "trial") {
      patch.trial_started_at = now;
      patch.trial_ends_at = end;
      patch.subscription_ends_at = null;
    }
    if (status === "expired") patch.subscription_ends_at = now;

    const { error: updateError } = await adminClient.from("profiles").update(patch).eq("id", userId);
    if (updateError) return json({ error: "ذخیره تغییرات ناموفق بود. وجود پروفایل این کاربر را بررسی کنید." }, 500);

    await adminClient.from("admin_audit_logs").insert({
      admin_email: caller.email,
      target_user_id: userId,
      action: status === "active" ? "set_subscription" : status === "trial" ? "reset_trial" : "expire_subscription",
      details: { status, days, ends_at: status === "expired" ? now : end },
    });
    return json({ ok: true });
  }

  if (action === "history") {
    const { data, error } = await adminClient.from("admin_audit_logs")
      .select("id, admin_email, target_user_id, action, details, created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (error) return json({ error: "دریافت تاریخچه ناموفق بود." }, 500);
    return json({ history: data || [] });
  }

  return json({ error: "عملیات ناشناخته است." }, 400);
});
