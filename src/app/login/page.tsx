import AuthCardSection from "@/components/ui/login-signup";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // OWASP A07 Mitigation: หากมี Session ซ้ำซ้อน ให้ข้ามหน้า Login ไปที่ /reels ทันที
  if (user) {
    redirect("/reels");
  }

  return <AuthCardSection />;
}