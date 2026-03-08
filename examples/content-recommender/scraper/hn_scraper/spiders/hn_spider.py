"""
Hacker News spider.

Uses the official HN Firebase JSON API (no HTML scraping):
  https://hacker-news.firebaseio.com/v0/topstories.json   → list of story IDs
  https://hacker-news.firebaseio.com/v0/item/{id}.json    → story detail

Each story is enriched with topic tags extracted from the title using a
keyword vocabulary, then yielded as HnArticleItem for the KafkaPipeline.
"""
import re
from typing import Generator

import scrapy
from scrapy.http import JsonRequest, Response

from hn_scraper.items import HnArticleItem

HN_API = "https://hacker-news.firebaseio.com/v0"
MAX_STORIES = 100   # top N stories to fetch per crawl

# Maps topic label → keywords to look for in the lowercased title.
# A story can match multiple topics.
TOPIC_KEYWORDS: dict[str, list[str]] = {
    "rust":        ["rust", "rustlang", "cargo"],
    "python":      ["python", "django", "fastapi", "flask", "pandas", "numpy"],
    "ai":          ["ai", "llm", "gpt", "machine learning", "neural", "transformer",
                    "diffusion", "openai", "anthropic", "gemini", "claude"],
    "web":         ["react", "vue", "svelte", "angular", "javascript", "typescript",
                    "css", "html", "nextjs", "remix", "htmx", "wasm"],
    "go":          [" go ", "golang"],
    "systems":     ["kernel", "syscall", "memory", "allocator", "compiler", "llvm",
                    "zig", "c++", "assembly"],
    "security":    ["security", "exploit", "vulnerability", "cve", "breach",
                    "ransomware", "phishing", "zero-day"],
    "cloud":       ["aws", "gcp", "azure", "kubernetes", "k8s", "docker",
                    "terraform", "serverless", "lambda"],
    "database":    ["postgres", "mysql", "sqlite", "redis", "mongodb", "clickhouse",
                    "duckdb", "sql", "nosql"],
    "open-source": ["open source", "open-source", "github", "oss", "foss"],
    "startup":     ["startup", "ycombinator", "yc ", "series a", "seed round",
                    "funding", "acquisition"],
    "devtools":    ["ide", "vscode", "neovim", "vim", "terminal", "shell",
                    "cli", "debugging", "profiling"],
}


def extract_tags(title: str) -> list[str]:
    lower = title.lower()
    return [topic for topic, keywords in TOPIC_KEYWORDS.items()
            if any(kw in lower for kw in keywords)]


class HnStoriesSpider(scrapy.Spider):
    name = "hn_stories"
    custom_settings = {
        "CLOSESPIDER_ITEMCOUNT": MAX_STORIES,
    }

    def start_requests(self):
        yield JsonRequest(
            url=f"{HN_API}/topstories.json",
            callback=self.parse_top_stories,
        )

    def parse_top_stories(self, response: Response) -> Generator:
        story_ids: list[int] = response.json()
        self.logger.info("Fetched %d top story IDs, crawling top %d", len(story_ids), MAX_STORIES)

        for story_id in story_ids[:MAX_STORIES]:
            yield JsonRequest(
                url=f"{HN_API}/item/{story_id}.json",
                callback=self.parse_story,
            )

    def parse_story(self, response: Response):
        data: dict = response.json()

        # Only process stories with a title (skip polls, job posts without URLs)
        if not data or data.get("type") != "story" or not data.get("title"):
            return

        story_id = data["id"]
        title = data["title"]
        url = data.get("url") or f"https://news.ycombinator.com/item?id={story_id}"
        score = data.get("score", 0)
        time_ts = data.get("time", 0)
        tags = extract_tags(title)

        yield HnArticleItem(
            id=f"hn-{story_id}",
            title=title,
            url=url,
            score=score,
            tags=tags,
            time=time_ts,
        )
