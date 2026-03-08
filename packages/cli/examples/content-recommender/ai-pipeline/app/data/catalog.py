"""
Content catalog for the content-recommender example.

Provides two catalog sources:
  1. Scraped HN articles — loaded from ClickHouse once the scraper has run (~15 min)
  2. Synthetic movie catalog — 50 items used as fallback until real data arrives

Use get_catalog(ch) to get whichever source is available.
"""
from __future__ import annotations
import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass  # avoid circular imports


def get_catalog(ch=None) -> list[dict]:
    """
    Return the active catalog.

    Tries ClickHouse scraped articles first. Falls back to the synthetic
    CATALOG if no articles have been scraped yet or ClickHouse is down.
    """
    if ch is not None:
        try:
            from app.store.recommendations import get_articles
            articles = get_articles(limit=500)
            if articles:
                return _articles_to_catalog(articles)
        except Exception:
            pass
    return CATALOG


def _articles_to_catalog(articles: list[dict]) -> list[dict]:
    """
    Map scraped HN article dicts to the same shape the Recommender expects:
      {id, title, genres, tags, year, rating}

    - genres  = first 3 tags (topic labels extracted by the spider)
    - rating  = HN score normalised to 1–10 scale (log-compressed)
    - year    = current year (articles don't have a release year)
    """
    import datetime
    current_year = datetime.datetime.utcnow().year

    result = []
    for a in articles:
        tags = a.get("tags") or []
        score = a.get("score", 1)
        # Log-compress score into 1–10 range: log10(score+1) / log10(max_score+1) * 9 + 1
        rating = round(min(10.0, max(1.0, math.log10(score + 1) / math.log10(1001) * 9 + 1)), 1)
        result.append({
            "id": a["id"],
            "title": a["title"],
            "genres": tags[:3] if tags else ["tech"],
            "tags": tags,
            "year": current_year,
            "rating": rating,
        })
    return result

CATALOG = [
    # Sci-Fi
    {"id": "m001", "title": "Inception", "genres": ["sci-fi", "thriller"], "tags": ["mind-bending", "heist", "dreams"], "year": 2010, "rating": 8.8},
    {"id": "m002", "title": "Interstellar", "genres": ["sci-fi", "drama"], "tags": ["space", "time", "emotional"], "year": 2014, "rating": 8.6},
    {"id": "m003", "title": "The Matrix", "genres": ["sci-fi", "action"], "tags": ["simulation", "cyberpunk", "revolution"], "year": 1999, "rating": 8.7},
    {"id": "m004", "title": "Arrival", "genres": ["sci-fi", "drama"], "tags": ["aliens", "language", "time"], "year": 2016, "rating": 7.9},
    {"id": "m005", "title": "Ex Machina", "genres": ["sci-fi", "thriller"], "tags": ["AI", "consciousness", "isolation"], "year": 2014, "rating": 7.7},
    {"id": "m006", "title": "Blade Runner 2049", "genres": ["sci-fi", "noir"], "tags": ["cyberpunk", "identity", "memory"], "year": 2017, "rating": 8.0},
    {"id": "m007", "title": "Annihilation", "genres": ["sci-fi", "horror"], "tags": ["mystery", "nature", "identity"], "year": 2018, "rating": 6.8},
    {"id": "m008", "title": "Dune", "genres": ["sci-fi", "adventure"], "tags": ["epic", "politics", "desert"], "year": 2021, "rating": 8.0},

    # Thriller / Drama
    {"id": "m009", "title": "Parasite", "genres": ["thriller", "drama"], "tags": ["class", "deception", "social"], "year": 2019, "rating": 8.6},
    {"id": "m010", "title": "Gone Girl", "genres": ["thriller", "drama"], "tags": ["marriage", "deception", "psychological"], "year": 2014, "rating": 8.1},
    {"id": "m011", "title": "No Country for Old Men", "genres": ["thriller", "crime"], "tags": ["cat-and-mouse", "fate", "violence"], "year": 2007, "rating": 8.2},
    {"id": "m012", "title": "There Will Be Blood", "genres": ["drama"], "tags": ["ambition", "oil", "religion"], "year": 2007, "rating": 8.2},
    {"id": "m013", "title": "Whiplash", "genres": ["drama", "music"], "tags": ["obsession", "jazz", "mentorship"], "year": 2014, "rating": 8.5},
    {"id": "m014", "title": "The Social Network", "genres": ["drama", "biography"], "tags": ["tech", "betrayal", "ambition"], "year": 2010, "rating": 7.8},
    {"id": "m015", "title": "Nightcrawler", "genres": ["thriller", "crime"], "tags": ["media", "obsession", "dark"], "year": 2014, "rating": 7.9},

    # Action / Adventure
    {"id": "m016", "title": "Mad Max: Fury Road", "genres": ["action", "adventure"], "tags": ["post-apocalyptic", "chase", "feminism"], "year": 2015, "rating": 8.1},
    {"id": "m017", "title": "John Wick", "genres": ["action", "thriller"], "tags": ["assassin", "revenge", "stylized"], "year": 2014, "rating": 7.4},
    {"id": "m018", "title": "Mission: Impossible — Fallout", "genres": ["action", "spy"], "tags": ["stunts", "espionage", "chase"], "year": 2018, "rating": 7.7},
    {"id": "m019", "title": "The Dark Knight", "genres": ["action", "superhero"], "tags": ["chaos", "morality", "iconic"], "year": 2008, "rating": 9.0},
    {"id": "m020", "title": "Dunkirk", "genres": ["action", "war"], "tags": ["survival", "immersive", "tense"], "year": 2017, "rating": 7.9},

    # Horror
    {"id": "m021", "title": "Hereditary", "genres": ["horror", "drama"], "tags": ["grief", "supernatural", "disturbing"], "year": 2018, "rating": 7.3},
    {"id": "m022", "title": "Get Out", "genres": ["horror", "thriller"], "tags": ["race", "psychological", "social"], "year": 2017, "rating": 7.7},
    {"id": "m023", "title": "A Quiet Place", "genres": ["horror", "sci-fi"], "tags": ["silence", "family", "survival"], "year": 2018, "rating": 7.5},
    {"id": "m024", "title": "Midsommar", "genres": ["horror", "drama"], "tags": ["cult", "breakup", "folk"], "year": 2019, "rating": 7.1},
    {"id": "m025", "title": "The Witch", "genres": ["horror", "historical"], "tags": ["puritanism", "isolation", "folk"], "year": 2015, "rating": 6.9},

    # Comedy
    {"id": "m026", "title": "The Grand Budapest Hotel", "genres": ["comedy", "drama"], "tags": ["whimsical", "nostalgia", "visual"], "year": 2014, "rating": 8.1},
    {"id": "m027", "title": "Knives Out", "genres": ["comedy", "mystery"], "tags": ["whodunit", "family", "clever"], "year": 2019, "rating": 7.9},
    {"id": "m028", "title": "Game Night", "genres": ["comedy", "thriller"], "tags": ["meta", "fun", "twists"], "year": 2018, "rating": 7.0},
    {"id": "m029", "title": "Superbad", "genres": ["comedy"], "tags": ["coming-of-age", "friendship", "teen"], "year": 2007, "rating": 7.6},
    {"id": "m030", "title": "The Nice Guys", "genres": ["comedy", "crime"], "tags": ["buddy", "70s", "mystery"], "year": 2016, "rating": 7.4},

    # Documentary
    {"id": "m031", "title": "Free Solo", "genres": ["documentary", "adventure"], "tags": ["climbing", "obsession", "fear"], "year": 2018, "rating": 8.2},
    {"id": "m032", "title": "Making a Murderer", "genres": ["documentary", "crime"], "tags": ["justice", "true-crime", "system"], "year": 2015, "rating": 8.6},
    {"id": "m033", "title": "The Last Dance", "genres": ["documentary", "sport"], "tags": ["basketball", "Jordan", "dynasty"], "year": 2020, "rating": 9.1},
    {"id": "m034", "title": "Jiro Dreams of Sushi", "genres": ["documentary", "food"], "tags": ["mastery", "dedication", "Japan"], "year": 2011, "rating": 7.9},
    {"id": "m035", "title": "Won't You Be My Neighbor?", "genres": ["documentary", "biography"], "tags": ["kindness", "television", "childhood"], "year": 2018, "rating": 8.4},

    # Romance / Drama
    {"id": "m036", "title": "Call Me by Your Name", "genres": ["romance", "drama"], "tags": ["summer", "identity", "nostalgia"], "year": 2017, "rating": 7.9},
    {"id": "m037", "title": "La La Land", "genres": ["romance", "musical"], "tags": ["dreams", "sacrifice", "jazz"], "year": 2016, "rating": 8.0},
    {"id": "m038", "title": "Portrait of a Lady on Fire", "genres": ["romance", "drama"], "tags": ["forbidden", "art", "period"], "year": 2019, "rating": 8.1},
    {"id": "m039", "title": "Normal People", "genres": ["romance", "drama"], "tags": ["youth", "connection", "messy"], "year": 2020, "rating": 8.0},
    {"id": "m040", "title": "Eternal Sunshine of the Spotless Mind", "genres": ["romance", "sci-fi"], "tags": ["memory", "heartbreak", "surreal"], "year": 2004, "rating": 8.3},

    # Animation
    {"id": "m041", "title": "Spider-Man: Into the Spider-Verse", "genres": ["animation", "superhero"], "tags": ["multiverse", "style", "identity"], "year": 2018, "rating": 8.4},
    {"id": "m042", "title": "Spirited Away", "genres": ["animation", "fantasy"], "tags": ["miyazaki", "wonder", "growth"], "year": 2001, "rating": 8.6},
    {"id": "m043", "title": "Princess Mononoke", "genres": ["animation", "fantasy"], "tags": ["nature", "war", "miyazaki"], "year": 1997, "rating": 8.4},
    {"id": "m044", "title": "Coco", "genres": ["animation", "drama"], "tags": ["family", "Mexico", "afterlife"], "year": 2017, "rating": 8.4},
    {"id": "m045", "title": "The Lion King", "genres": ["animation", "drama"], "tags": ["classic", "family", "loss"], "year": 1994, "rating": 8.5},

    # Crime / Mystery
    {"id": "m046", "title": "Mindhunter", "genres": ["crime", "thriller"], "tags": ["FBI", "serial-killers", "psychology"], "year": 2017, "rating": 8.6},
    {"id": "m047", "title": "Zodiac", "genres": ["crime", "thriller"], "tags": ["obsession", "unsolved", "journalism"], "year": 2007, "rating": 7.7},
    {"id": "m048", "title": "True Detective S1", "genres": ["crime", "drama"], "tags": ["Louisiana", "philosophy", "dark"], "year": 2014, "rating": 9.0},
    {"id": "m049", "title": "Prisoners", "genres": ["crime", "drama"], "tags": ["kidnapping", "morality", "desperation"], "year": 2013, "rating": 8.1},
    {"id": "m050", "title": "Chinatown", "genres": ["crime", "noir"], "tags": ["classic", "corruption", "LA"], "year": 1974, "rating": 8.1},
]

# Build a fast lookup dict
CATALOG_BY_ID = {item["id"]: item for item in CATALOG}

# Seed interactions: (user_id, item_id, event_type, value)
# Represents plausible watch histories for initial model training
SEED_INTERACTIONS = [
    # Sci-fi enthusiast
    ("user_seed_1", "m001", "view_complete", 1.0),
    ("user_seed_1", "m002", "view_complete", 1.0),
    ("user_seed_1", "m003", "view_complete", 1.0),
    ("user_seed_1", "m004", "view_complete", 0.9),
    ("user_seed_1", "m005", "view_complete", 1.0),
    ("user_seed_1", "m006", "view_complete", 0.8),
    ("user_seed_1", "m008", "view_complete", 1.0),
    ("user_seed_1", "m040", "view_complete", 0.7),

    # Action / thriller fan
    ("user_seed_2", "m016", "view_complete", 1.0),
    ("user_seed_2", "m017", "view_complete", 1.0),
    ("user_seed_2", "m018", "view_complete", 0.9),
    ("user_seed_2", "m019", "view_complete", 1.0),
    ("user_seed_2", "m011", "view_complete", 0.8),
    ("user_seed_2", "m015", "view_complete", 0.9),
    ("user_seed_2", "m020", "view_complete", 0.7),

    # Drama / prestige TV
    ("user_seed_3", "m009", "view_complete", 1.0),
    ("user_seed_3", "m013", "view_complete", 1.0),
    ("user_seed_3", "m014", "view_complete", 0.9),
    ("user_seed_3", "m012", "view_complete", 0.8),
    ("user_seed_3", "m048", "view_complete", 1.0),
    ("user_seed_3", "m046", "view_complete", 1.0),
    ("user_seed_3", "m039", "view_complete", 0.7),

    # Horror enthusiast
    ("user_seed_4", "m021", "view_complete", 1.0),
    ("user_seed_4", "m022", "view_complete", 1.0),
    ("user_seed_4", "m023", "view_complete", 0.9),
    ("user_seed_4", "m024", "view_complete", 0.8),
    ("user_seed_4", "m025", "view_complete", 0.9),
    ("user_seed_4", "m007", "view_complete", 0.6),

    # Documentary / non-fiction
    ("user_seed_5", "m031", "view_complete", 1.0),
    ("user_seed_5", "m032", "view_complete", 1.0),
    ("user_seed_5", "m033", "view_complete", 1.0),
    ("user_seed_5", "m034", "view_complete", 0.9),
    ("user_seed_5", "m035", "view_complete", 0.8),

    # Animation / family
    ("user_seed_6", "m041", "view_complete", 1.0),
    ("user_seed_6", "m042", "view_complete", 1.0),
    ("user_seed_6", "m043", "view_complete", 0.9),
    ("user_seed_6", "m044", "view_complete", 1.0),
    ("user_seed_6", "m045", "view_complete", 0.8),

    # Cross-genre watchers (helps collaborative filtering bridge clusters)
    ("user_seed_7", "m001", "view_complete", 1.0),
    ("user_seed_7", "m009", "view_complete", 1.0),
    ("user_seed_7", "m013", "view_complete", 0.9),
    ("user_seed_7", "m027", "view_complete", 0.8),
    ("user_seed_7", "m031", "view_complete", 0.7),

    ("user_seed_8", "m019", "view_complete", 1.0),
    ("user_seed_8", "m041", "view_complete", 1.0),
    ("user_seed_8", "m026", "view_complete", 0.9),
    ("user_seed_8", "m037", "view_complete", 0.8),
    ("user_seed_8", "m044", "view_complete", 0.9),
]
