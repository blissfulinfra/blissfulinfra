import os

BOT_NAME = "hn_scraper"
SPIDER_MODULES = ["hn_scraper.spiders"]
NEWSPIDER_MODULE = "hn_scraper.spiders"

# Polite crawling — HN API is fast so 0.5s is plenty
DOWNLOAD_DELAY = 0.5
RANDOMIZE_DOWNLOAD_DELAY = True

# Stop after 100 items per run (top 100 HN stories)
CLOSESPIDER_ITEMCOUNT = 100

# Kafka output pipeline
ITEM_PIPELINES = {
    "hn_scraper.pipelines.KafkaPipeline": 300,
}

# Kafka settings (injected by docker-compose)
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
SCRAPED_TOPIC = os.getenv("SCRAPED_TOPIC", "scraped-articles")

# Respect robots.txt
ROBOTSTXT_OBEY = False  # HN API has no robots.txt

# Reduce log noise
LOG_LEVEL = "INFO"

# Disable cookies (API requests don't need them)
COOKIES_ENABLED = False

REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
FEED_EXPORT_ENCODING = "utf-8"
