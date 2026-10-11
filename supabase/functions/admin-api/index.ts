import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorDetails(error: any) {
  return {
    message: error?.message || "Unknown error",
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "روش درخواست پشتیبانی نمی‌شود." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const adminEmail = (Deno.env.get("ADMIN_EMAIL") || "")
    .trim()
    .toLowerCase();

  if (!supabaseUrl || !serviceRoleKey || !adminEmail) {
    return json({ error: "تنظیمات سمت سرور کامل نیست." }, 500);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return json({ error: "ابتدا وارد حساب مدیر شوید." }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: authData, error: authError } =
    await adminClient.auth.getUser(token);

  const caller = authData?.user;

  if (
    authError ||
    !caller?.email ||
    caller.email.trim().toLowerCase() !== adminEmail
  ) {
    return json({ error: "دسترسی فقط برای مدیر مجاز است." }, 403);
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return json({ error: "درخواست نامعتبر است." }, 400);
  }

  const action = String(body.action || "");
  const now = new Date().toISOString();

  // =====================================================
  // DASHBOARD / USERS
  // =====================================================

  if (action === "dashboard" || action === "users") {
    const { data: authDataList, error: listError } =
      await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

    if (listError) {
      console.error("listUsers failed:", errorDetails(listError));
      return json({ error: "دریافت کاربران ناموفق بود." }, 500);
    }

    const { data: profiles, error: profileError } =
      await adminClient
        .from("profiles")
        .select(
          "id, username, mobile, created_at, trial_started_at, trial_ends_at, subscription_ends_at, subscription_status",
        );

    if (profileError) {
      console.error("profiles query failed:", errorDetails(profileError));

      return json(
        {
          error: "دریافت اطلاعات کاربران ناموفق بود.",
          details: errorDetails(profileError),
        },
        500,
      );
    }

    const profileMap = new Map(
      (profiles || []).map((profile: any) => [profile.id, profile]),
    );

    const users = (authDataList?.users || []).map((authUser: any) => {
      const profile: any = profileMap.get(authUser.id) || {};

      const trialEnd = profile.trial_ends_at
        ? new Date(profile.trial_ends_at).getTime()
        : 0;

      const subscriptionEnd = profile.subscription_ends_at
        ? new Date(profile.subscription_ends_at).getTime()
        : 0;

      let status = profile.subscription_status || "trial";

      if (subscriptionEnd > Date.now()) {
        status = "active";
      } else if (trialEnd > Date.now()) {
        status = "trial";
      } else {
        status = "expired";
      }

      return {
        id: authUser.id,
        email: authUser.email || "",
        username: profile.username || "",
        mobile: profile.mobile || "",
        created_at: authUser.created_at || profile.created_at || null,
        trial_started_at: profile.trial_started_at || null,
        trial_ends_at: profile.trial_ends_at || null,
        subscription_ends_at: profile.subscription_ends_at || null,
        subscription_status: status,
      };
    });

    const counts = {
      total: users.length,
      active: users.filter(
        (user: any) => user.subscription_status === "active",
      ).length,
      trial: users.filter(
        (user: any) => user.subscription_status === "trial",
      ).length,
      expired: users.filter(
        (user: any) => user.subscription_status === "expired",
      ).length,
    };

    return json({ ok: true, users, counts });
  }

  // =====================================================
  // UPDATE SUBSCRIPTION
  // =====================================================

  if (action === "update") {
    const userId = String(body.user_id || "").trim();
    const status = String(body.status || "").trim();
    const days = Number(body.days ?? 30);

    if (!userId || !["trial", "active", "expired"].includes(status)) {
      return json(
        { error: "اطلاعات کاربر یا وضعیت اشتراک معتبر نیست." },
        400,
      );
    }

    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return json(
        { error: "مدت باید بین ۱ تا ۳۶۵۰ روز باشد." },
        400,
      );
    }

    const { data: existingProfile, error: findError } =
      await adminClient
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

    if (findError) {
      console.error("Profile lookup failed:", errorDetails(findError));
      return json({ error: "بررسی اطلاعات پروفایل ناموفق بود." }, 500);
    }

    if (!existingProfile) {
      return json(
        { error: "پروفایل این کاربر در جدول profiles وجود ندارد." },
        404,
      );
    }

    const endDate = new Date(
      Date.now() + days * 86400000,
    ).toISOString();

    const patch: Record<string, unknown> = {
      subscription_status: status,
    };

    if (status === "active") {
      patch.subscription_ends_at = endDate;
    }

    if (status === "trial") {
      patch.trial_started_at = now;
      patch.trial_ends_at = endDate;
      patch.subscription_ends_at = null;
    }

    if (status === "expired") {
      patch.subscription_ends_at = now;
    }

    const { error: updateError } = await adminClient
      .from("profiles")
      .update(patch)
      .eq("id", userId);

    if (updateError) {
      console.error("Subscription update failed:", errorDetails(updateError));

      return json(
        {
          error: "ذخیره تغییرات اشتراک ناموفق بود.",
          details: errorDetails(updateError),
        },
        500,
      );
    }

    const { error: auditError } = await adminClient
      .from("admin_audit_logs")
      .insert({
        admin_email: caller.email,
        target_user_id: userId,
        action:
          status === "active"
            ? "set_subscription"
            : status === "trial"
            ? "reset_trial"
            : "expire_subscription",
        details: {
          status,
          days,
          ends_at: status === "expired" ? now : endDate,
        },
      });

    if (auditError) {
      console.error("Audit log insert failed:", errorDetails(auditError));
    }

    return json({
      ok: true,
      message: "تغییرات اشتراک ذخیره شد.",
    });
  }

  // =====================================================
  // ADMIN HISTORY
  // =====================================================

  if (action === "history") {
    const { data, error } = await adminClient
      .from("admin_audit_logs")
      .select(
        "id, admin_email, target_user_id, action, details, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("History query failed:", errorDetails(error));

      return json(
        {
          error: "دریافت تاریخچه عملیات ناموفق بود.",
          details: errorDetails(error),
        },
        500,
      );
    }

    return json({ ok: true, history: data || [] });
  }

  // =====================================================
  // LIST IN-APP MESSAGES
  // =====================================================

  if (action === "messages_list") {
    const { data: messages, error } = await adminClient
      .from("in_app_messages")
      .select(
        "id, title, body, target_user_id, is_active, created_by, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Messages list failed:", errorDetails(error));

      return json(
        {
          error: "دریافت پیام‌ها ناموفق بود.",
          details: errorDetails(error),
        },
        500,
      );
    }

    const targetIds = [
      ...new Set(
        (messages || [])
          .map((message: any) => message.target_user_id)
          .filter(Boolean),
      ),
    ];

    const targetMap = new Map<string, any>();

    if (targetIds.length > 0) {
      const { data: targetProfiles, error: targetError } =
        await adminClient
          .from("profiles")
          .select("id, username")
          .in("id", targetIds);

      if (targetError) {
        console.error(
          "Target profiles lookup failed:",
          errorDetails(targetError),
        );
      }

      for (const profile of targetProfiles || []) {
        targetMap.set(profile.id, {
          username: profile.username || "",
          email: "",
        });
      }

      const { data: authUsers, error: authUsersError } =
        await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });

      if (authUsersError) {
        console.error(
          "Target auth users lookup failed:",
          errorDetails(authUsersError),
        );
      }

      for (const user of authUsers?.users || []) {
        if (targetIds.includes(user.id)) {
          const existing = targetMap.get(user.id) || {
            username: "",
            email: "",
          };

          existing.email = user.email || "";
          targetMap.set(user.id, existing);
        }
      }
    }

    const result = (messages || []).map((message: any) => {
      const target = message.target_user_id
        ? targetMap.get(message.target_user_id)
        : null;

      return {
        ...message,
        target_username: target?.username || "",
        target_email: target?.email || "",
      };
    });

    return json({ ok: true, messages: result });
  }

  // =====================================================
  // CREATE IN-APP MESSAGE
  // =====================================================

  if (action === "message_create") {
    const title = String(body.title || "").trim();
    const messageBody = String(body.body || "").trim();
    const audience = String(body.audience || "all").trim();
    const targetUserId = String(body.target_user_id || "").trim();

    if (!title || !messageBody) {
      return json(
        { error: "عنوان و متن پیام الزامی است." },
        400,
      );
    }

    if (title.length > 200) {
      return json(
        { error: "عنوان پیام نباید بیشتر از ۲۰۰ نویسه باشد." },
        400,
      );
    }

    if (messageBody.length > 10000) {
      return json(
        { error: "متن پیام بیش از حد طولانی است." },
        400,
      );
    }

    let targetId: string | null = null;

    if (audience === "user") {
      if (!targetUserId) {
        return json(
          { error: "برای پیام اختصاصی، کاربر را انتخاب کنید." },
          400,
        );
      }

      const { data: targetProfile, error: targetError } =
        await adminClient
          .from("profiles")
          .select("id")
          .eq("id", targetUserId)
          .maybeSingle();

      if (targetError) {
        console.error(
          "Target profile check failed:",
          errorDetails(targetError),
        );

        return json(
          {
            error: "بررسی کاربر انتخاب‌شده ناموفق بود.",
            details: errorDetails(targetError),
          },
          500,
        );
      }

      if (!targetProfile) {
        return json(
          { error: "کاربر انتخاب‌شده در جدول profiles وجود ندارد." },
          404,
        );
      }

      targetId = targetUserId;
    } else if (audience !== "all") {
      return json(
        { error: "مخاطب پیام معتبر نیست." },
        400,
      );
    }

    const { data: insertedMessage, error: insertError } =
      await adminClient
        .from("in_app_messages")
        .insert({
          title,
          body: messageBody,
          target_user_id: targetId,
          is_active: true,
          created_by: caller.id,
        })
        .select(
          "id, title, body, target_user_id, is_active, created_by, created_at",
        )
        .single();

    if (insertError) {
      console.error(
        "Message creation failed:",
        errorDetails(insertError),
      );

      return json(
        {
          error: "ثبت پیام ناموفق بود.",
          details: errorDetails(insertError),
        },
        500,
      );
    }

    return json({
      ok: true,
      message: "پیام با موفقیت ثبت شد.",
      data: insertedMessage,
    });
  }

  // =====================================================
  // ENABLE / DISABLE MESSAGE
  // =====================================================

  if (action === "message_toggle") {
    const messageId = String(body.id || "").trim();
    const isActive = body.is_active;

    if (!messageId || typeof isActive !== "boolean") {
      return json(
        { error: "شناسه پیام یا وضعیت فعال بودن معتبر نیست." },
        400,
      );
    }

    const { data: updatedMessage, error } = await adminClient
      .from("in_app_messages")
      .update({ is_active: isActive })
      .eq("id", messageId)
      .select(
        "id, title, body, target_user_id, is_active, created_by, created_at",
      )
      .maybeSingle();

    if (error) {
      console.error("Message toggle failed:", errorDetails(error));

      return json(
        {
          error: "تغییر وضعیت پیام ناموفق بود.",
          details: errorDetails(error),
        },
        500,
      );
    }

    if (!updatedMessage) {
      return json({ error: "پیام موردنظر پیدا نشد." }, 404);
    }

    return json({
      ok: true,
      message: "وضعیت پیام تغییر کرد.",
      data: updatedMessage,
    });
  }

  // =====================================================
  // DELETE MESSAGE
  // =====================================================

  if (action === "message_delete") {
    const messageId = String(body.id || "").trim();

    if (!messageId) {
      return json({ error: "شناسه پیام الزامی است." }, 400);
    }

    const { data: deletedMessage, error } = await adminClient
      .from("in_app_messages")
      .delete()
      .eq("id", messageId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Message delete failed:", errorDetails(error));

      return json(
        {
          error: "حذف پیام ناموفق بود.",
          details: errorDetails(error),
        },
        500,
      );
    }

    if (!deletedMessage) {
      return json({ error: "پیام موردنظر پیدا نشد." }, 404);
    }

    return json({
      ok: true,
      message: "پیام حذف شد.",
    });
  }

  // =====================================================
  // UNKNOWN ACTION
  // =====================================================

  return json(
    { error: "عملیات ناشناخته است." },
    400,
  );
});
