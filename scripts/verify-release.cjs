const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { gunzipSync } = require('node:zlib');
const yaml = require('js-yaml');
const { version, build } = require('../package.json');

/** 校验更新清单实际指向安装版，分块尺寸及包内更新源与发行配置一致。 */
async function verifyRelease() {
  const output = path.join(__dirname, '..', build.directories.output);
  const installer = 'Yejian-Setup-' + version + '-x64.exe';
  const manifest = yaml.load(fs.readFileSync(path.join(output, 'latest.yml'), 'utf8'));
  const feed = yaml.load(fs.readFileSync(path.join(output, 'win-unpacked/resources/app-update.yml'), 'utf8'));
  for (const [key, value] of Object.entries(build.publish)) assert.equal(feed[key], value);
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, installer);
  const size = fs.statSync(path.join(output, installer)).size;
  const hash = createHash('sha512');
  for await (const bytes of fs.createReadStream(path.join(output, installer))) hash.update(bytes);
  const digest = hash.digest('base64');
  assert.equal(manifest.sha512, digest);
  assert.equal(manifest.files.length, 1);
  const [file] = manifest.files;
  assert.equal(file.url, installer);
  assert.equal(file.sha512, digest);
  assert.equal(file.size, size);
  const blockmap = JSON.parse(gunzipSync(fs.readFileSync(path.join(output, installer + '.blockmap'))));
  assert.equal(blockmap.files.flatMap(entry => entry.sizes).reduce((total, bytes) => total + bytes, 0), size);
  assert.ok(fs.statSync(path.join(output, 'Yejian-Portable-' + version + '-x64.exe')).size > 0);
  console.log('安装版、免安装版、更新源、分块清单及 SHA-512 校验通过', version);
}

verifyRelease().catch(error => { console.error(error); process.exitCode = 1; });
