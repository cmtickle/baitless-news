const storiesContainer = document.querySelector('#stories');
const detailPill = document.querySelector('#detail-level');
const refreshButton = document.createElement('button');
refreshButton.textContent = 'Refresh headlines';
refreshButton.className = 'refresh';
refreshButton.addEventListener('click', () => loadStories(true));
document.querySelector('#summary').append(refreshButton);

async function loadStories(isRefresh = false) {
  if (isRefresh) {
    storiesContainer.innerHTML = '<p class="placeholder">Fetching updated summaries...</p>';
  }

  try {
    const response = await fetch('/api/news');

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    const payload = await response.json();

    const stories = Array.isArray(payload?.stories) ? payload.stories : [];

    if (payload?.detail) {
      detailPill.hidden = false;
      detailPill.textContent = `${capitalise(payload.detail)} detail`;
    } else {
      detailPill.hidden = true;
      detailPill.textContent = '';
    }

    if (!stories.length) {
      storiesContainer.innerHTML = '<p class="placeholder">No stories available yet.</p>';
      return;
    }

    storiesContainer.innerHTML = '';
    stories.forEach((story, index) => {
      const card = createStoryCard(story, index);
      storiesContainer.append(card);
    });
  } catch (error) {
    console.error(error);
    storiesContainer.innerHTML = '<p class="placeholder">We could not load the news. Try again soon.</p>';
  }
}

function createStoryCard(story, index) {
  const {
    betterTitle,
    betterSummary,
    title,
    summary,
    sourceUrl,
  } = story;

  const friendlyTitle = betterTitle?.trim() || title?.trim() || 'Untitled story';
  const friendlySummary = betterSummary?.trim() || summary?.trim() || 'No summary available.';
  const originalTitle = title?.trim() || friendlyTitle;
  const originalSummary = summary?.trim() || friendlySummary;

  const article = document.createElement('article');
  article.className = 'story card';
  article.dataset.side = 'rewrite';

  const front = document.createElement('div');
  front.className = 'card-face card-face--front';

  const frontHeading = document.createElement('h3');
  frontHeading.textContent = friendlyTitle;

  const frontBadge = document.createElement('span');
  frontBadge.className = 'badge';
  frontBadge.textContent = 'Calmer rewrite';
  frontHeading.append(frontBadge);

  const frontSummary = document.createElement('p');
  frontSummary.textContent = friendlySummary;

  const frontActions = document.createElement('div');
  frontActions.className = 'card-actions';

  const revealButton = document.createElement('button');
  revealButton.type = 'button';
  revealButton.className = 'toggle-card';
  revealButton.dataset.action = 'show-original';
  revealButton.textContent = 'Show original';
  revealButton.setAttribute('aria-expanded', 'false');
  revealButton.addEventListener('click', () => {
    flipCard(article, true);
    const target = article.querySelector('[data-action="hide-original"]');
    if (target instanceof HTMLElement) {
      target.focus();
    }
  });

  const readLink = createSourceLink(sourceUrl, 'Open article');

  frontActions.append(revealButton, readLink);
  front.append(frontHeading, frontSummary, frontActions);

  const back = document.createElement('div');
  back.className = 'card-face card-face--back';
  back.id = `original-${index}`;

  const backHeading = document.createElement('h3');
  backHeading.textContent = originalTitle;

  const backBadge = document.createElement('span');
  backBadge.className = 'badge badge--subtle';
  backBadge.textContent = 'Original';
  backHeading.append(backBadge);

  const backSummary = document.createElement('p');
  backSummary.textContent = originalSummary;

  const backActions = document.createElement('div');
  backActions.className = 'card-actions';

  const hideButton = document.createElement('button');
  hideButton.type = 'button';
  hideButton.className = 'toggle-card';
  hideButton.dataset.action = 'hide-original';
  hideButton.textContent = 'Back to rewrite';
  hideButton.setAttribute('aria-expanded', 'true');
  hideButton.addEventListener('click', () => {
    flipCard(article, false);
    if (revealButton instanceof HTMLElement) {
      revealButton.focus();
    }
  });

  const backReadLink = createSourceLink(sourceUrl, 'Read on Express');

  backActions.append(hideButton, backReadLink);
  back.append(backHeading, backSummary, backActions);

  article.append(front, back);

  return article;
}

function flipCard(card, showOriginal) {
  card.dataset.side = showOriginal ? 'original' : 'rewrite';

  const showButton = card.querySelector('[data-action="show-original"]');
  const hideButton = card.querySelector('[data-action="hide-original"]');

  if (showButton) {
    showButton.setAttribute('aria-expanded', showOriginal ? 'true' : 'false');
  }

  if (hideButton) {
    hideButton.setAttribute('aria-expanded', showOriginal ? 'true' : 'false');
  }
}

function createSourceLink(href, label) {
  if (href) {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'source-link';
    link.textContent = label;
    return link;
  }

  const disabled = document.createElement('span');
  disabled.className = 'source-link source-link--disabled';
  disabled.textContent = 'No source URL';
  disabled.setAttribute('aria-disabled', 'true');
  return disabled;
}

function capitalise(value) {
  if (!value) {
    return '';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

loadStories();
