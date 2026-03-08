import scrapy


class HnArticleItem(scrapy.Item):
    """A single Hacker News story, ready to be published to Kafka."""
    id = scrapy.Field()       # "hn-{story_id}"
    title = scrapy.Field()    # story title
    url = scrapy.Field()      # linked URL (or HN comments URL if no external link)
    score = scrapy.Field()    # HN karma score
    tags = scrapy.Field()     # extracted topic tags (list of strings)
    time = scrapy.Field()     # unix timestamp of submission
