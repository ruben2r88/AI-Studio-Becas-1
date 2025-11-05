import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const templatePath = path.join(rootDir, 'templates', 'base-layout.html');
const outputDir = path.join(rootDir, 'static');

const pages = [
  { id: 'inicio', label: 'Home', title: 'Eture | Home', partial: 'views/inicio.html', icon: 'bi-speedometer2' },
  { id: 'perfil', label: 'My Profile', title: 'Eture | My Profile', partial: 'views/perfil.html', icon: 'bi-person-circle' },
  { id: 'proceso', label: 'My Process', title: 'Eture | My Process', partial: 'views/proceso.html', icon: 'bi-diagram-3' },
  { id: 'visa', label: 'My Visa', title: 'Eture | My Visa', partial: 'views/my-visa.html', icon: 'bi-passport' },
  { id: 'tareas', label: 'Task List', title: 'Eture | Task List', partial: 'views/tareas.html', icon: 'bi-check2-square' },
  { id: 'documentos', label: 'My Documents', title: 'Eture | My Documents', partial: 'views/documentos.html', icon: 'bi-folder2' },
  { id: 'finanzas', label: 'My Financials', title: 'Eture | My Financials', partial: 'views/us/myfinancials.html', icon: 'bi-piggy-bank' },
  { id: 'chat', label: 'Chat', title: 'Eture | Chat', partial: 'views/chat.html', icon: 'bi-chat-dots' },
  { id: 'ayuda', label: 'Help', title: 'Eture | Help', partial: 'views/ayuda.html', icon: 'bi-life-preserver' }
];

function buildNavItems(activeId) {
  const markup = pages.map(page => {
    const isActive = page.id === activeId;
    const activeClass = isActive ? ' active' : '';
    const ariaCurrent = isActive ? ' aria-current="page"' : '';
    const href = `${page.id}.html`;
    const icon = page.icon ? `<i class="bi ${page.icon} me-3"></i>` : '';
    return [
      '            <li class="nav-item">',
      `              <a href="${href}" class="nav-link d-flex align-items-center${activeClass}"${ariaCurrent}>`,
      `                ${icon}<span>${page.label}</span>`,
      '              </a>',
      '            </li>'
    ].join('\n');
  }).join('\n');
  return markup.replace(/^\s+/, '');
}

async function loadTemplate() {
  try {
    return await fs.readFile(templatePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read base template at ${templatePath}: ${error.message}`);
  }
}

async function loadPartial(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  try {
    const content = await fs.readFile(absolutePath, 'utf8');
    return content.trim();
  } catch (error) {
    throw new Error(`Unable to read partial at ${absolutePath}: ${error.message}`);
  }
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

async function renderPage(baseTemplate, page) {
  const navItems = buildNavItems(page.id);
  const content = await loadPartial(page.partial);
  let rendered = baseTemplate.replace(/{{PAGE_ID}}/g, page.id);
  rendered = rendered.replace(/{{PAGE_TITLE}}/g, page.title);
  rendered = rendered.replace('{{NAV_ITEMS}}', navItems);
  rendered = rendered.replace('{{CONTENT}}', content);
  rendered = adjustAssetPaths(rendered);
  const outPath = path.join(outputDir, `${page.id}.html`);
  await fs.writeFile(outPath, rendered, 'utf8');
  return outPath;
}

function adjustAssetPaths(html) {
  return html
    .replace(/(href|src)="assets\//g, '$1="../assets/')
    .replace(/(["'(])assets\//g, '$1../assets/');
}

async function run() {
  const baseTemplate = await loadTemplate();
  await ensureOutputDir();
  const results = [];
  for (const page of pages) {
    const outPath = await renderPage(baseTemplate, page);
    results.push(path.relative(rootDir, outPath));
  }
  console.log(`Static pages generated:\n- ${results.join('\n- ')}`);
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
