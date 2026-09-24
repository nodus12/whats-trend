import axios from "axios";
import { parseStringPromise } from "xml2js";

const googleNewsRssUrl = "https://news.google.com/rss/search";

export async function fetchGoogleNews(query = "AI") {
  const normalizedQuery = query?.trim() || "AI";
  const response = await axios.get(googleNewsRssUrl, {
    params: {
      q: normalizedQuery,
      hl: "ko",
      gl: "KR",
      ceid: "KR:ko",
    },
    responseType: "text",
    timeout: 10000,
  });

  const parsed = await parseStringPromise(response.data, {
    explicitArray: true,
    trim: true,
  });

  const items = parsed?.rss?.channel?.[0]?.item ?? [];

  return items.slice(0, 10).map((item) => ({
    title: item.title?.[0] ?? "",
    link: item.link?.[0] ?? "",
    pubDate: item.pubDate?.[0] ?? "",
    source:
      typeof item.source?.[0] === "string"
        ? item.source[0]
        : item.source?.[0]?._ ?? "",
  }));
}
