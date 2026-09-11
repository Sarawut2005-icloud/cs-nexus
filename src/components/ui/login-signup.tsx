"use client";

import * as React from "react";
import { useState, useRef, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ShineBorder } from "@/components/ui/shine-border";
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  ArrowRight,
  User,
  IdCard,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.06-.72.08-.71.08-.71 1.17.09 1.78 1.2 1.78 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.75.4-1.27.73-1.56-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.51-1.46.11-3.05 0 0 .96-.3 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.18-1.48 3.14-1.18 3.14-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.2.66.8.55A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.62v3.01h3.88c2.27-2.09 3.58-5.17 3.58-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.12A11.99 11.99 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54V6.61H1.29a11.99 11.99 0 0 0 0 10.78l3.98-3.12Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.61l3.98 3.12C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

export default function AuthCardSection() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  // Active Tab & Status State
  const [activeTab, setActiveTab] = useState<"login" | "signup">("login");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  
  const [loadingType, setLoadingType] = useState<"form" | "github" | "google" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Login Form State
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Sign Up Form State
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");
  const [studentId, setStudentId] = useState("");
  const [fullName, setFullName] = useState("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // High-DPI & Motion-Aware Canvas Particle Effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Check accessibility settings for reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let animationFrameId: number;
    let particles: Array<{ x: number; y: number; v: number; o: number }> = [];

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
    };

    const initParticles = () => {
      particles = [];
      const count = Math.floor((window.innerWidth * window.innerHeight) / 14000);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          v: Math.random() * 0.3 + 0.1,
          o: Math.random() * 0.4 + 0.1,
        });
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      particles.forEach((p) => {
        p.y -= p.v;
        if (p.y < 0) {
          p.x = Math.random() * window.innerWidth;
          p.y = window.innerHeight + 10;
        }
        ctx.fillStyle = `rgba(129, 140, 248, ${p.o})`;
        ctx.fillRect(p.x, p.y, 1.2, 2.5);
      });
      animationFrameId = requestAnimationFrame(render);
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    render();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const handleTabChange = (val: string) => {
    setActiveTab(val as "login" | "signup");
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingType("form");
    setErrorMessage(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail.trim(),
        password: loginPassword,
      });

      if (error) throw error;

      router.push("/reels");
      router.refresh();
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || "เกิดข้อผิดพลาดในการเข้าสู่ระบบ");
    } finally {
      setLoadingType(null);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingType("form");
    setErrorMessage(null);
    setSuccessMessage(null);

    const sanitizedStudentId = studentId.trim();
    const sanitizedEmail = signUpEmail.trim();

    // Security Assessment: Strict Input Validations
    if (!/^\d{8,10}$/.test(sanitizedStudentId)) {
      setErrorMessage("รหัสนักศึกษาต้องเป็นตัวเลข 8-10 หลักเท่านั้น");
      setLoadingType(null);
      return;
    }

    // OWASP A07: Enforce Password Policy (At least 8 chars, 1 letter, 1 number)
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(signUpPassword)) {
      setErrorMessage("รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร ประกอบด้วยตัวอักษรและตัวเลข");
      setLoadingType(null);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: sanitizedEmail,
        password: signUpPassword,
        options: {
          data: {
            student_id: sanitizedStudentId,
            full_name: fullName.trim(),
          },
        },
      });

      if (error) throw error;

      if (data.user && data.session) {
        router.push("/reels");
        router.refresh();
      } else {
        setSuccessMessage("ลงทะเบียนสำเร็จ! กรุณาตรวจสอบอีเมลเพื่อยืนยันตัวตน");
      }
    } catch (err: unknown) {
      const error = err as Error;
      setErrorMessage(error.message || "ไม่สามารถลงทะเบียนได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoadingType(null);
    }
  };

  const handleOAuth = async (provider: "github" | "google") => {
    setLoadingType(provider);
    setErrorMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setErrorMessage(error.message);
      setLoadingType(null);
    }
  };

  return (
    <section className="fixed inset-0 bg-zinc-950 text-zinc-50 overflow-y-auto selection:bg-indigo-500 selection:text-white">
      {/* Background Radial Glow */}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(60%_50%_at_50%_40%,rgba(99,102,241,0.15),transparent_100%)]" />

      {/* Grid Overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-30">
        <div className="absolute top-[18%] left-0 right-0 h-[1px] bg-zinc-800" />
        <div className="absolute top-[50%] left-0 right-0 h-[1px] bg-zinc-800" />
        <div className="absolute top-[82%] left-0 right-0 h-[1px] bg-zinc-800" />
        <div className="absolute left-[22%] top-0 bottom-0 w-[1px] bg-zinc-800" />
        <div className="absolute left-[50%] top-0 bottom-0 w-[1px] bg-zinc-800" />
        <div className="absolute left-[78%] top-0 bottom-0 w-[1px] bg-zinc-800" />
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />

      {/* Header Bar */}
      <header className="absolute left-0 right-0 top-0 flex items-center justify-between px-6 py-4 border-b border-zinc-800/60 backdrop-blur-md z-20">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          <span className="text-xs tracking-[0.2em] font-mono uppercase text-indigo-400 font-bold">
            CS NEXUS PLATFORM
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-md border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-all text-xs"
        >
          <span>คู่มือระบบ</span>
          <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </header>

      {/* Main Container */}
      <div className="min-h-full w-full grid place-items-center px-4 py-24 z-10 relative">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full max-w-md"
        >
          <ShineBorder
            borderRadius={16}
            borderWidth={1.2}
            duration={12}
            color={["#6366F1", "#A855F7", "#EC4899"]}
            className="w-full bg-zinc-900/90 backdrop-blur-xl p-0 border border-zinc-800/80 shadow-2xl shadow-indigo-950/30 overflow-hidden"
          >
            <Card className="border-0 bg-transparent shadow-none w-full">
              <CardHeader className="space-y-1.5 text-center pb-4 pt-6">
                <CardTitle className="text-2xl font-bold tracking-tight text-white">
                  CS NEXUS
                </CardTitle>
                <CardDescription className="text-zinc-400 text-xs">
                  ระบบศูนย์กลางนักศึกษา สังคมออนไลน์ & พื้นที่เรียนรู้สาขา
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4 px-6">
                {errorMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs animate-in fade-in">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {successMessage && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs animate-in fade-in">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                )}

                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                  <TabsList className="grid w-full grid-cols-2 bg-zinc-950/80 border border-zinc-800/80 p-1 mb-4">
                    <TabsTrigger
                      value="login"
                      className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white transition-all"
                    >
                      เข้าสู่ระบบ
                    </TabsTrigger>
                    <TabsTrigger
                      value="signup"
                      className="text-xs data-[state=active]:bg-zinc-800 data-[state=active]:text-white transition-all"
                    >
                      ลงทะเบียน
                    </TabsTrigger>
                  </TabsList>

                  <AnimatePresence mode="wait">
                    {activeTab === "login" && (
                      <TabsContent value="login" key="login-tab">
                        <motion.form
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          transition={{ duration: 0.2 }}
                          onSubmit={handleLogin}
                          className="space-y-3.5"
                        >
                          <div className="space-y-1.5">
                            <Label htmlFor="login-email" className="text-zinc-300 text-xs">
                              อีเมลสถาบัน / บุคลากร
                            </Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="login-email"
                                type="email"
                                required
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                placeholder="student@university.ac.th"
                                className="pl-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9 transition-colors"
                              />
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="login-password" className="text-zinc-300 text-xs">
                              รหัสผ่าน
                            </Label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="login-password"
                                type={showLoginPassword ? "text" : "password"}
                                required
                                value={loginPassword}
                                onChange={(e) => setLoginPassword(e.target.value)}
                                placeholder="••••••••"
                                className="pl-9 pr-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9 transition-colors"
                              />
                              <button
                                type="button"
                                aria-label={showLoginPassword ? "Hide password" : "Show password"}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
                                onClick={() => setShowLoginPassword((v) => !v)}
                              >
                                {showLoginPassword ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <Button
                            type="submit"
                            disabled={loadingType !== null}
                            className="w-full h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-xs transition-all mt-2"
                          >
                            {loadingType === "form" ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "เข้าสู่ระบบ"
                            )}
                          </Button>
                        </motion.form>
                      </TabsContent>
                    )}

                    {activeTab === "signup" && (
                      <TabsContent value="signup" key="signup-tab">
                        <motion.form
                          initial={{ opacity: 0, x: 10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -10 }}
                          transition={{ duration: 0.2 }}
                          onSubmit={handleSignUp}
                          className="space-y-3"
                        >
                          <div className="space-y-1">
                            <Label htmlFor="signup-name" className="text-zinc-300 text-xs">
                              ชื่อ - นามสกุล
                            </Label>
                            <div className="relative">
                              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="signup-name"
                                type="text"
                                required
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="สมชาย ใจดี"
                                className="pl-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="signup-studentid" className="text-zinc-300 text-xs">
                              รหัสนักศึกษา (8-10 หลัก)
                            </Label>
                            <div className="relative">
                              <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="signup-studentid"
                                type="text"
                                required
                                value={studentId}
                                onChange={(e) => setStudentId(e.target.value)}
                                placeholder="66010000"
                                className="pl-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="signup-email" className="text-zinc-300 text-xs">
                              อีเมลสถาบัน
                            </Label>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="signup-email"
                                type="email"
                                required
                                value={signUpEmail}
                                onChange={(e) => setSignUpEmail(e.target.value)}
                                placeholder="student@university.ac.th"
                                className="pl-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="signup-password" className="text-zinc-300 text-xs">
                              รหัสผ่าน (ตัวอักษร + ตัวเลข อย่างน้อย 8 ตัว)
                            </Label>
                            <div className="relative">
                              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                              <Input
                                id="signup-password"
                                type={showSignUpPassword ? "text" : "password"}
                                required
                                value={signUpPassword}
                                onChange={(e) => setSignUpPassword(e.target.value)}
                                placeholder="••••••••"
                                className="pl-9 pr-9 bg-zinc-950/50 border-zinc-800 focus:border-indigo-500 text-zinc-100 placeholder:text-zinc-600 text-xs h-9"
                              />
                              <button
                                type="button"
                                aria-label={showSignUpPassword ? "Hide password" : "Show password"}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 transition-colors"
                                onClick={() => setShowSignUpPassword((v) => !v)}
                              >
                                {showSignUpPassword ? (
                                  <EyeOff className="h-3.5 w-3.5" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          <Button
                            type="submit"
                            disabled={loadingType !== null}
                            className="w-full h-9 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium text-xs transition-all mt-2"
                          >
                            {loadingType === "form" ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "สร้างบัญชีใหม่"
                            )}
                          </Button>
                        </motion.form>
                      </TabsContent>
                    )}
                  </AnimatePresence>
                </Tabs>

                <div className="relative my-4">
                  <Separator className="bg-zinc-800" />
                  <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-zinc-900 px-2 text-[10px] uppercase tracking-widest text-zinc-500">
                    หรือเชื่อมต่อด้วย SSO
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingType !== null}
                    onClick={() => handleOAuth("github")}
                    className="h-9 rounded-lg border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs transition-all"
                  >
                    {loadingType === "github" ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <GithubIcon className="h-3.5 w-3.5 mr-2" />
                    )}
                    GitHub
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loadingType !== null}
                    onClick={() => handleOAuth("google")}
                    className="h-9 rounded-lg border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800 hover:text-white text-xs transition-all"
                  >
                    {loadingType === "google" ? (
                      <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <GoogleIcon className="h-3.5 w-3.5 mr-2" />
                    )}
                    Google
                  </Button>
                </div>
              </CardContent>

              <CardFooter className="flex justify-center border-t border-zinc-800/40 py-3 text-[11px] text-zinc-500 font-mono">
                CS NEXUS INFRASTRUCTURE v1.0
              </CardFooter>
            </Card>
          </ShineBorder>
        </motion.div>
      </div>
    </section>
  );
}