// Minimal static server for local development and the smoke tests. No dependencies.
const http = require('http'),
  fs = require('fs'),
  path = require('path');
const root = path.resolve(__dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.md': 'text/plain; charset=utf-8',
};
function createServer() {
  return http.createServer((req, res) => {
    let file = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (file.endsWith('/')) file += 'index.html';
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end('<h1>404</h1>');
      return;
    }
    res.writeHead(200, {
      'Content-Type': types[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(full).pipe(res);
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.argv[2]) || 8080;
  createServer().listen(port, () => console.log(`Prepora läuft auf http://localhost:${port}`));
}
