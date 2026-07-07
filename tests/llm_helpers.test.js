const assert = require('assert');
const fs = require('fs');
const path = require('path');

function normalizeLlmBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  return raw.match(/\/v\d+$/i) ? raw : `${raw}/v1`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLlmMarkdown(markdown) {
  const escaped = escapeHtml(markdown);
  const blocks = escaped.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return blocks.map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

function migrateLlmProviders(oldConfig) {
  const providers = Array.isArray(oldConfig.providers) ? oldConfig.providers : [];
  if (providers.length) return providers;
  const hasLegacy = oldConfig.baseUrl || oldConfig.apiKey || oldConfig.model;
  return [{
    id: 'default',
    name: hasLegacy ? '默认供应商' : 'OpenAI Compatible',
    baseUrl: normalizeLlmBaseUrl(oldConfig.baseUrl || ''),
    apiKey: oldConfig.apiKey || '',
    model: oldConfig.model || '',
    modelsCache: Array.isArray(oldConfig.modelsCache) ? oldConfig.modelsCache : [],
  }];
}

function buildLlmChatMessages(contextPrompt, userQuestion, history = [], options = {}) {
  const includeFallbackQuestion = options.includeFallbackQuestion !== false;
  const messages = [{ role: 'system', content: contextPrompt }];
  (Array.isArray(history) ? history.slice(-8) : []).forEach(message => {
    if (['user', 'assistant'].includes(message?.role) && message?.content) {
      messages.push({ role: message.role, content: message.content });
    }
  });
  const question = String(userQuestion || '').trim();
  if (question || includeFallbackQuestion) {
    messages.push({ role: 'user', content: question || '解释当前场景。' });
  }
  return messages;
}

function formatLlmMessagesPreview(messages, { currentQuestionIncluded = false } = {}) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastIndex = safeMessages.length - 1;
  const blocks = ['<实际请求Payload>'];
  safeMessages.forEach((message, index) => {
    const role = message?.role || 'unknown';
    const source = index === 0
      ? 'system-context'
      : (currentQuestionIncluded && index === lastIndex ? 'current-question' : 'chat-history');
    blocks.push(`<message role="${role}" source="${source}">`);
    blocks.push(String(message?.content || ''));
    blocks.push('</message>');
    blocks.push('');
  });
  if (!currentQuestionIncluded) {
    blocks.push('<当前用户问题>');
    blocks.push('未填写。发送时会使用聊天输入框里的问题；这里不会凭空加入旧问题。');
    blocks.push('</当前用户问题>');
    blocks.push('');
  }
  blocks.push('</实际请求Payload>');
  return blocks.join('\n').trim();
}

function predictManualSessionEpisode(previousInfo, currentSeriesOrMovieId, currentEpisodeNumber) {
  if (!previousInfo?.manualSessionMatch || previousInfo.seriesOrMovieId !== currentSeriesOrMovieId) return null;
  const previousEpisodeNumber = previousInfo.episode;
  const previousEpisodeId = parseInt(previousInfo.episodeId, 10);
  if (!previousEpisodeId || !Number.isInteger(previousEpisodeNumber)) return null;

  let delta = 0;
  if (currentEpisodeNumber === previousEpisodeNumber + 1) delta = 1;
  if (currentEpisodeNumber === previousEpisodeNumber - 1) delta = -1;
  if (!delta) return null;

  return {
    episodeId: previousEpisodeId + delta,
    bgmEpisodeIndex: Number.isInteger(previousInfo.bgmEpisodeIndex) ? previousInfo.bgmEpisodeIndex + delta : null,
  };
}

function getAdjacentEpisodeDeltaForTest(previousInfo, currentEpisodeNumber) {
  const previousEpisodeNumber = Number(previousInfo?.episode);
  if (Number.isInteger(previousEpisodeNumber)) {
    if (currentEpisodeNumber === previousEpisodeNumber + 1) return 1;
    if (currentEpisodeNumber === previousEpisodeNumber - 1) return -1;
    return 0;
  }
  const previousEpisodeIndex = previousInfo?.episodeIndex;
  if (currentEpisodeNumber === previousEpisodeIndex + 2) return 1;
  if (currentEpisodeNumber === previousEpisodeIndex) return -1;
  return 0;
}

function resolveTargetEpisodeIndexForTest(currentEpisodeNumber, matchedEpisodeNumber, episodesLength) {
  const targetEpisodeNumber = Number.isInteger(matchedEpisodeNumber) ? matchedEpisodeNumber : currentEpisodeNumber;
  const index = targetEpisodeNumber - 1;
  return index >= 0 && index < episodesLength ? index : null;
}

function extractEpisodeNumberForTest(title) {
  const match = String(title || '').match(/第\s*(\d+)\s*[话話集]/);
  return match ? Number(match[1]) : null;
}

function isCachedEpisodeInfoUsableForTest(cachedInfo, itemInfo) {
  if (!cachedInfo || Number(cachedInfo.episode) !== Number(itemInfo.episode)) return false;
  const matchedEpisodeNumber = Number(cachedInfo.matchedEpisodeNumber);
  const titleEpisodeNumber = extractEpisodeNumberForTest(cachedInfo.episodeTitle);
  if (Number.isInteger(matchedEpisodeNumber)) {
    return titleEpisodeNumber === null || titleEpisodeNumber === matchedEpisodeNumber;
  }
  if (Number.isInteger(titleEpisodeNumber) && titleEpisodeNumber !== Number(itemInfo.episode)) return false;
  return true;
}

function getManualSeasonEpisodeOffsetForTest(selectedIndex, embyEpisodeNumber) {
  return selectedIndex + 1 - embyEpisodeNumber;
}

function getManualSeasonEpisodeCandidateForTest(seasonInfoList, embyEpisodeNumber) {
  let minPositiveEpisode = Infinity;
  let selectedSeasonInfo = null;
  for (const seasonInfo of seasonInfoList) {
    const adjustedEpisode = embyEpisodeNumber + seasonInfo.episodeOffset;
    if (adjustedEpisode > 0 && adjustedEpisode < minPositiveEpisode) {
      minPositiveEpisode = adjustedEpisode;
      selectedSeasonInfo = seasonInfo;
    }
  }
  return selectedSeasonInfo
    ? { season: null, episode: minPositiveEpisode, searchTitleOverride: selectedSeasonInfo.name }
    : null;
}

function selectTargetEpisodeForTest({ episodeIndex, matchedEpisodeNumber, embyEpisodeNumber, episodes }) {
  if (episodeIndex >= 0 && episodeIndex < episodes.length) return episodes[episodeIndex];
  if (episodes.length === 1) return episodes[0];
  const epNumber = Number.isInteger(matchedEpisodeNumber) && matchedEpisodeNumber > 0
    ? matchedEpisodeNumber
    : embyEpisodeNumber;
  return episodes.find(ep =>
    ep.episodeNumber === epNumber ||
    String(ep.episodeTitle || '').includes(`第${epNumber}话`) ||
    String(ep.episodeTitle || '').includes(`第${epNumber}話`) ||
    String(ep.episodeTitle || '').includes(`第${epNumber}集`)
  ) || null;
}

function getBangumiSearchKeywordsForTest(episodeInfo) {
  const seen = new Set();
  const keywords = [];
  const addRaw = (title) => {
    const keyword = String(title || '').trim();
    const normalized = keyword.replace(/\s+/g, '').toLowerCase();
    if (!keyword || seen.has(normalized)) return;
    seen.add(normalized);
    keywords.push(keyword);
  };
  const add = (title) => addRaw(title);

  if (episodeInfo.manualSessionMatch) {
    addRaw(episodeInfo.animeTitle);
  }
  add(episodeInfo.seriesName);
  add(episodeInfo.animeOriginalTitle);
  add(episodeInfo.animeTitle);
  return keywords;
}

function getManualSessionBgmEpisodeIndexForTest(episodeInfo, episodes) {
  const rawIndex = Number(episodeInfo?.bgmEpisodeIndex);
  if (!Number.isInteger(rawIndex) || rawIndex < 0) return null;
  if (!episodeInfo?.manualSessionMatch || episodeInfo.manualSessionBgmEpisodeIndexResolved) return rawIndex;

  const currentEpisodeNumber = Number(episodeInfo.episode);
  const hasEpisodeZero = episodes.some(ep => Number(ep.sort) === 0 || Number(ep.ep) === 0);
  if (!hasEpisodeZero || !Number.isInteger(currentEpisodeNumber) || currentEpisodeNumber < 1) return rawIndex;

  return episodes[rawIndex + 1] ? rawIndex + 1 : rawIndex;
}

function cleanLlmCommentContentForTest(content) {
  return String(content || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeLlmBangumiCommentsForTest(comments) {
  return (Array.isArray(comments) ? comments : [])
    .filter(comment => comment?.state !== 6 && String(comment?.content || '').trim())
    .map(comment => ({
      userName: comment.user?.nickname || comment.user?.username || '匿名',
      createdAt: Number(comment.createdAt || 0),
      timeText: '2026-07-06',
      content: cleanLlmCommentContentForTest(comment.content),
      replies: (Array.isArray(comment.replies) ? comment.replies : [])
        .filter(reply => reply?.state !== 6 && String(reply?.content || '').trim())
        .map(reply => ({
          userName: reply.user?.nickname || reply.user?.username || '匿名',
          content: cleanLlmCommentContentForTest(reply.content),
        })),
    }));
}

function formatLlmBangumiCommentForContextForTest(comment) {
  const lines = [`${comment.userName} ${comment.timeText}`, comment.content];
  (Array.isArray(comment.replies) ? comment.replies : []).forEach(reply => {
    lines.push(`  ↳ ${reply.userName}: ${reply.content}`);
  });
  return lines.join('\n');
}

assert.equal(normalizeLlmBaseUrl('https://api.example.com'), 'https://api.example.com/v1');
assert.equal(normalizeLlmBaseUrl('https://api.example.com/v1/'), 'https://api.example.com/v1');
assert.equal(normalizeLlmBaseUrl(''), '');

assert.deepEqual(migrateLlmProviders({ baseUrl: 'https://api.example.com', apiKey: 'sk', model: 'm' })[0], {
  id: 'default',
  name: '默认供应商',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk',
  model: 'm',
  modelsCache: [],
});

assert.equal(renderLlmMarkdown('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');

const messages = buildLlmChatMessages('ctx', 'current', [
  { role: 'user', content: 'old question' },
  { role: 'assistant', content: 'old answer' },
]);
assert.deepEqual(messages, [
  { role: 'system', content: 'ctx' },
  { role: 'user', content: 'old question' },
  { role: 'assistant', content: 'old answer' },
  { role: 'user', content: 'current' },
]);
assert.equal(buildLlmChatMessages('ctx', '', [], { includeFallbackQuestion: false }).length, 1);
assert(formatLlmMessagesPreview(messages, { currentQuestionIncluded: true }).includes('source="current-question"'));
assert(formatLlmMessagesPreview([{ role: 'system', content: 'ctx' }]).includes('不会凭空加入旧问题'));
assert.deepEqual(predictManualSessionEpisode({
  manualSessionMatch: true,
  seriesOrMovieId: 'series-1',
  episodeId: '159540011',
  episode: 22,
  episodeIndex: 10,
  bgmEpisodeIndex: 10,
}, 'series-1', 23), { episodeId: 159540012, bgmEpisodeIndex: 11 });
assert.equal(predictManualSessionEpisode({
  manualSessionMatch: true,
  seriesOrMovieId: 'series-1',
  episodeId: '159540011',
  episode: 22,
  episodeIndex: 10,
}, 'series-2', 23), null);
assert.equal(getAdjacentEpisodeDeltaForTest({ episode: 20, episodeIndex: 7 }, 21), 1);
assert.equal(resolveTargetEpisodeIndexForTest(20, 8, 12), 7);
assert.equal(isCachedEpisodeInfoUsableForTest({
  episode: 20,
  episodeIndex: 0,
  episodeTitle: '第1話 夢のマイホーム',
}, { episode: 20 }), false);
assert.equal(isCachedEpisodeInfoUsableForTest({
  episode: 20,
  episodeIndex: 7,
  matchedEpisodeNumber: 8,
  episodeTitle: '第8話 迷宮入り',
}, { episode: 20 }), true);
assert.equal(getManualSeasonEpisodeOffsetForTest(7, 20), -12);
assert.deepEqual(getManualSeasonEpisodeCandidateForTest([{
  name: '无职转生Ⅱ ～到了异世界就拿出真本事～ 第二部分',
  episodeOffset: -12,
}], 23), {
  season: null,
  episode: 11,
  searchTitleOverride: '无职转生Ⅱ ～到了异世界就拿出真本事～ 第二部分',
});
assert.equal(selectTargetEpisodeForTest({
  episodeIndex: 22,
  matchedEpisodeNumber: 23,
  embyEpisodeNumber: 23,
  episodes: Array.from({ length: 12 }, (_, index) => ({
    episodeNumber: index + 1,
    episodeTitle: `第${index + 1}話`,
  })),
}), null);
assert.deepEqual(selectTargetEpisodeForTest({
  episodeIndex: 10,
  matchedEpisodeNumber: 11,
  embyEpisodeNumber: 23,
  episodes: Array.from({ length: 12 }, (_, index) => ({
    episodeNumber: index + 1,
    episodeTitle: `第${index + 1}話`,
  })),
}), {
  episodeNumber: 11,
  episodeTitle: '第11話',
});
assert.equal(getBangumiSearchKeywordsForTest({
  manualSessionMatch: true,
  seriesName: '无职转生～到了异世界就拿出真本事～',
  animeTitle: '无职转生 ～在异世界认真地活下去～ 第二部分',
})[0], '无职转生 ～在异世界认真地活下去～ 第二部分');
assert.equal(getManualSessionBgmEpisodeIndexForTest({
  manualSessionMatch: true,
  episode: 1,
  bgmEpisodeIndex: 0,
}, [
  { sort: 0, name_cn: 'EP00' },
  { sort: 1, name_cn: 'EP01' },
  { sort: 2, name_cn: 'EP02' },
]), 1);
assert.equal(getManualSessionBgmEpisodeIndexForTest({
  manualSessionMatch: true,
  manualSessionBgmEpisodeIndexResolved: true,
  episode: 2,
  bgmEpisodeIndex: 2,
}, [
  { sort: 0, name_cn: 'EP00' },
  { sort: 1, name_cn: 'EP01' },
  { sort: 2, name_cn: 'EP02' },
]), 2);
const normalizedBangumiComments = normalizeLlmBangumiCommentsForTest([{
  user: { nickname: '主楼' },
  createdAt: 1783300000,
  content: '主评论',
  replies: [
    { user: { nickname: '回复A' }, createdAt: 1783300001, content: '回复内容A' },
    { user: { nickname: '回复B' }, createdAt: 1783300002, content: '回复内容B' },
  ],
}]);
const formattedBangumiComment = formatLlmBangumiCommentForContextForTest(normalizedBangumiComments[0]);
assert(formattedBangumiComment.includes('↳ 回复A: 回复内容A'));
assert(formattedBangumiComment.includes('↳ 回复B: 回复内容B'));
assert(!formattedBangumiComment.includes('1783300001'), 'Bangumi reply time should not be included in LLM context');

const edeSource = fs.readFileSync(path.join(__dirname, '..', 'ede.js'), 'utf8');
assert(edeSource.includes('manualSessionMatch'), 'manual match should mark current-session-only inference data');
assert(edeSource.includes('window.ede.manualSessionEpisodeInfo'), 'manual match should keep a session-only copy under window.ede');
assert(edeSource.includes('applyManualSessionEpisodeInfo'), 'Bangumi lookup should merge matching manual session info before searching');
assert(edeSource.includes('manualSessionSeason'), 'manual match should prefer season/part parsed from the selected manual title');
assert(edeSource.includes('function getAdjacentEpisodeDelta'), 'adjacent episode inference should compare against Emby episode before DandanPlay episodeIndex');
assert(edeSource.includes('getManualSessionBgmEpisodeIndex'), 'manual session Bangumi mapping should adjust once when Bangumi has EP00');
assert(edeSource.includes('manualSessionBgmEpisodeIndexResolved'), 'manual session Bangumi index should be marked resolved to avoid repeated EP00 offset');
assert(edeSource.includes('formatLlmBangumiCommentForContext'), 'Bangumi episode comments should include replies in LLM context');
assert(edeSource.includes('isCachedEpisodeInfoUsable'), 'cached danmaku match should be validated against current episode before reuse');
assert(edeSource.includes('matchedEpisodeNumber'), 'offset season matches should persist the provider episode number separately from Emby episode');
assert(edeSource.includes('[话話集]'), 'episode number extraction should recognize Japanese 話 titles');
assert(edeSource.includes('function getManualSeasonEpisodeCandidate'), 'manual season offset cache should feed automatic episode search candidates');
assert(edeSource.includes('searchTitleOverride'), 'manual season offset candidate should carry the manually selected anime title');
assert(edeSource.includes('episodeNumSelect.selectedIndex + 1 - window.ede.searchDanmakuOpts.episodeRaw'), 'manual season offset should store provider episode number minus Emby episode number');
assert(!edeSource.includes('let targetEpisode = selectedAnimeEpisodes[0]; // 默认回退到第一集'), 'automatic matching must not default to first episode when target index is out of range');
assert(!edeSource.includes('回退使用第一集'), 'out-of-range automatic matching must refuse first-episode fallback');
assert(edeSource.includes('<输出规范>'), 'default LLM personas should include the output format block');
assert(edeSource.includes('名字可参考<制作信息><角色信息>里的内容'), 'default LLM personas should guide inline-code names from production and character info');
assert(edeSource.includes('回答时更重视 Bangumi 资料、角色关系、制作人员、动画公司、评分样本、弹幕语境和章节讨论。'), 'production persona should prioritize Bangumi, staff, studio, rating, danmaku, and episode comments');
assert(edeSource.includes('可以指出监督、脚本、系列构成、作画、OP/ED、动画制作公司的历史表现与本集观感之间的联系。'), 'production persona should allow staff and studio history analysis');
console.log('llm_helpers.test.js passed');
