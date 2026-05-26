// Kabid Hassan Shibly — researcher site

let isJP = false;
let isLight = false;

function toggleLang() {
  isJP = !isJP;
  document.querySelectorAll('.en-el').forEach(el => el.classList.toggle('hidden', isJP));
  document.querySelectorAll('.jp-el').forEach(el => el.classList.toggle('hidden', !isJP));
  document.getElementById('lang-btn').textContent = isJP ? '日本語 → EN' : 'EN → 日本語';
}

function toggleTheme() {
  isLight = !isLight;
  document.body.classList.toggle('light', isLight);
  document.getElementById('sw-label').textContent = isLight ? 'ON' : 'OFF';
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
}

document.addEventListener('DOMContentLoaded', () => {
  // restore saved theme
  const saved = localStorage.getItem('theme');
  if (saved === 'light') {
    isLight = true;
    document.body.classList.add('light');
    const lbl = document.getElementById('sw-label');
    if (lbl) lbl.textContent = 'ON';
  }

  // hover nudge on rows
  document.querySelectorAll('.research-row, .pub-block, .award-row, .edu-row').forEach(row => {
    row.addEventListener('mouseenter', () => { row.style.paddingLeft = '0.3rem'; });
    row.addEventListener('mouseleave', () => { row.style.paddingLeft = ''; });
  });
});
