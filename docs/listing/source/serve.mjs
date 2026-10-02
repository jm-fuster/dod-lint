// Servidor local para cargar bundles en figma_execute con fetch + new Function.
// Sirve solo la carpeta indicada, nombres ^[\w.-]+$, CORS abierto, sin caché; se apaga a las 4 h.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
const port = Number(process.argv[3] || 9231);
const server = createServer(async (req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0].slice(1));
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (!/^[\w.-]+$/.test(name)) {
    res.writeHead(404, headers).end('not found');
    return;
  }
  try {
    const body = await readFile(join(dir, name));
    const types = { json: 'application/json', html: 'text/html; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', css: 'text/css; charset=utf-8' };
    const ext = name.split('.').pop();
    res.writeHead(200, { ...headers, 'Content-Type': types[ext] ?? 'text/javascript; charset=utf-8' }).end(body);
  } catch {
    res.writeHead(404, headers).end('not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`sirviendo ${dir} en http://127.0.0.1:${port}`));
setTimeout(() => process.exit(0), 4 * 60 * 60 * 1000).unref();
