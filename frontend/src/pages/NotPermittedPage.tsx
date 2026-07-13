import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";

export function NotPermittedPage() {
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-xl font-semibold">Not permitted</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This staff console doesn't have a candidate-facing area yet. Sign in with a staff account instead.
      </p>
      <Button onClick={() => void logout()}>Sign out</Button>
    </div>
  );
}
