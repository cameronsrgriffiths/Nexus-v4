// Embeddable Nexus widget SDK.
//
// Usage:
//   <script src="/widget.js" data-channel-id="<uuid>"></script>
//
// The script reads its data-channel-id, generates a per-tab widget session id
// (kept in sessionStorage so a tab refresh keeps the same conversation), and
// renders a fixed-position chat panel that POSTs to /widget/messages.
//
// Plain JS, no framework — this is what a third-party site embeds.
(function () {
  var script = document.currentScript;
  var channelId = script && script.getAttribute('data-channel-id');
  var apiBase = (script && script.getAttribute('data-api-base')) || '';
  if (!channelId) {
    console.warn('[nexus-widget] missing data-channel-id');
    return;
  }

  var sessionKey = 'nexus.widget.session.' + channelId;
  var widgetSessionId = sessionStorage.getItem(sessionKey);
  if (!widgetSessionId) {
    widgetSessionId = 'w-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem(sessionKey, widgetSessionId);
  }

  var root = document.createElement('div');
  root.setAttribute('data-testid', 'nexus-widget');
  root.style.cssText =
    'position:fixed;bottom:16px;right:16px;width:320px;max-height:480px;display:flex;flex-direction:column;font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;border:1px solid #1e293b;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.35);z-index:2147483647;';

  var header = document.createElement('div');
  header.textContent = 'Chat';
  header.style.cssText = 'padding:10px 14px;border-bottom:1px solid #1e293b;font-weight:600;';
  root.appendChild(header);

  var log = document.createElement('div');
  log.setAttribute('data-testid', 'nexus-widget-log');
  log.style.cssText = 'flex:1;overflow:auto;padding:10px 14px;display:flex;flex-direction:column;gap:8px;';
  root.appendChild(log);

  var form = document.createElement('form');
  form.style.cssText = 'display:flex;gap:8px;padding:10px;border-top:1px solid #1e293b;';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a message…';
  input.setAttribute('data-testid', 'nexus-widget-input');
  input.style.cssText =
    'flex:1;background:#020617;color:#f8fafc;border:1px solid #1e293b;border-radius:6px;padding:6px 10px;font:inherit;';
  var button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Send';
  button.setAttribute('data-testid', 'nexus-widget-send');
  button.style.cssText =
    'background:#22c55e;color:#020617;border:0;border-radius:6px;padding:6px 12px;font:inherit;font-weight:600;cursor:pointer;';
  form.appendChild(input);
  form.appendChild(button);
  root.appendChild(form);
  document.body.appendChild(root);

  function append(role, content) {
    var bubble = document.createElement('div');
    bubble.setAttribute('data-role', role);
    bubble.setAttribute('data-testid', 'nexus-widget-message-' + role);
    bubble.textContent = content;
    bubble.style.cssText =
      'padding:6px 10px;border-radius:8px;max-width:88%;word-wrap:break-word;' +
      (role === 'user'
        ? 'align-self:flex-end;background:#1e40af;color:#f8fafc;'
        : 'align-self:flex-start;background:#1e293b;color:#e2e8f0;');
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var content = input.value.trim();
    if (!content) return;
    append('user', content);
    input.value = '';
    input.disabled = true;
    button.disabled = true;
    fetch(apiBase + '/widget/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channelId: channelId,
        widgetSessionId: widgetSessionId,
        content: content,
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('widget message failed: ' + r.status);
        return r.json();
      })
      .then(function (body) {
        append('assistant', body.reply);
      })
      .catch(function (err) {
        append('assistant', '[error: ' + err.message + ']');
      })
      .finally(function () {
        input.disabled = false;
        button.disabled = false;
        input.focus();
      });
  });
})();
