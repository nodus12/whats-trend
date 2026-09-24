export async function fetchTrends(query = "AI") {
  const normalizedQuery = query.trim() || "AI";
  const response = await fetch(
    `/api/trends?q=${encodeURIComponent(normalizedQuery)}`
  );

  if (!response.ok) {
    throw new Error("트렌드 데이터를 불러오지 못했어요.");
  }

  const data = await response.json();

  if (!data.success || !Array.isArray(data.trends)) {
    throw new Error("트렌드 데이터 형식이 올바르지 않아요.");
  }

  return data;
}
