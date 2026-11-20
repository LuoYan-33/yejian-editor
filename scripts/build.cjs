const esbuild = require('esbuild');
const fs = require('node:fs/promises');
const path = require('node:path');

/** 将界面及其所有依赖打包到本地，无须启动服务器。 */
async function build() {
  const root = path.resolve(__dirname, '..');
  const target = path.join(root, 'ui-dist');
  await esbuild.build({ absWorkingDir: root, entryPoints: ['ui/app.js'], outfile: 'ui-dist/app.js',
    bundle: true, minify: true, target: 'chrome140', legalComments: 'eof', loader: { '.md': 'text' } });
  await fs.copyFile(path.join(root, 'ui/index.html'), path.join(target, 'index.html'));
}

build().catch(error => { console.error(error); process.exitCode = 1; });
