import { useLocation, useNavigate } from "@tanstack/react-router";

export function useRouter() {
  const navigate = useNavigate();

  return {
    push: (to: string) => navigate({ to }),
    replace: (to: string) => navigate({ to, replace: true }),
  };
}

export function useSearchParams() {
  const location = useLocation();
  return new URLSearchParams(location.search);
}
