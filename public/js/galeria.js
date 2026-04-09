// ============================================================
//  galeria.js — Filtros y lightbox para la galería
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const items    = document.querySelectorAll('.galeria-item');
  const filtros  = document.querySelectorAll('.filtro-btn');
  const lightbox = document.getElementById('lightbox');
  const lbBg     = document.getElementById('lightboxBg');
  const lbImg    = document.getElementById('lightboxImg');
  const lbCap    = document.getElementById('lightboxCaption');
  const lbClose  = document.getElementById('lightboxClose');
  const lbPrev   = document.getElementById('lightboxPrev');
  const lbNext   = document.getElementById('lightboxNext');

  let visibleItems = [...items];
  let currentIdx = 0;

  // ── Filtros ─────────────────────────────────────────────
  filtros.forEach(btn => {
    btn.addEventListener('click', () => {
      filtros.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const cat = btn.dataset.cat;
      visibleItems = [];

      items.forEach(item => {
        const match = cat === 'Todas' || item.dataset.cat === cat;
        item.style.display = match ? '' : 'none';
        if (match) visibleItems.push(item);
      });

      const vacia = document.getElementById('galeriaVacia');
      if (vacia) vacia.style.display = visibleItems.length === 0 ? 'block' : 'none';
    });
  });

  // ── Lightbox ─────────────────────────────────────────────
  function openLightbox(idx) {
    currentIdx = idx;
    const item = visibleItems[idx];
    const img  = item.querySelector('img');
    const alt  = img ? img.alt : '';
    const src  = img ? img.src : '';

    lbImg.src = src;
    lbImg.alt = alt;
    lbCap.textContent = alt;

    lightbox.classList.add('active');
    lbBg.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    lbBg.classList.remove('active');
    document.body.style.overflow = '';
    lbImg.src = '';
  }

  function showPrev() {
    currentIdx = (currentIdx - 1 + visibleItems.length) % visibleItems.length;
    openLightbox(currentIdx);
  }

  function showNext() {
    currentIdx = (currentIdx + 1) % visibleItems.length;
    openLightbox(currentIdx);
  }

  // Clicks en imágenes
  items.forEach((item, i) => {
    item.addEventListener('click', () => {
      const visIdx = visibleItems.indexOf(item);
      if (visIdx !== -1) openLightbox(visIdx);
    });
  });

  lbClose.addEventListener('click', closeLightbox);
  lbBg.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', (e) => { e.stopPropagation(); showPrev(); });
  lbNext.addEventListener('click', (e) => { e.stopPropagation(); showNext(); });

  // Teclado
  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   showPrev();
    if (e.key === 'ArrowRight')  showNext();
  });
});
