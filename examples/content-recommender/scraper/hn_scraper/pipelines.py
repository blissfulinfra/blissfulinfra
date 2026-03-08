"""
Kafka item pipeline.

Each scraped HnArticleItem is serialised to JSON and published to the
`scraped-articles` Kafka topic. The ai-pipeline service consumes this
topic and persists articles to ClickHouse for model training.
"""
import json
import logging
from kafka import KafkaProducer
from scrapy import Spider
from scrapy.crawler import Crawler

log = logging.getLogger(__name__)


class KafkaPipeline:
    def __init__(self, bootstrap_servers: str, topic: str) -> None:
        self.bootstrap_servers = bootstrap_servers
        self.topic = topic
        self.producer: KafkaProducer | None = None

    @classmethod
    def from_crawler(cls, crawler: Crawler) -> "KafkaPipeline":
        return cls(
            bootstrap_servers=crawler.settings.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
            topic=crawler.settings.get("SCRAPED_TOPIC", "scraped-articles"),
        )

    def open_spider(self, spider: Spider) -> None:
        try:
            self.producer = KafkaProducer(
                bootstrap_servers=self.bootstrap_servers,
                value_serializer=lambda v: json.dumps(v).encode("utf-8"),
                acks="all",
                retries=3,
            )
            log.info("Kafka producer connected to %s (topic: %s)", self.bootstrap_servers, self.topic)
        except Exception as exc:
            log.error("Failed to connect to Kafka: %s — items will be dropped", exc)
            self.producer = None

    def close_spider(self, spider: Spider) -> None:
        if self.producer:
            self.producer.flush()
            self.producer.close()
            log.info("Kafka producer closed")

    def process_item(self, item: dict, spider: Spider) -> dict:
        if self.producer is None:
            log.warning("Kafka unavailable — dropping item: %s", item.get("id"))
            return item

        try:
            self.producer.send(self.topic, dict(item))
            log.debug("Published article %s to %s", item.get("id"), self.topic)
        except Exception as exc:
            log.warning("Failed to publish %s: %s", item.get("id"), exc)

        return item
