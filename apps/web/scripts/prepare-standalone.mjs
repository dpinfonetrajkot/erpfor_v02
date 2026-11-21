// Makes the standalone build (.next/standalone) ready to run on the server:
// 1. copies the CSS/JS files (.next/static), which Next.js leaves out of it
// 2. copies each package of the build into standalone/node_modules as a plain folder.
//    pnpm keeps packages in node_modules/.pnpm behind links, which Hostinger does not
//    always follow - Next.js then cannot find packages such as '@swc/helpers'.
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(web, '.next', 'standalone');

cpSync(join(web, '.next', 'static'), join(standalone, 'apps', 'web', '.next', 'static'), { recursive: true });

const store = join(standalone, 'node_modules', '.pnpm');
for (const entry of existsSync(store) ? readdirSync(store) : []) {
  const modules = join(store, entry, 'node_modules');
  if (entry === 'node_modules' || !existsSync(modules)) continue;
  for (const name of readdirSync(modules)) {
    if (name.startsWith('.')) continue;
    const packages = name.startsWith('@') ? readdirSync(join(modules, name)).map((n) => join(name, n)) : [name];
    for (const pkg of packages) {
      const target = join(standalone, 'node_modules', pkg);
      if (pkg !== 'next' && !existsSync(target)) cpSync(join(modules, pkg), target, { recursive: true, dereference: true });
    }
  }
}
console.log('Standalone build ready');
