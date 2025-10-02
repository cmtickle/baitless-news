import { DOMParser } from 'linkedom';

export interface NewsStory {
  id: string;
  title: string;
  betterTitle?: string;
  summary: string;
  betterSummary?: string;
  sourceUrl?: string;
  articleContent?: string;
}

interface Env {
  OPENAI_API_KEY: string;
}

const EXPRESS_RSS_FEED = 'https://www.express.co.uk/posts/rss/1';
const MAX_STORIES = 12;
const ARTICLE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const EXPRESS_HEADERS = {
  'User-Agent': ARTICLE_USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  Referer: 'https://www.express.co.uk/',
};

// Cloudflare Worker entry point
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET' },
      });
    }

    try {
      const stories = await fetchAndSummariseStories(env.OPENAI_API_KEY);
      return Response.json({ stories });
    } catch (error) {
      console.error('Failed to fetch news stories', error);
      return new Response('Failed to fetch news stories', { status: 500 });
    }
  },
};

async function fetchAndSummariseStories(openAiKey: string): Promise<NewsStory[]> {
  const rssResponse = await fetch(EXPRESS_RSS_FEED, {
    headers: EXPRESS_HEADERS,
  });

  if (!rssResponse.ok) {
    throw new Error(`Express RSS request failed with status ${rssResponse.status}`);
  }

  const rssText = await rssResponse.text();
  const rawItems = parseRssItems(rssText);

  //populate the stories and call the fetchArticleContent function
  const stories: NewsStory[] = await Promise.all(
    rawItems.slice(0, MAX_STORIES).map(async (item, index) => {
      let articleContent: string | undefined;

      if (item.link) {
        try {
          articleContent = await fetchArticleContent(item.link);
        } catch (error) {
          console.warn('Failed to fetch article body for', item.link, error);
        }
      }

      const title = decodeEntities(item.title);
      const description = decodeEntities(item.description);

      return {
        id: item.guid || `story-${index + 1}`,
        title: title || 'Untitled story',
        summary: stripHtml(description),
        sourceUrl: item.link || undefined,
        articleContent,
      };
    })
  );

  if (!stories.length || !openAiKey) {
    return stories;
  }

  return enhanceStoriesWithGPT(stories, openAiKey);
}

async function enhanceStoriesWithGPT(stories: NewsStory[], apiKey: string): Promise<NewsStory[]> {
  return Promise.all(
    stories.map(async (story) => {
      const articleContent = story.articleContent?.trim() || '';
      const prompt = buildPrompt(story, articleContent);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5-nano',
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed with status ${response.status}`);
      }

      const data: any = await response.json();
      const enhancedText: string | undefined = data?.choices?.[0]?.message?.content;

      if (!enhancedText) {
        console.warn('OpenAI response missing content for story', story.id);
        return {
          ...story,
          articleContent: articleContent || story.articleContent,
        };
      }

      const [maybeTitle, ...rest] = enhancedText.split('\n');
      const enhancedSummary = rest.join('\n').replace(/^Summary\s*:?/i, '').trim();

      return {
        ...story,
        articleContent: articleContent || story.articleContent,
        betterTitle: maybeTitle?.replace(/^Title\s*:?/i, '').trim() || story.title,
        betterSummary: enhancedSummary || story.summary,
      };
    }),
  );
}

async function fetchArticleContent(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: EXPRESS_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Article request failed with status ${response.status}`);
  }

  const html = await response.text();
  return extractArticleBody(html);
}

function buildPrompt(story: NewsStory, articleContent: string): string {
  let prompt = 'Rewrite the headline and summary below so they remain factual, concise, and non-clickbait containing specifics rather than generalisations. Separate the rewritten headline and summary with a newline.';
  prompt += `\n\nHeadline: ${story.title}`;
  prompt += `\nSummary: ${story.summary}`;

  if (articleContent) {
    prompt += `\n\nArticle Content:\n${truncate(articleContent, 4000)}`;
  }

  return prompt;
}

function extractArticleBody(html: string): string {
  const document = parseDocument(html, 'text/html');
  const articleDivs = Array.from(
    document.querySelectorAll('.text-description > p'),
  );

  const paragraphs = articleDivs
    .map((element) => element.textContent?.trim() ?? '')
    .filter((text) => text.length > 0);

  if (paragraphs.length) {
    return paragraphs.join('\n');
  }

  const fallback = document
    .querySelector('meta[property="og:description"], meta[name="description"]')
    ?.getAttribute('content');

  return fallback?.trim() ?? '';
}

function parseRssItems(xml: string): Array<{
  title: string;
  description: string;
  link: string;
  guid: string;
}> {
  const document = parseDocument(xml, 'application/xml');
  const items = Array.from(document.querySelectorAll('item'));

  return items.map((item) => ({
    title: getText(item, ['title']) || 'Untitled story',
    description: getText(item, ['description', 'content\\:encoded']) || '',
    link: getText(item, ['link']) || '',
    guid: getText(item, ['guid']) || '',
  }));
}

function getText(parent: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const node = parent.querySelector(selector);
    if (!node) {
      continue;
    }

    const text = decodeEntities(node.textContent ?? '').trim();
    if (text) {
      return text;
    }

    const cdata = Array.from(node.childNodes ?? [])
      .map((child: any) => {
        if (child?.nodeType === 3 || child?.nodeType === 4) {
          return decodeEntities(child.data ?? child.textContent ?? '').trim();
        }
        return '';
      })
      .filter(Boolean)
      .join(' ')
      .trim();

    if (cdata) {
      return cdata;
    }
  }

  return '';
}

function stripHtml(value: string): string {
  if (!value) {
    return '';
  }
  const decoded = decodeEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>/gi, '<p>\n');

  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDocument(content: string, type: 'text/html' | 'application/xml'): Document {
  const parsed = new DOMParser().parseFromString(content, type) as any;
  return parsed?.document ?? parsed;
}

function decodeEntities(value: string): string {
  if (!value) {
    return '';
  }

  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}
