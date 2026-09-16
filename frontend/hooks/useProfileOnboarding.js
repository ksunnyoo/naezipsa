"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMyProfile, updateMyProfile } from "@/lib/api";

export default function useProfileOnboarding(userId) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(null);

  useEffect(() => {
    const current = Symbol("profile request");
    generation.current = current;
    if (userId) {
      getMyProfile(userId).then((profile) => {
        if (current !== generation.current) return;
        if (profile.user_id !== userId) throw new Error("프로필 사용자를 확인하지 못했어요.");
        setState({ userId, profile, error: "" });
      }).catch((error) => {
        if (current === generation.current) {
          setState({ userId, profile: null, error: error.message });
        }
      });
    }
    return () => { generation.current = null; };
  }, [userId, attempt]);

  const save = useCallback(async (payload) => {
    const current = generation.current;
    const profile = await updateMyProfile(payload, userId);
    if (current !== generation.current) return false;
    if (profile.user_id !== userId) throw new Error("프로필 사용자를 확인하지 못했어요.");
    // 재로그인 조회보다 PATCH가 먼저 완료되면 늦은 GET은 폐기한다.
    generation.current = Symbol("profile saved");
    setState({ userId, profile, error: "" });
    return profile;
  }, [userId]);

  const retry = useCallback(() => {
    setState(null);
    setAttempt((value) => value + 1);
  }, []);
  const active = userId && state?.userId === userId ? state : null;
  return { profile: active?.profile ?? null, error: active?.error ?? "", retry, save };
}
