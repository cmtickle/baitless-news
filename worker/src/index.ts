export interface NewsStory {
  id: string;
  title: string;
  summary: string;
  sourceUrl?: string;
}

interface Env {
  OPENAI_API_KEY: string;
  NEWS_API_KEY: string;
}

const NEWS_ENDPOINT = 'https://newsapi.org/v2/top-headlines?country=gb';
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
      const stories = await fetchAndSummariseStories(env);
      return Response.json({ stories });
    } catch (error) {
      console.error('Failed to fetch news stories', error);
      return new Response('Failed to fetch news stories', { status: 500 });
    }
  },
};

async function fetchAndSummariseStories(env: Env): Promise<NewsStory[]> {
  const newsResponse = await fetch(`${NEWS_ENDPOINT}&apiKey=${env.NEWS_API_KEY}`);
  if (!newsResponse.ok) {
    throw new Error(`News API request failed with status ${newsResponse.status}`);
  }

  const newsData: unknown = await newsResponse.json();
  const articles = Array.isArray((newsData as any)?.articles) ? (newsData as any).articles : [];

  const stories: NewsStory[] = articles.slice(0, MAX_STORIES).map((article: any, index: number) => ({
    id: `story-${index + 1}`,
    title: article.title ?? 'Untitled story',
    summary: article.description ?? '',
    sourceUrl: article.url ?? undefined,
  }));

  if (!stories.length) {
    return stories;
  }

  return enhanceStoriesWithGPT(stories, env.OPENAI_API_KEY);
}

async function enhanceStoriesWithGPT(stories: NewsStory[], apiKey: string): Promise<NewsStory[]> {
  return Promise.all(
    stories.map(async (story) => {
      const prompt = `Rewrite the headline and summary below so they remain factual, concise, and non-clickbait. Separate the rewritten headline and summary with a newline.\n\nHeadline: ${story.title}\nSummary: ${story.summary}`;

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
