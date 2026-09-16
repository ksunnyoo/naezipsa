const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000/api/v1"
).replace(/\/$/, "");

export async function getInsightItems(path, signal, token) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || "데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    error.reason = body?.error?.details?.reason;
    error.retryable = body?.error?.details?.retryable !== false;
    throw error;
  }
  if (!Array.isArray(body?.data)) throw new Error("응답 형식이 올바르지 않습니다.");
  return body.data;
}

export function sourceLink(value) {
  return /^https?:\/\//i.test(value || "") ? value : undefined;
}
