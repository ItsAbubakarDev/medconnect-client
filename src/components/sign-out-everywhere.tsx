"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useAuth } from "@/lib/auth";

import { ConfirmDialog } from "./confirm-dialog";
import { LogoutNote } from "./navbar";
import { Button, Card } from "./ui";

/** "Log out of all devices": ends every session of the account, this one included. */
export function SignOutEverywhere() {
  const { logoutAll } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function confirm() {
    await logoutAll();
    setConfirming(false);
    router.push("/login");
  }

  return (
    <Card>
      <h2 className="font-semibold text-ink">Signed-in devices</h2>
      <p className="mt-1 text-sm text-slate-600">
        Signed in on a phone or computer you no longer use, or worried someone else knows your password? Log out
        everywhere at once. Resetting your password does this too.
      </p>
      <Button variant="danger" className="mt-4" onClick={() => setConfirming(true)}>
        Log out of all devices
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Log out of all devices?"
          confirmLabel="Log out everywhere"
          busyLabel="Logging out…"
          cancelLabel="Stay logged in"
          tone="danger"
          onConfirm={confirm}
          onClose={() => setConfirming(false)}
        >
          <p>Every browser and phone signed in to your account is logged out straight away, including this one.</p>
          <LogoutNote />
        </ConfirmDialog>
      )}
    </Card>
  );
}
