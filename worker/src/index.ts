export interface NewsStory {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
}

interface Env {
  OPENAI_API_KEY: string;
}

const EXPRESS_RSS_FEED = 'https://www.express.co.uk/posts/rss/1';
const MAX_STORIES = 12;

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
      'User-Agent': 'baitless-news-worker/1.0 (https://baitless-news.hypothetic.dev)',
    },
  });

  if (!rssResponse.ok) {
    throw new Error(`Express RSS request failed with status ${rssResponse.status}`);
  }

  const rssText = await rssResponse.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(rssText, 'application/xml');
  const items = Array.from(xml.querySelectorAll('item'));

  const stories: NewsStory[] = items.slice(0, MAX_STORIES).map((item, index) => {
    const title = getNodeText(item, 'title');
    const description = getNodeText(item, 'description');

    return {
      id: getNodeText(item, 'guid') || `story-${index + 1}`,
      title: title || 'Untitled story',
      summary: stripHtml(description),
      sourceUrl: getNodeText(item, 'link') || undefined,
    };
  });

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
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 200,
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
        title: maybeTitle?.replace(/^Title\s*:?/i, '').trim() || story.title,
        summary: enhancedSummary || story.summary,
      };
    }),
  );
}

function getNodeText(node: Element, selector: string): string {
  return node.querySelector(selector)?.textContent?.trim() ?? '';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
