/* Headline entrance, word by word. Loaded by a plain synchronous
   <script src> right after the headline (not deferred), so the
   words are in place before the first paint -- from a deferred
   script the split could land after the headline's own fade had
   begun and restart it. Without this (script blocked, reduced
   motion) the headline keeps its single fadeUp from style.css.

   i18n.js translates whole text nodes, and the words are no longer
   one. So the sentence is kept intact in a hidden span for i18n to
   translate as before, and the visible words are redrawn from it
   whenever the language changes. */
(() => {
  const h = document.getElementById('heroTitle');
  if (!h || h.children.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const src = document.createElement('span');
  src.hidden = true;
  src.textContent = h.textContent;
  const words = document.createElement('span');
  words.setAttribute('data-no-translate', '');
  const render = () => {
    words.textContent = '';
    src.textContent.trim().split(/\s+/).forEach((word, i) => {
      if (i) words.append(' ');
      const w = document.createElement('span');
      w.className = 'hero__word';
      w.style.setProperty('--i', i);
      w.textContent = word;
      words.append(w);
    });
  };
  render();
  h.textContent = '';
  h.append(src, words);
  h.classList.add('is-split');
  document.addEventListener('mm:lang-changed', () => {
    // A language switch swaps the words in place; the entrance
    // only ever plays once.
    h.classList.add('is-settled');
    render();
  });
})();
