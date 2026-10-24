const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest exposes the TabDoze identity without changing the fixed key', () => {
    assert.equal(manifest.short_name, 'TabDoze');
    assert.match(manifest.name, /^TabDoze\b/);
    assert.equal(manifest.version, '1.1.2');
    assert.equal(manifest.homepage_url, 'https://github.com/mrdear/tabdoze');
    assert.equal(
        manifest.key,
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoobNJgenmx7lowykgn3MwUGtFnPb2OnBvZByQ7Ur1sQeaxDMmVzblZ27zCsFyrvYWMGYdS10kwJoQENneUTY8CQr4KMXJb8aPculKz5IPAeVyr7PcBY2uOQe5c5Eor6iJaFjENRXsd0/kU/pS15GSamv70Eg3KtZfq2FcYtuFCbFYCTwsuiNKXCAHw8Xq8O+mtfRr9ZhtsgfTchzpuG+h7oQnmYToUwa3j4opreKdyFghFb8HetzxmZCw3RnbIO2VJ0yZh+rPeeQNkDNZ/zdsaXs817aAoUMZvLLt+irJxUkHRg20xYxYP/oTCXMasvFDNvoNOq/JrYxJlGv2qhENwIDAQAB'
    );
});
