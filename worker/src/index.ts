export interface NewsStory {
  id: string;
  title: string;
  betterTitle?: string;
  summary: string;
  betterSummary?: string;
  sourceUrl?: string;
}

interface Env {
  OPENAI_API_KEY: string;
}

const EXPRESS_RSS_FEED = 'https://www.express.co.uk/posts/rss/1';
const MAX_STORIES = 12;
const ARTICLE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

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
    headers: {
      'User-Agent': ARTICLE_USER_AGENT,
    },
  });

  if (!rssResponse.ok) {
    throw new Error(`Express RSS request failed with status ${rssResponse.status}`);
  }

  const rssText = await rssResponse.text();
  const rawItems = parseRssItems(rssText);

  const stories: NewsStory[] = rawItems.slice(0, MAX_STORIES).map((item, index) => ({
    id: item.guid || `story-${index + 1}`,
    title: item.title || 'Untitled story',
    summary: stripHtml(item.description),
    sourceUrl: item.link || undefined,
  }));

  if (!stories.length || !openAiKey) {
    return stories;
  }

  return enhanceStoriesWithGPT(stories, openAiKey);
}

async function enhanceStoriesWithGPT(stories: NewsStory[], apiKey: string): Promise<NewsStory[]> {
  return Promise.all(
    stories.map(async (story) => {
      const prompt = `Rewrite the headline and summary below so they remain factual, concise, and non-clickbait. Separate the rewritten headline and summary with a newline.\\n\\nHeadline: ${story.title}\\nSummary: ${story.summary}`;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-5-nano',
          messages: [{ role: 'user', content: prompt }]
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI request failed with status ${response.status}`);
      }

      const data: any = await response.json();
      const enhancedText: string | undefined = data?.choices?.[0]?.message?.content;

      if (!enhancedText) {
        console.warn('OpenAI response missing content for story', story.id);
        return story;
      }

      const [maybeTitle, ...rest] = enhancedText.split('\n');
      const enhancedSummary = rest.join('\n').replace(/^Summary\s*:?/i, '').trim();

      return {
        ...story,
        betterTitle: maybeTitle?.replace(/^Title\s*:?/i, '').trim() || story.title,
        betterSummary: enhancedSummary || story.summary,
      };
    }),
  );
}

function parseRssItems(xml: string): Array<{ title: string; description: string; link: string; guid: string }> {
  const itemRegex = /<item\b[\s\S]*?<\/item>/gi;
  const items: Array<{ title: string; description: string; link: string; guid: string }> = [];

  for (const match of xml.matchAll(itemRegex)) {
    const block = match[0];
    items.push({
      title: extractTag(block, 'title'),
      description: extractTag(block, 'description'),
      link: extractTag(block, 'link'),
      guid: extractTag(block, 'guid'),
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(pattern);
  if (!match) {
    return '';
  }

  const content = match[1]
    .replace(/<!\[CDATA\[([\\s\\S]*?)\]\]>/gi, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

  return content;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
