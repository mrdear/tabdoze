const parameters = new URLSearchParams(window.location.hash.slice(1));
const originalTitle = parameters.get('title') ?? '';
const originalUrl = parameters.get('url');
const favicon = parameters.get('favicon');
const wakeButton = document.getElementById('wakeTab');
const pageTitle = document.getElementById('pageTitle');

document.title = `💤 ${originalTitle}`;
pageTitle.textContent = originalTitle;
pageTitle.hidden = !originalTitle;

if (favicon?.startsWith('data:image/png;base64,')) {
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/png';
    icon.sizes = '32x32';
    icon.href = favicon;
    document.head.appendChild(icon);
}

if (/^https?:\/\//i.test(originalUrl || '')) {
    wakeButton.disabled = false;
    wakeButton.addEventListener('click', () => {
        window.location.replace(originalUrl);
    });
}
