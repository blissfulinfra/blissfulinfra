"""
Scheduler — runs the HN spider immediately on start, then every SCRAPE_INTERVAL_MINUTES minutes.

The spider publishes scraped articles to the Kafka `scraped-articles` topic. The ai-pipeline
service consumes that topic, persists articles to ClickHouse, and uses them to retrain the
recommendation model.
"""
import os
import subprocess
import schedule
import time
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scraper] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

INTERVAL = int(os.getenv("SCRAPE_INTERVAL_MINUTES", "15"))


def run_spider() -> None:
    log.info("Starting HN spider crawl...")
    result = subprocess.run(
        ["scrapy", "crawl", "hn_stories"],
        capture_output=False,
    )
    if result.returncode == 0:
        log.info("Crawl completed successfully.")
    else:
        log.warning("Crawl exited with code %d", result.returncode)


if __name__ == "__main__":
    log.info("Scraper scheduler starting — interval: %d min", INTERVAL)

    # Run immediately on startup so there's data without waiting for the first interval
    run_spider()

    schedule.every(INTERVAL).minutes.do(run_spider)

    while True:
        schedule.run_pending()
        time.sleep(30)
