/*
 * Mitti Mantra floating chatbot widget.
 * Pure vanilla JS — self-injects CSS + DOM, talks to POST /api/chat.
 */
(function () {
  if (window.__mmChatbotLoaded) return;
  window.__mmChatbotLoaded = true;

  const API = (location.origin && location.origin.startsWith("http"))
    ? location.origin + "/api/chat"
    : "/api/chat";

  // --------------- styles ---------------
  const css = `
  .mm-chat-fab{position:fixed;left:auto;top:auto;right:18px;bottom:76px;width:56px;height:56px;border-radius:50%;
    background:var(--brand,#2f6b3a);color:#fff;border:none;cursor:grab;
    box-shadow:0 10px 28px rgba(47,107,58,.35);z-index:9998;display:flex;align-items:center;
    justify-content:center;transition:transform .2s ease, box-shadow .2s ease;touch-action:none;user-select:none;}
  .mm-chat-fab:hover{transform:translateY(-2px) scale(1.05);background:var(--brand-deep,#1f4d28);}
  .mm-chat-fab.dragging{cursor:grabbing;transition:none;box-shadow:0 14px 40px rgba(47,107,58,.5);transform:scale(1.08);}
  .mm-chat-fab svg{width:26px;height:26px;pointer-events:none;}
  .mm-chat-panel{position:fixed;right:22px;bottom:184px;width:380px;max-width:calc(100vw - 32px);
    height:560px;max-height:calc(100vh - 200px);background:#fff;border-radius:18px;
    box-shadow:0 20px 60px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;
    z-index:9999;font-family:var(--font-body, 'Inter', system-ui, sans-serif);border:1px solid rgba(0,0,0,.06);}
  .mm-chat-panel.open{display:flex;animation:mmFadeIn .2s ease;}
  @keyframes mmFadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
  .mm-chat-head{background:var(--brand-deep,#1f4d28);color:#fff;padding:14px 16px;
    display:flex;align-items:center;gap:10px;}
  .mm-chat-head h4{margin:0;font-size:15px;font-weight:600;}
  .mm-chat-head p{margin:2px 0 0;font-size:11px;opacity:.85;}
  .mm-chat-head .mm-dot{width:8px;height:8px;border-radius:50%;background:#7cffa3;
    box-shadow:0 0 8px #7cffa3;margin-left:auto;}
  .mm-chat-head button{background:transparent;border:none;color:#fff;cursor:pointer;
    font-size:20px;padding:4px 8px;margin-left:4px;}
  .mm-chat-body{flex:1;overflow-y:auto;padding:14px;background:#f7faf7;display:flex;
    flex-direction:column;gap:10px;}
  .mm-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.5;
    word-wrap:break-word;white-space:pre-wrap;}
  .mm-msg.bot{background:#fff;border:1px solid #e5ebe5;color:#1c2a1c;align-self:flex-start;
    border-bottom-left-radius:4px;}
  .mm-msg.user{background:var(--brand,#2f6b3a);color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}
  .mm-msg code{background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;font-size:12px;}
  .mm-msg pre{background:#0f1a0f;color:#d6f5d6;padding:10px;border-radius:8px;overflow-x:auto;
    font-size:11.5px;margin:6px 0;}
  .mm-msg strong{font-weight:600;}
  .mm-msg ul{margin:6px 0;padding-left:18px;}
  .mm-msg h3{margin:6px 0 4px;font-size:14px;}
  .mm-sug{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 6px;background:#f7faf7;}
  .mm-sug button{background:#fff;border:1px solid #c8dcc8;color:var(--brand-deep,#1f4d28);border-radius:999px;
    padding:6px 11px;font-size:12px;cursor:pointer;transition:all .15s;}
  .mm-sug button:hover{background:var(--brand,#2f6b3a);color:#fff;}
  .mm-chat-form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5ebe5;background:#fff;}
  /* 16px, not 13.5px: this input is the whole point of the chat panel, and
     below 16px iOS zooms the viewport the moment it takes focus -- on the one
     control a user is guaranteed to tap. */
  .mm-chat-form input{flex:1;border:1px solid #d6e0d6;border-radius:999px;padding:10px 14px;
    font-size:16px;outline:none;font-family:inherit;}
  .mm-chat-form input:focus{border-color:var(--brand,#2f6b3a);}
  .mm-chat-form button{background:var(--brand,#2f6b3a);color:#fff;border:none;border-radius:999px;
    padding:0 16px;cursor:pointer;font-weight:600;font-size:13px;}
  .mm-chat-form button:disabled{opacity:.5;cursor:not-allowed;}
  .mm-chat-form .mm-mic{background:#fff;color:var(--brand,#2f6b3a);border:1px solid #c8dcc8;width:38px;padding:0;
    display:flex;align-items:center;justify-content:center;}
  .mm-chat-form .mm-mic.listening{background:#d32f2f;color:#fff;border-color:#d32f2f;
    animation:mmPulse 1s infinite;}
  @keyframes mmPulse{0%,100%{box-shadow:0 0 0 0 rgba(211,47,47,.6);}50%{box-shadow:0 0 0 6px rgba(211,47,47,0);}}
  .mm-actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;}
  .mm-actions a{background:var(--brand,#2f6b3a);color:#fff;text-decoration:none;
    padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;}
  .mm-actions a:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(47,107,58,.3);background:var(--brand-deep,#1f4d28);}
  .mm-msg table{border-collapse:collapse;margin:6px 0;font-size:12px;width:100%;}
  .mm-msg th,.mm-msg td{border:1px solid #d8e3d8;padding:4px 7px;text-align:left;}
  .mm-msg th{background:#eaf3ea;font-weight:600;}
  .mm-typing{display:inline-flex;gap:4px;align-items:center;}
  .mm-typing span{width:6px;height:6px;border-radius:50%;background:#6b8a6b;
    animation:mmBlink 1.2s infinite ease-in-out;}
  .mm-typing span:nth-child(2){animation-delay:.2s;}
  .mm-typing span:nth-child(3){animation-delay:.4s;}
  @keyframes mmBlink{0%,80%,100%{opacity:.2;}40%{opacity:1;}}
  @media (max-width:480px){
    .mm-chat-panel{right:8px;left:8px;width:auto;bottom:80px;height:calc(100vh - 100px);}
    .mm-chat-fab{right:12px;bottom:70px;}
  }`;
  const styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --------------- DOM ---------------
  const fab = document.createElement("button");
  fab.className = "mm-chat-fab";
  fab.setAttribute("aria-label", "Open Mitti Mantra assistant");
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5
    a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  fab.title = "Click to chat · drag to move";

  const panel = document.createElement("div");
  panel.className = "mm-chat-panel";
  panel.innerHTML = `
    <div class="mm-chat-head">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round"><path d="M12 2C9 8 7 12 7 15a5 5 0 0 0 10 0c0-3-2-7-5-13z"/></svg>
      <div>
        <h4>Mitti Mantra Assistant</h4>
        <p>Ask about crops, prices, schemes & more</p>
      </div>
      <span class="mm-dot" title="online"></span>
      <button class="mm-chat-close" aria-label="Close">×</button>
    </div>
    <div class="mm-chat-body" id="mm-chat-body"></div>
    <div class="mm-sug" id="mm-chat-sug"></div>
    <form class="mm-chat-form" id="mm-chat-form">
      <input type="text" id="mm-chat-input" placeholder="Ask or try /recommend, /msp, /pest…"
        autocomplete="off" />
      <button type="button" class="mm-mic" id="mm-chat-mic" title="Voice input" aria-label="Voice input">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>
      </button>
      <button type="submit">Send</button>
    </form>`;

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  const body = panel.querySelector("#mm-chat-body");
  const sug = panel.querySelector("#mm-chat-sug");
  const form = panel.querySelector("#mm-chat-form");
  const input = panel.querySelector("#mm-chat-input");
  const closeBtn = panel.querySelector(".mm-chat-close");

  function closeChat() {
    if (!panel.classList.contains("open")) return;
    panel.classList.remove("open");
    fab.setAttribute("aria-expanded", "false");
    fab.focus();
  }
  closeBtn.addEventListener("click", closeChat);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") closeChat(); });

  // --------------- drag + position persistence ---------------
  // The position is kept as distances from the right and bottom edges, not
  // left/top pixels. Stored as x/y, a button parked bottom-right on an 800px
  // window was left stranded mid-page when the window widened -- it kept its
  // x, and the resize clamp only ever pulled it *in*.
  const FAB_SIZE = 56;
  const PANEL_W = 380;
  const PANEL_H = 560;
  const GAP = 14;
  const POS_KEY = "mm_chat_fab_edge";   // was "mm_chat_fab_pos" (x/y); ignored now

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function applyFabPos(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    x = clamp(x, 8, vw - FAB_SIZE - 8);
    y = clamp(y, 8, vh - FAB_SIZE - 8);
    fab.style.left = x + "px";
    fab.style.top = y + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    positionPanel(x, y);
    return { x, y };
  }

  function toEdges(p) {
    return { r: window.innerWidth - p.x - FAB_SIZE, b: window.innerHeight - p.y - FAB_SIZE };
  }
  function fromEdges(e) {
    return { x: window.innerWidth - e.r - FAB_SIZE, y: window.innerHeight - e.b - FAB_SIZE };
  }

  function positionPanel(fx, fy) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = Math.min(PANEL_W, vw - 16);
    const ph = Math.min(PANEL_H, vh - 24);
    // Prefer placing panel above the FAB; fall back to below.
    let py = fy - ph - GAP;
    if (py < 8) py = fy + FAB_SIZE + GAP;
    py = clamp(py, 8, vh - ph - 8);
    // Align panel right edge near FAB right edge; keep in viewport.
    let px = fx + FAB_SIZE - pw;
    px = clamp(px, 8, vw - pw - 8);
    panel.style.left = px + "px";
    panel.style.top = py + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.width = pw + "px";
    panel.style.height = ph + "px";
  }

  // Default: stacked directly above the language/tools disc, on its centre
  // line, so the two corner buttons read as one column.
  function defaultEdges() {
    const small = window.innerWidth <= 480;
    return small ? { r: 12, b: 70 } : { r: 18, b: 76 };
  }

  function loadEdges() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const e = JSON.parse(raw);
        if (typeof e.r === "number" && typeof e.b === "number") return e;
      }
    } catch (_) { }
    return null;
  }

  function saveEdges(e) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(e)); } catch (_) { }
  }
  try { localStorage.removeItem("mm_chat_fab_pos"); } catch (_) { }

  let edges = loadEdges();              // null = never dragged: follow the default
  let current = applyFabPos(fromEdges(edges || defaultEdges()).x, fromEdges(edges || defaultEdges()).y);
  window.addEventListener("resize", () => {
    const e = edges || defaultEdges();
    current = applyFabPos(fromEdges(e).x, fromEdges(e).y);
  });

  let dragState = null; // { startX, startY, origX, origY, moved }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const rect = fab.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      moved: false,
    };
    fab.setPointerCapture && fab.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragState) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.hypot(dx, dy) > 4) {
      dragState.moved = true;
      fab.classList.add("dragging");
    }
    if (dragState.moved) {
      e.preventDefault();
      current = applyFabPos(e.clientX - dragState.offX, e.clientY - dragState.offY);
    }
  }

  // Set when a pointer sequence turned out to be a drag, so the synthetic
  // `click` that follows pointerup doesn't also toggle the panel.
  let suppressClick = false;

  function onPointerUp(e) {
    if (!dragState) return;
    const wasDrag = dragState.moved;
    fab.classList.remove("dragging");
    try { fab.releasePointerCapture && fab.releasePointerCapture(e.pointerId); } catch (_) { }
    dragState = null;
    if (wasDrag) {
      edges = toEdges(current);
      saveEdges(edges);
      suppressClick = true;
    }
  }

  function toggleChat() {
    panel.classList.toggle("open");
    const open = panel.classList.contains("open");
    fab.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      positionPanel(current.x, current.y);
      if (body.childElementCount === 0) greet();
      setTimeout(() => input.focus(), 150);
    }
  }

  fab.addEventListener("pointerdown", onPointerDown);
  fab.addEventListener("pointermove", onPointerMove);
  fab.addEventListener("pointerup", onPointerUp);
  fab.addEventListener("pointercancel", onPointerUp);

  // The toggle lives on `click`, not `pointerup`: the launcher is a <button>,
  // so Enter/Space raise `click` with no pointer sequence at all. Handling only
  // pointerup meant the assistant could not be opened from the keyboard.
  fab.addEventListener("click", () => {
    if (suppressClick) { suppressClick = false; return; }
    toggleChat();
  });

  // --------------- rendering ---------------
  // Markdown subset: **bold**, _em_, `code`, ```blocks```, bullet lists, headings,
  // pipe-tables, [links](url).
  function renderMarkdown(md) {
    const esc = (s) => s.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#x27;", '"': "&quot;" }[c]));
    const lines = md.split("\n");
    let out = "";
    let inCode = false, codeBuf = [], inList = false;
    let i = 0;

    const flushList = () => { if (inList) { out += "</ul>"; inList = false; } };

    while (i < lines.length) {
      const raw = lines[i];

      if (raw.startsWith("```")) {
        if (!inCode) { flushList(); inCode = true; codeBuf = []; }
        else { out += `<pre>${esc(codeBuf.join("\n"))}</pre>`; inCode = false; }
        i++; continue;
      }
      if (inCode) { codeBuf.push(raw); i++; continue; }

      // Table detection: header | --- | rows
      if (/^\s*\|.+\|\s*$/.test(raw) && i + 1 < lines.length && /^\s*\|[-\s|:]+\|\s*$/.test(lines[i + 1])) {
        flushList();
        const header = raw.trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim());
        const rows = [];
        i += 2;
        while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, "").split("|").map(s => s.trim()));
          i++;
        }
        out += "<table><thead><tr>" + header.map(h => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>";
        for (const r of rows) {
          out += "<tr>" + r.map(c => `<td>${inline(c)}</td>`).join("") + "</tr>";
        }
        out += "</tbody></table>";
        continue;
      }

      if (/^###\s+/.test(raw)) { flushList(); out += `<h3>${inline(raw.replace(/^###\s+/, ""))}</h3>`; i++; continue; }
      if (/^-\s+/.test(raw)) {
        if (!inList) { out += "<ul>"; inList = true; }
        out += `<li>${inline(raw.replace(/^-\s+/, ""))}</li>`;
        i++; continue;
      }
      flushList();
      if (raw.trim() === "") { out += "<br/>"; i++; continue; }
      out += `<div>${inline(raw)}</div>`;
      i++;
    }
    flushList();
    if (inCode) out += `<pre>${esc(codeBuf.join("\n"))}</pre>`;
    return out;

    function inline(s) {
      s = esc(s);
      s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      s = s.replace(/(^|[\s(])_(.+?)_(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
      s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
      s = s.replace(/\[([^\]]+)\]\((https?:[^\s)]+|\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }
  }

  const SPEECH_LANGS = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ta: 'ta-IN' };

  function speakText(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*_#`|[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
    const utt = new SpeechSynthesisUtterance(cleanText);
    const docLang = document.documentElement.getAttribute('lang') || 'en';
    utt.lang = SPEECH_LANGS[docLang] || 'en-IN';
    utt.rate = 0.95;
    window.speechSynthesis.speak(utt);
  }

  function addMsg(role, text) {
    const div = document.createElement("div");
    div.className = "mm-msg " + role;
    if (role === "user") {
      div.innerHTML = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    } else {
      div.innerHTML = renderMarkdown(text);
      // Append TTS Audio Speaker Icon
      const ttsBtn = document.createElement("button");
      ttsBtn.type = "button";
      ttsBtn.title = tr("Listen to answer");
      ttsBtn.style.cssText = "background:none;border:none;color:var(--brand,#2f6b3a);cursor:pointer;font-size:12px;margin-top:6px;display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:4px;border:1px solid #c8dcc8;";
      ttsBtn.innerHTML = `🔊 <span>${tr("Listen")}</span>`;
      ttsBtn.addEventListener("click", () => speakText(text));
      div.appendChild(ttsBtn);
    }
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
    return div;
  }


  function setSuggestions(list) {
    sug.innerHTML = "";
    (list || []).forEach((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s;
      b.addEventListener("click", () => { input.value = s; send(); });
      sug.appendChild(b);
    });
  }

  function addActions(list) {
    if (!list || !list.length) return;
    const wrap = document.createElement("div");
    wrap.className = "mm-actions";
    for (const a of list) {
      // FIX (5.1): Validate href to prevent javascript: XSS injection
      let safeHref = "#";
      try {
        const url = new URL(a.href, location.origin);
        if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === location.protocol) {
          safeHref = url.href;
        }
      } catch (_) {
        // If it's a relative path starting with /, treat as safe
        if (typeof a.href === "string" && a.href.startsWith("/")) safeHref = a.href;
      }
      const btn = document.createElement("a");
      btn.href = safeHref;
      btn.textContent = a.label;
      btn.rel = "noopener noreferrer";
      btn.target = "_blank";
      wrap.appendChild(btn);
    }
    body.appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  // The greeting and its chips in the site's language. These are the
  // backend's own strings (engine/chatbot_i18n.py REPLY: greeting, sug_*), so
  // a tapped chip is a phrase the assistant is known to understand. The
  // greeting used to be English whatever language the page was in.
  const GREETINGS = {
    "hi": {
      "text": "नमस्ते! मैं **मिट्टी मंत्र का सहायक** हूं — फ़सल सिफारिशें, मंडी भाव, MSP, सिंचाई, कीट और सरकारी योजनाओं में मदद कर सकता हूं, असली भारतीय कृषि डेटा के साथ।\n\nपूछ के देखें: _\"तेलंगाना मेडक के लिए खरीफ़ में ₹15000 बजट और 3 एकड़ पर फ़सल सिफारिश करें\"_ या _\"गेहूं का MSP क्या है?\"_",
      "chips": [
        "आप क्या कर सकते हैं?",
        "मेरे क्षेत्र के लिए फ़सल सिफारिश",
        "गेहूं का MSP",
        "चावल के लिए कीट चेतावनी"
      ]
    },
    "te": {
      "text": "నమస్తే! నేను **మిట్టి మంత్ర సహాయకుడిని** — పంట సిఫారసులు, మండీ ధరలు, MSP, నీటిపారుదల, పురుగులు మరియు ప్రభుత్వ పథకాలలో సహాయం చేయగలను, నిజమైన భారత వ్యవసాయ డేటాతో.\n\nఇలా అడగండి: _\"తెలంగాణ మెదక్ కోసం ఖరీఫ్‌లో ₹15000 బడ్జెట్, 3 ఎకరాలకు పంట సిఫారసు చేయండి\"_ లేదా _\"గోధుమల MSP ఎంత?\"_",
      "chips": [
        "మీరు ఏమి చేయగలరు?",
        "నా ప్రాంతం కోసం పంట సిఫారసు",
        "గోధుమల MSP",
        "వరికి పురుగు హెచ్చరికలు"
      ]
    },
    "kn": {
      "text": "ನಮಸ್ತೆ! ನಾನು **ಮಿಟ್ಟಿ ಮಂತ್ರ ಸಹಾಯಕ** — ಬೆಳೆ ಶಿಫಾರಸುಗಳು, ಮಂಡಿ ಬೆಲೆಗಳು, MSP, ನೀರಾವರಿ, ಕೀಟಗಳು ಮತ್ತು ಸರ್ಕಾರಿ ಯೋಜನೆಗಳಲ್ಲಿ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ, ನಿಜವಾದ ಭಾರತೀಯ ಕೃಷಿ ಡೇಟಾದೊಂದಿಗೆ.\n\nಹೀಗೆ ಕೇಳಿ: _\"ತೆಲಂಗಾಣ ಮೆದಕ್‌ಗೆ ಖರೀಫ್‌ನಲ್ಲಿ ₹15000 ಬಜೆಟ್, 3 ಎಕರೆಗಳಿಗೆ ಬೆಳೆ ಶಿಫಾರಸು ಮಾಡಿ\"_ ಅಥವಾ _\"ಗೋಧಿಯ MSP ಎಷ್ಟು?\"_",
      "chips": [
        "ನೀವು ಏನು ಮಾಡಬಲ್ಲಿರಿ?",
        "ನನ್ನ ಪ್ರದೇಶಕ್ಕೆ ಬೆಳೆ ಶಿಫಾರಸು",
        "ಗೋಧಿಯ MSP",
        "ಅಕ್ಕಿಗೆ ಕೀಟ ಎಚ್ಚರಿಕೆಗಳು"
      ]
    }
  };
  const EN_GREETING = {
    text: "Namaste! I'm **Mitti Mantra's assistant**. I can help with crop " +
      "recommendations, mandi prices, MSP, irrigation, pests and government schemes — " +
      "all using real Indian farm data from this site.",
    chips: ["What can you do?", "Recommend crops for Telangana Medak", "MSP of wheat", "Pest alerts for rice"],
  };
  const siteLang = () => (window.AgriSimI18n && window.AgriSimI18n.getLanguage()) ||
    document.documentElement.getAttribute("lang") || "en";
  // UI strings this file writes itself; translated from the page catalog.
  const tr = (s) => (window.AgriSimI18n && window.AgriSimI18n.t ? window.AgriSimI18n.t(s) : s);

  // True until the farmer sends something, so a language switch can redo
  // the greeting without touching a conversation already under way.
  let onlyGreeted = false;
  function greet() {
    const lang = siteLang();
    const g = GREETINGS[lang] || EN_GREETING;
    body.innerHTML = "";
    // The assistant doesn't understand Tamil yet: say so in Tamil rather
    // than greet in Tamil and then answer in English.
    const text = lang === "ta"
      ? "உதவியாளர் தற்போது ஆங்கிலத்தில் மட்டுமே பதிலளிக்கிறது.\n\n" + g.text
      : g.text;
    addMsg("bot", text);
    setSuggestions(g.chips);
    onlyGreeted = true;
  }
  document.addEventListener("mm:lang-changed", () => {
    if (onlyGreeted && body.childElementCount) greet();
  });

  // --------------- session memory ---------------
  let sessionCtx = {};
  try {
    const stored = localStorage.getItem("mm_chat_ctx");
    if (stored) sessionCtx = JSON.parse(stored) || {};
  } catch (_) { }
  try {
    // Bootstrap region from unified Farm Profile, if present.
    const mp = window.MM && MM.profile && MM.profile.get();
    if (mp && mp.region_id && !sessionCtx.region_id) sessionCtx.region_id = mp.region_id;
    const r = localStorage.getItem("mm_region_id");
    if (r && !sessionCtx.region_id) sessionCtx.region_id = r;
  } catch (_) { }
  const persistCtx = () => { try { localStorage.setItem("mm_chat_ctx", JSON.stringify(sessionCtx)); } catch (_) { } };
  // The region was only ever seeded once, so after switching farms (or
  // plots) the assistant kept answering for the old one.
  const syncRegionFromProfile = () => {
    try {
      const mp = window.MM && MM.profile && MM.profile.get();
      if (mp && mp.region_id && mp.region_id !== sessionCtx.region_id) {
        sessionCtx.region_id = mp.region_id;
        persistCtx();
      }
    } catch (_) { }
  };
  document.addEventListener("mm:profile-changed", syncRegionFromProfile);
  document.addEventListener("mm:plot-changed", syncRegionFromProfile);

  // --------------- API ---------------
  // FIX (5.2): Mutex guard to prevent concurrent send() calls
  let _sending = false;
  async function send() {
    const msg = input.value.trim();
    if (!msg || _sending) return;
    _sending = true;
    input.value = "";
    onlyGreeted = false;
    addMsg("user", msg);
    setSuggestions([]);
    const typing = document.createElement("div");
    typing.className = "mm-msg bot";
    typing.setAttribute("aria-label", tr("Assistant is typing"));
    typing.innerHTML = '<span class="mm-typing"><span></span><span></span><span></span></span>';
    body.appendChild(typing);
    body.scrollTop = body.scrollHeight;

    function formatApiError(data) {
      const d = data && data.detail;
      if (typeof d === "string") return d;
      if (Array.isArray(d) && d.length) {
        return d.map((e) => (e && (e.msg || e.message)) || JSON.stringify(e)).join(" ");
      }
      if (d && typeof d === "object") return JSON.stringify(d);
      return "";
    }

    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, context: sessionCtx }),
      });
      let data;
      try {
        data = await res.json();
      } catch (_) {
        typing.remove();
        console.error("[chat] non-JSON response from", API, res.status);
        addMsg("bot", tr("The assistant isn't available right now. Please try again in a little while."));
        return;
      }
      typing.remove();
      if (!res.ok) {
        console.error("[chat] API error", res.status, formatApiError(data));
        addMsg("bot", tr(res.status === 422
          ? "I couldn't read that message. Try asking in a shorter sentence."
          : "Sorry, something went wrong on my side. Please try asking again."));
        return;
      }
      if (data.reply == null || data.reply === "") {
        console.error("[chat] empty reply", data);
        addMsg("bot", tr("I didn't get an answer for that. Please try rephrasing your question."));
        return;
      }
      addMsg("bot", data.reply);
      if (data.context) { sessionCtx = Object.assign(sessionCtx, data.context); persistCtx(); }
      addActions(data.actions || []);
      setSuggestions(data.suggestions || []);
    } catch (err) {
      typing.remove();
      console.error("[chat] request failed", err);
      addMsg("bot", tr(navigator.onLine
        ? "I couldn't reach the assistant. Please try again in a moment."
        : "You're offline. Reconnect and ask again."));
    } finally {
      // FIX (5.2): Always release the send mutex
      _sending = false;
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); send(); });

  // --------------- voice input (Web Speech API) ---------------
  const micBtn = panel.querySelector("#mm-chat-mic");
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (micBtn) {
    if (!SpeechRec) {
      micBtn.style.display = "none";
    } else {
      let rec = null, listening = false;
      micBtn.addEventListener("click", () => {
        if (listening) { try { rec.stop(); } catch (_) { } return; }
        rec = new SpeechRec();

        const docLang = document.documentElement.getAttribute('lang') || 'en';
        rec.lang = SPEECH_LANGS[docLang] || 'en-IN';

        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          const txt = e.results[0][0].transcript;
          input.value = txt;
          send();
        };
        // FIX (5.3): Surface speech recognition errors to the user
        rec.onerror = (ev) => {
          listening = false; micBtn.classList.remove("listening");
          const errMap = { "no-speech": "No speech detected.", "audio-capture": "Microphone not found.", "not-allowed": "Microphone access denied." };
          const errMsg = errMap[ev.error] || ("Voice input error: " + (ev.error || "unknown"));
          addMsg("bot", errMsg);
        };
        rec.onend = () => { listening = false; micBtn.classList.remove("listening"); };
        try { rec.start(); listening = true; micBtn.classList.add("listening"); }
        catch (_) { listening = false; micBtn.classList.remove("listening"); }
      });
    }
  }
})();
