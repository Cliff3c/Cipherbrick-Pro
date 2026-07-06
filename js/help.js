import { I18nModule } from './modules/i18n.js';

// Apply stored language on load
const stored = I18nModule.getStoredLanguage();
const langSelect = document.getElementById('helpLangSelect');
if (langSelect) langSelect.value = stored;
await I18nModule.setLanguage(stored);

// Language switcher
langSelect?.addEventListener('change', async (e) => {
  await I18nModule.setLanguage(e.target.value);
  langSelect.value = e.target.value;
});

// Live search - show/hide sections as the user types
const searchInput = document.getElementById('helpSearch');
const sections = Array.from(document.querySelectorAll('.help-section'));
const noResults = document.getElementById('noResults');
const sidebarLinks = Array.from(document.querySelectorAll('.help-sidebar a'));

searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase().trim();
  let visible = 0;

  sections.forEach(section => {
    const match = !q || section.textContent.toLowerCase().includes(q);
    section.style.display = match ? '' : 'none';
    if (match) visible++;
  });

  noResults.style.display = (q && visible === 0) ? 'block' : 'none';

  sidebarLinks.forEach(link => {
    const id = link.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    const parentSection = target ? target.closest('.help-section') || target : null;
    const hidden = parentSection && parentSection.style.display === 'none';
    link.style.opacity = hidden ? '0.3' : '';
  });
});

// Highlight active sidebar link on scroll
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const id = entry.target.id;
      sidebarLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === '#' + id);
      });
    }
  });
}, { rootMargin: '-20% 0px -70% 0px', threshold: 0 });

sections.forEach(s => observer.observe(s));
