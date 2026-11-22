import { zodResolver } from "@hookform/resolvers/zod";
import { Package } from "lucide-react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";
import { safeRedirectTarget } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin, useMe } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api-client";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const target = safeRedirectTarget(params.get("next"));
  const me = useMe();
  const login = useLogin();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  if (me.data) return <Navigate to={target} replace />;

  const submit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      navigate(target, { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === "RATE_LIMITED"
          ? "Too many login attempts. Please wait a few minutes and try again."
          : error instanceof ApiError && error.code === "INVALID_CREDENTIALS"
            ? "Invalid email or password."
            : error instanceof ApiError
              ? error.message
              : "Login failed.";
      form.setError("root", { message });
      form.resetField("password");
    }
  });

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <Package className="size-5" aria-hidden="true" />
            <span className="font-semibold">Inventory Admin</span>
          </div>
          <CardTitle className="text-xl">
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Private app. Sign in with your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" aria-invalid={errors.email ? true : undefined} {...form.register("email")} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                {...form.register("password")}
              />
              {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
            </div>
            {errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.message}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
