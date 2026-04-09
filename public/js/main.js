// ============================================================
//  main.js — JavaScript global para todas las páginas
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // ── Navbar: scroll effect ──────────────────────────────
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });

  // ── Hamburger / menú mobile ────────────────────────────
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileMenu.classList.toggle('open');
    });
    // Cierra al hacer click en un link
    mobileMenu.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileMenu.classList.remove('open');
      });
    });
  }

  // ── Scroll-reveal para elementos .slide-up ─────────────
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        // Pequeño delay escalonado para elementos hermanos
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, i * 80);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll('.slide-up').forEach(el => observer.observe(el));

  // ── Scroll suave al hacer click en .scroll-down ────────
  const scrollDown = document.querySelector('.scroll-down');
  if (scrollDown) {
    scrollDown.addEventListener('click', () => {
      const nextSection = document.querySelector('main section:nth-child(2)');
      if (nextSection) nextSection.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // ── Fecha mínima en inputs de fecha ───────────────────
  const hoy = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(input => {
    input.setAttribute('min', hoy);
  });

  // Llegada → Salida: salida mínima = llegada + 1 día
  const llegada = document.getElementById('llegada');
  const salida  = document.getElementById('salida');
  if (llegada && salida) {
    llegada.addEventListener('change', () => {
      if (!llegada.value) return;
      const d = new Date(llegada.value);
      d.setDate(d.getDate() + 1);
      salida.setAttribute('min', d.toISOString().split('T')[0]);
      if (salida.value && salida.value <= llegada.value) salida.value = '';
    });
  }

  // ── Validación de formularios (HTML5 + clase CSS) ──────
  document.querySelectorAll('form[novalidate]').forEach(form => {
    form.addEventListener('submit', e => {
      if (!form.checkValidity()) {
        e.preventDefault();
        form.querySelectorAll(':invalid').forEach(field => {
          field.style.borderBottomColor = '#e05050';
        });
        form.querySelectorAll(':valid').forEach(field => {
          field.style.borderBottomColor = '';
        });
      }
    });
  });

});
