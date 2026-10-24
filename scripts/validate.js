const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const requiredFiles = [
    'manifest.json',
    'background.js',
    'popup.html',
    'popup.js',
    'popup.css',
    'settings.html',
    'settings.js',
    'settings.css',
    'stats-dashboard.html',
    'stats-dashboard.js',
    'onboarding.html',
    'onboarding.js',
    'onboarding.css',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png'
];

for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(root, relativePath))) {
        throw new Error(`Missing required extension file: ${relativePath}`);
    }
}

if (manifest.version !== packageJson.version) {
    throw new Error(`Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`);
}

if (manifest.short_name !== 'TabDoze' || !manifest.name.startsWith('TabDoze')) {
    throw new Error('Manifest brand must be TabDoze');
}

if (manifest.homepage_url !== 'https://github.com/mrdear/tabdoze') {
    throw new Error('Manifest homepage_url is not the TabDoze repository');
}

if (!manifest.key) {
    throw new Error('The fixed manifest.key is required to preserve the extension ID');
}

const javascriptFiles = fs.readdirSync(root, { recursive: true })
    .filter(file => file.endsWith('.js'))
    .filter(file => !file.startsWith('dist/') && !file.startsWith('tmp/'));

for (const relativePath of javascriptFiles) {
    execFileSync(process.execPath, ['--check', path.join(root, relativePath)], {
        stdio: 'inherit'
    });
}

console.log(`Validated TabDoze ${manifest.version}: ${javascriptFiles.length} JavaScript files`);
