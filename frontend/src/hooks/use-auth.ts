import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ME_QUERY_KEY } from "@/lib/query-client";
import { fetchMe, login, logout } from "@/services/auth";

export const meQueryKey = ME_QUERY_KEY;

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, retry: false });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (admin) => queryClient.setQueryData(meQueryKey, admin),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Drop every cached server response so nothing from the session lingers.
      queryClient.clear();
      queryClient.setQueryData(meQueryKey, null);
    },
  });
}
