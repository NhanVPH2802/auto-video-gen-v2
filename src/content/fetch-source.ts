import axios from "axios";

export interface SourceContent {
  title: string;
  url: string;
  domain: string;
  image: string | null;
  content: string;
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMeta(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function extractTitle(html: string): string | null {
  return (
    extractMeta(html, "og:title") ??
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
    null
  );
}

function parseGitHubRepository(
  inputUrl: string,
): { owner: string; repo: string } | null {
  const url = new URL(inputUrl);

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
  };
}

async function fetchGitHubRepository(
  url: string,
  owner: string,
  repo: string,
): Promise<SourceContent> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "auto-video-gen",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repositoryResponse = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}`,
    {
      headers,
      timeout: 30000,
    },
  );

  let readme = "";

  try {
    const readmeResponse = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        headers: {
          ...headers,
          Accept: "application/vnd.github.raw+json",
        },
        timeout: 30000,
        responseType: "text",
      },
    );

    readme =
      typeof readmeResponse.data === "string"
        ? readmeResponse.data
        : JSON.stringify(readmeResponse.data);
  } catch {
    readme = "Repository README không khả dụng.";
  }

  const repository = repositoryResponse.data;

  const summary = [
    `Repository: ${repository.full_name}`,
    `Description: ${repository.description ?? "Không có mô tả"}`,
    `Primary language: ${repository.language ?? "Không xác định"}`,
    `Stars: ${repository.stargazers_count ?? 0}`,
    `Forks: ${repository.forks_count ?? 0}`,
    `Open issues: ${repository.open_issues_count ?? 0}`,
    `Topics: ${(repository.topics ?? []).join(", ") || "Không có"}`,
    `License: ${repository.license?.name ?? "Không xác định"}`,
    `Homepage: ${repository.homepage ?? "Không có"}`,
    "",
    "README:",
    readme,
  ].join("\n");

  return {
    title: repository.full_name,
    url,
    domain: "github.com",
    image: repository.owner?.avatar_url ?? null,
    content: summary.slice(0, 12000),
  };
}

export async function fetchSource(input: string): Promise<SourceContent> {
  const normalizedUrl = /^https?:\/\//i.test(input)
    ? input
    : `https://${input}`;

  const githubRepository = parseGitHubRepository(normalizedUrl);

  if (githubRepository) {
    return fetchGitHubRepository(
      normalizedUrl,
      githubRepository.owner,
      githubRepository.repo,
    );
  }

  const response = await axios.get<string>(normalizedUrl, {
    timeout: 30000,
    maxRedirects: 5,
    responseType: "text",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  const html =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);

  const parsedUrl = new URL(normalizedUrl);
  const title = extractTitle(html) ?? parsedUrl.hostname;
  const image = extractMeta(html, "og:image");
  const description =
    extractMeta(html, "og:description") ??
    extractMeta(html, "description") ??
    "";

  const text = cleanHtml(html);

  return {
    title,
    url: normalizedUrl,
    domain: parsedUrl.hostname,
    image,
    content: [`Tiêu đề: ${title}`, `Mô tả: ${description}`, "", text]
      .join("\n")
      .slice(0, 12000),
  };
}
