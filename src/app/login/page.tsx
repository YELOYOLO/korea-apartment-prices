import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";

export const metadata = { title: "로그인 · Mydream" };

export default function Page() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-10">
      <h1 className="text-2xl font-extrabold">로그인</h1>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
