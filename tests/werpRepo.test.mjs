import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const IDENTIFIER_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

test('index.json 符合 WERP Schema Version 1 規範', () => {
    const indexPath = path.join(rootDir, 'index.json');
    assert.ok(fs.existsSync(indexPath), '根目錄必須存在 index.json');

    const raw = fs.readFileSync(indexPath, 'utf8');
    const index = JSON.parse(raw);

    assert.equal(typeof index, 'object');
    assert.notEqual(index, null);
    assert.ok(!Array.isArray(index), '根節點必須為 JSON Object');

    assert.equal(index.schemaVersion, 1, 'schemaVersion 必須為整數 1');
    assert.equal(typeof index.name, 'string');
    assert.ok(index.name.trim().length > 0, 'name 必須為非空字串');

    assert.equal(typeof index.identifier, 'string');
    assert.match(index.identifier, IDENTIFIER_RE, 'identifier 格式不符');

    assert.equal(typeof index.description, 'string', 'description 必須為字串');
    assert.ok(Array.isArray(index.extensions), 'extensions 必須為陣列');

    const seenIds = new Set();

    for (const ext of index.extensions) {
        assert.equal(typeof ext, 'object');
        assert.notEqual(ext, null);

        assert.equal(typeof ext.id, 'string');
        assert.match(ext.id, IDENTIFIER_RE, `擴充程式 id 格式不符: ${ext.id}`);
        assert.ok(!seenIds.has(ext.id), `同一份索引中不得出現重複的擴充程式 ID: ${ext.id}`);
        seenIds.add(ext.id);

        assert.equal(typeof ext.name, 'string');
        assert.ok(ext.name.trim().length > 0, '擴充程式 name 必須為非空字串');

        assert.equal(typeof ext.version, 'string');
        assert.match(ext.version, SEMVER_RE, `version 必須符合 SemVer 2.0.0: ${ext.version}`);

        assert.equal(typeof ext.description, 'string');

        assert.equal(typeof ext.file, 'string');
        assert.ok(!ext.file.startsWith('/'), 'file 必須為相對路徑');
        assert.ok(!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ext.file), 'file 不得為絕對 URL');
        assert.ok(!ext.file.startsWith('//'), 'file 不得為協定相對 URL');
        assert.ok(!ext.file.split('/').includes('..'), 'file 不得包含路徑區段迴退');
        assert.ok(!ext.file.includes('?') && !ext.file.includes('#'), 'file 不得包含查詢參數或 URL 片段');
        assert.ok(ext.file.endsWith('.zip'), 'file 必須以 .zip 結尾');

        const zipPath = path.join(rootDir, ext.file);
        assert.ok(fs.existsSync(zipPath), `找不到宣告的套件檔案: ${ext.file}`);

        assert.equal(typeof ext.sha256, 'string');
        assert.match(ext.sha256, SHA256_RE, 'sha256 必須為 64 個十六進位字元');

        const zipBytes = fs.readFileSync(zipPath);
        const actualHash = crypto.createHash('sha256').update(zipBytes).digest('hex');
        assert.equal(ext.sha256.toLowerCase(), actualHash, `${ext.file} 的 SHA-256 驗證失敗`);
    }
});
