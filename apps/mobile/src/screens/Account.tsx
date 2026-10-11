import { useNavigate } from "react-router-dom";
import { AuthForm } from "../components/AuthForm";
import { ScreenHeader } from "../components/ScreenHeader";
import { Banner } from "../components/ui";
import { useApp } from "../lib/store";
import { toast } from "../lib/toast";

export function AccountScreen() {
  const navigate = useNavigate();
  const isGuest = useApp((s) => s.user?.is_guest ?? true);
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title={isGuest ? "Create your account" : "Account"} />
      <div className="scroll-area flex-1 px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="mb-4 text-[1rem] text-ink-2">An account keeps your reports, EcoPoints and messages safe if you change phones.</p>
        {isGuest && (
          <Banner tone="info" className="mb-5">
            Everything you did as a guest — your reports and EcoPoints — moves to your new account.
          </Banner>
        )}
        <AuthForm
          initialMode="register"
          onDone={() => {
            toast({ title: "You're signed in", tone: "ok" });
            navigate("/profile", { replace: true });
          }}
        />
      </div>
    </div>
  );
}
