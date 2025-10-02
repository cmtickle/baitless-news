const storiesContainer = document.querySelector('#stories');
const refreshButton = document.createElement('button');
refreshButton.textContent = 'Refresh headlines';
refreshButton.className = 'refresh';
refreshButton.addEventListener('click', loadStories);
document.querySelector('#summary').append(refreshButton);

async function loadStories() {
  storiesContainer.innerHTML = '<p class="placeholder">Fetching updated summaries...</p>';

  try {
    const response = await fetch('/api/news');

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const payload = await response.json();

    if (!Array.isArray(payload?.stories) || payload.stories.length === 0) {
      storiesContainer.innerHTML = '<p class="placeholder">No stories available yet.</p>';
      return;
    }

    storiesContainer.innerHTML = '';
    payload.stories.forEach((story) => {
      const article = document.createElement('article');
      article.className = 'story';

      const heading = document.createElement('h3');
      heading.textContent = story.title ?? 'Untitled story';

      const summary = document.createElement('p');
      summary.textContent = story.summary ?? 'No summary available.';

      article.append(heading, summary);
      storiesContainer.append(article);
    });
  } catch (error) {
    console.error(error);
    storiesContainer.innerHTML = '<p class="placeholder">We could not load the news. Try again soon.</p>';
  }
}

loadStories();
