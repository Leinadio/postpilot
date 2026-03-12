(() => {
  const PROCESSED_ATTR = 'data-postpilot-processed';
  const LOG = '[PostPilot]';
  let activePanel = null;

  function log(...args) { console.log(LOG, ...args); }

  // --- Post Detection ---
  // LinkedIn 2025+ uses obfuscated classes. We identify posts via their
  // "menu de commandes" button (aria-label pattern) and walk up 2 levels.

  function findPosts() {
    const menuButtons = document.querySelectorAll('button[aria-label*="menu de commandes pour le post"], button[aria-label*="control menu for post"]');

    let count = 0;
    menuButtons.forEach(menuBtn => {
      // Post card is 2 levels up from the menu button
      const postCard = menuBtn.parentElement?.parentElement;
      if (!postCard || postCard.getAttribute(PROCESSED_ATTR)) return;

      // Verify this is a real post card (should have P tag with text, and action buttons)
      const hasText = postCard.querySelector('p');
      const hasActionBtn = Array.from(postCard.querySelectorAll('button')).some(b =>
        b.textContent.trim() === 'Commenter' || b.textContent.trim() === 'Comment'
      );
      if (!hasText && !hasActionBtn) return;

      postCard.setAttribute(PROCESSED_ATTR, 'true');
      injectButton(postCard);
      count++;
    });

    if (count > 0) log(`Injected ${count} button(s)`);
  }

  // --- Extract Post Text ---

  function extractPostContent(postCard) {
    // Find the longest <p> text — skip author name/headline inside <a> or <button>
    const pTags = postCard.querySelectorAll('p');
    let bestText = null;
    let bestLen = 0;

    for (const p of pTags) {
      if (p.closest('a') || p.closest('button')) continue;
      const text = p.textContent.trim();
      if (text.length > bestLen) { bestLen = text.length; bestText = text; }
    }

    if (bestText && bestLen > 20) return bestText;

    // Fallback: look for span[dir] with substantial text
    const spans = postCard.querySelectorAll('span[dir]');
    for (const s of spans) {
      const text = s.textContent.trim();
      if (text.length > 20 && !s.closest('button') && !s.closest('a')) return text;
    }

    return null;
  }

  // --- Button Injection ---

  function injectButton(postCard) {
    // Find the action bar: the div containing J'aime/Commenter/Republier buttons
    const allChildren = Array.from(postCard.children);
    let actionBar = null;

    for (const child of allChildren) {
      if (child.tagName !== 'DIV') continue;
      const btns = Array.from(child.querySelectorAll('button'));
      const hasAction = btns.some(b => {
        const t = b.textContent.trim();
        return t === 'Commenter' || t === 'Comment' || t === 'Republier' || t === 'Repost';
      });
      if (hasAction) {
        actionBar = child;
        break;
      }
    }

    const btn = document.createElement('button');
    btn.className = 'postpilot-trigger';
    btn.innerHTML = '<span class="postpilot-trigger-icon">✨</span> PostPilot';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onTriggerClick(postCard, btn);
    });

    if (actionBar) {
      // Add as last child inside the action bar (next to Republier/Envoyer)
      actionBar.appendChild(btn);
    } else {
      postCard.appendChild(btn);
    }
  }

  // --- Panel UI ---

  function onTriggerClick(postCard, triggerBtn) {
    if (activePanel) { activePanel.remove(); activePanel = null; }

    const postContent = extractPostContent(postCard);
    if (!postContent) {
      showToast('Impossible de lire le contenu du post.');
      return;
    }

    log('Post:', postContent.substring(0, 80) + '...');
    const panel = createPanel(postContent, postCard);
    // Insert panel after the action bar (end of post card)
    postCard.appendChild(panel);
    activePanel = panel;
  }

  function createPanel(postContent, postCard) {
    const host = document.createElement('div');
    host.className = 'postpilot-panel-host';
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>${getPanelStyles()}</style>
      <div class="pp-panel">
        <div class="pp-header">
          <span class="pp-title">✨ PostPilot</span>
          <button class="pp-close">&times;</button>
        </div>
        <div class="pp-options">
          <div class="pp-option-row">
            <span class="pp-option-label">Ton</span>
            <div class="pp-toggle-group" id="pp-ton">
              ${Object.entries(TON_OPTIONS).map(([key, opt]) => `
                <button class="pp-toggle${key === 'neutre' ? ' active' : ''}" data-value="${key}">${opt.label}</button>
              `).join('')}
            </div>
          </div>
          <div class="pp-option-row">
            <span class="pp-option-label">Longueur</span>
            <div class="pp-toggle-group" id="pp-longueur">
              ${Object.entries(LONGUEUR_OPTIONS).map(([key, opt]) => `
                <button class="pp-toggle${key === 'court' ? ' active' : ''}" data-value="${key}">${opt.label}</button>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="pp-section-label">Approche</div>
        <div class="pp-types" id="pp-types">
          ${Object.entries(COMMENT_APPROACHES).map(([key, approach]) => `
            <button class="pp-type-btn" data-type="${key}">
              <span class="pp-type-emoji">${approach.emoji}</span>
              <span class="pp-type-label">${approach.label}</span>
              <span class="pp-type-desc">${approach.description}</span>
            </button>
          `).join('')}
        </div>
        <div class="pp-result" id="pp-result" style="display:none;">
          <div class="pp-loading" id="pp-loading">
            <div class="pp-spinner"></div>
            <span>Claude réfléchit...</span>
          </div>
          <div class="pp-comment-box" id="pp-comment-box" style="display:none;">
            <p class="pp-comment-text" id="pp-comment-text"></p>
            <div class="pp-actions">
              <button class="pp-btn pp-btn-primary" id="pp-insert">Insérer le commentaire</button>
              <button class="pp-btn pp-btn-secondary" id="pp-regenerate">Régénérer</button>
            </div>
          </div>
          <div class="pp-error" id="pp-error" style="display:none;">
            <p id="pp-error-text"></p>
            <button class="pp-btn pp-btn-secondary" id="pp-retry">Réessayer</button>
          </div>
        </div>
      </div>
    `;

    let currentType = null;
    let currentTon = 'neutre';
    let currentLongueur = 'court';

    shadow.querySelector('.pp-close').addEventListener('click', () => {
      host.remove(); activePanel = null;
    });

    shadow.getElementById('pp-ton').addEventListener('click', (e) => {
      const btn = e.target.closest('.pp-toggle');
      if (!btn) return;
      shadow.querySelectorAll('#pp-ton .pp-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTon = btn.dataset.value;
    });

    shadow.getElementById('pp-longueur').addEventListener('click', (e) => {
      const btn = e.target.closest('.pp-toggle');
      if (!btn) return;
      shadow.querySelectorAll('#pp-longueur .pp-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLongueur = btn.dataset.value;
    });

    shadow.querySelectorAll('.pp-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentType = btn.dataset.type;
        shadow.querySelectorAll('.pp-type-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        generateComment(shadow, currentType, postContent, currentTon, currentLongueur);
      });
    });

    shadow.getElementById('pp-regenerate').addEventListener('click', () => {
      if (currentType) generateComment(shadow, currentType, postContent, currentTon, currentLongueur);
    });

    shadow.getElementById('pp-insert').addEventListener('click', () => {
      const text = shadow.getElementById('pp-comment-text').textContent;
      insertComment(postCard, text);
      host.remove(); activePanel = null;
    });

    shadow.getElementById('pp-retry').addEventListener('click', () => {
      if (currentType) generateComment(shadow, currentType, postContent, currentTon, currentLongueur);
    });

    return host;
  }

  async function generateComment(shadow, type, postContent, ton, longueur) {
    const typesGrid = shadow.getElementById('pp-types');
    const resultArea = shadow.getElementById('pp-result');
    const loading = shadow.getElementById('pp-loading');
    const commentBox = shadow.getElementById('pp-comment-box');
    const errorBox = shadow.getElementById('pp-error');

    typesGrid.style.display = 'none';
    resultArea.style.display = 'block';
    loading.style.display = 'flex';
    commentBox.style.display = 'none';
    errorBox.style.display = 'none';

    const prompt = buildPrompt(type, postContent, ton, longueur);
    if (!prompt) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_COMMENT',
        payload: prompt
      });

      loading.style.display = 'none';

      if (response.error) {
        showError(shadow, response.error);
        return;
      }

      shadow.getElementById('pp-comment-text').textContent = response.comment;
      commentBox.style.display = 'block';
      typesGrid.style.display = 'grid';
    } catch (err) {
      loading.style.display = 'none';
      showError(shadow, err.message);
    }
  }

  function showError(shadow, errorMsg) {
    const errorBox = shadow.getElementById('pp-error');
    const errorText = shadow.getElementById('pp-error-text');
    const typesGrid = shadow.getElementById('pp-types');

    let message = 'Une erreur est survenue.';
    if (errorMsg === 'API_KEY_MISSING') {
      message = 'Clé API manquante. Cliquez sur l\'icône PostPilot pour configurer votre clé Anthropic.';
    } else if (errorMsg === 'API_KEY_INVALID') {
      message = 'Clé API invalide. Vérifiez votre clé dans les paramètres.';
    } else if (errorMsg) {
      message = errorMsg;
    }

    errorText.textContent = message;
    errorBox.style.display = 'block';
    typesGrid.style.display = 'grid';
  }

  // --- Comment Insertion ---

  function insertComment(postCard, text) {
    const commentBtn = Array.from(postCard.querySelectorAll('button')).find(b =>
      b.textContent.trim() === 'Commenter' || b.textContent.trim() === 'Comment'
    );
    if (commentBtn) commentBtn.click();

    setTimeout(() => {
      // Find the comment editor near this post
      const editors = document.querySelectorAll(
        '.ql-editor, div[contenteditable="true"][role="textbox"], div[contenteditable="true"][data-placeholder]'
      );

      let editor = null;
      // Pick the editor closest to this post
      const postRect = postCard.getBoundingClientRect();
      let minDist = Infinity;
      editors.forEach(ed => {
        const edRect = ed.getBoundingClientRect();
        const dist = Math.abs(edRect.top - postRect.bottom);
        if (dist < minDist) { minDist = dist; editor = ed; }
      });

      if (!editor) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Commentaire copié ! Collez avec Cmd+V.');
        }).catch(() => showToast('Champ de commentaire introuvable.'));
        return;
      }

      const p = editor.querySelector('p');
      if (p) { p.textContent = text; } else { editor.textContent = text; }

      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.focus();
      showToast('Commentaire inséré !');
    }, 800);
  }

  // --- Toast ---

  function showToast(msg) {
    const old = document.querySelector('.postpilot-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = 'postpilot-toast';
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1d2226;color:#fff;padding:12px 24px;border-radius:8px;font-size:14px;font-family:-apple-system,system-ui,sans-serif;z-index:10001;box-shadow:0 4px 12px rgba(0,0,0,.3);';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // --- Panel Styles ---

  function getPanelStyles() {
    return `
      * { box-sizing: border-box; }
      .pp-panel { background:#fff; border:1px solid #e0e0e0; border-radius:12px; padding:16px; margin:8px 0; box-shadow:0 4px 16px rgba(0,0,0,.1); font-family:-apple-system,system-ui,sans-serif; }
      .pp-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
      .pp-title { font-size:15px; font-weight:700; color:#0a66c2; }
      .pp-close { background:none; border:none; font-size:22px; color:#666; cursor:pointer; padding:4px 8px; border-radius:4px; }
      .pp-close:hover { background:#f3f3f3; }
      .pp-options { margin-bottom:12px; display:flex; flex-direction:column; gap:8px; }
      .pp-option-row { display:flex; align-items:center; gap:10px; }
      .pp-option-label { font-size:12px; font-weight:600; color:#666; min-width:70px; }
      .pp-toggle-group { display:flex; gap:4px; }
      .pp-toggle { padding:5px 12px; border:1px solid #e0e0e0; border-radius:16px; background:#fafafa; font-size:12px; color:#666; cursor:pointer; transition:all .15s; }
      .pp-toggle:hover { border-color:#0a66c2; color:#0a66c2; }
      .pp-toggle.active { background:#0a66c2; color:#fff; border-color:#0a66c2; }
      .pp-section-label { font-size:12px; font-weight:600; color:#666; margin-bottom:8px; }
      .pp-types { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; }
      .pp-type-btn { display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 6px; border:1px solid #e0e0e0; border-radius:8px; background:#fafafa; cursor:pointer; transition:all .15s; }
      .pp-type-btn:hover { border-color:#0a66c2; background:#f0f7ff; }
      .pp-type-btn.selected { border-color:#0a66c2; background:#e8f0fe; box-shadow:0 0 0 1px #0a66c2; }
      .pp-type-emoji { font-size:18px; }
      .pp-type-label { font-size:11px; font-weight:600; color:#333; text-align:center; }
      .pp-type-desc { font-size:9px; color:#666; text-align:center; line-height:1.3; }
      .pp-result { margin-top:12px; }
      .pp-loading { display:flex; align-items:center; justify-content:center; gap:10px; padding:20px; color:#666; font-size:13px; }
      .pp-spinner { width:20px; height:20px; border:2px solid #e0e0e0; border-top-color:#0a66c2; border-radius:50%; animation:ppSpin .8s linear infinite; }
      @keyframes ppSpin { to { transform:rotate(360deg); } }
      .pp-comment-box { margin-top:8px; }
      .pp-comment-text { background:#f8f9fa; border:1px solid #e0e0e0; border-radius:8px; padding:12px; font-size:13px; line-height:1.5; color:#333; margin:0 0 12px; white-space:pre-wrap; }
      .pp-actions { display:flex; gap:8px; }
      .pp-btn { padding:8px 16px; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:all .15s; }
      .pp-btn-primary { background:#0a66c2; color:#fff; }
      .pp-btn-primary:hover { background:#004182; }
      .pp-btn-secondary { background:#fff; color:#0a66c2; border:1px solid #0a66c2; }
      .pp-btn-secondary:hover { background:#f0f7ff; }
      .pp-error { padding:12px; background:#fef2f2; border:1px solid #fecaca; border-radius:8px; margin-top:8px; }
      .pp-error p { color:#991b1b; font-size:13px; margin:0 0 8px; }
    `;
  }

  // --- Observer ---

  let debounce = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(findPosts, 500);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(findPosts, 1500);
  setTimeout(findPosts, 4000);

  let scrollDebounce = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(findPosts, 500);
  }, { passive: true });

  log('Loaded');
})();
