const assert = require('assert');

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
console.log('llm_helpers.test.js passed');
