// Kabid Hassan Shibly — researcher site

let isJP = false;

function toggleLang() {
  isJP = !isJP;
  document.querySelectorAll('.en-el').forEach(el => el.classList.toggle('hidden', isJP));
  document.querySelectorAll('.jp-el').forEach(el => el.classList.toggle('hidden', !isJP));
  document.getElementById('lang-btn').textContent = isJP ? '日本語 → EN' : 'EN → 日本語';
}

document.addEventListener('DOMContentLoaded', () => {
  const rows = document.querySelectorAll('.research-row, .pub-block, .award-row, .edu-row');
  rows.forEach(row => {
    row.addEventListener('mouseenter', () => { row.style.paddingLeft = '0.3rem'; });
    row.addEventListener('mouseleave', () => { row.style.paddingLeft = ''; });
  });
});
