import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    EXTENSION_ID,
    scaleBase,
    noteRefPos,
    getNoteScreenPos,
    resolveWifiWingPaths,
    computeHandAssignments,
    getHandCursorStates,
    getNoteOverrideKey,
    activate,
} from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function makeLinearPath(fromPos, toPos) {
    const p0 = getNoteScreenPos(fromPos);
    const p1 = getNoteScreenPos(toPos);
    return {
        totalLength: Math.hypot(p1.x - p0.x, p1.y - p0.y),
        getPointAt(t) {
            const u = Math.max(0, Math.min(1, t));
            return {
                x: p0.x + (p1.x - p0.x) * u,
                y: p0.y + (p1.y - p0.y) * u,
                rot: Math.atan2(p1.y - p0.y, p1.x - p0.x),
            };
        },
    };
}

function makeMockCanvasCtx() {
    const ops = [];
    const fn = (name) => (...args) => ops.push([name, ...args]);
    return {
        ops,
        save: fn('save'),
        restore: fn('restore'),
        setTransform: fn('setTransform'),
        beginPath: fn('beginPath'),
        closePath: fn('closePath'),
        arc: fn('arc'),
        moveTo: fn('moveTo'),
        lineTo: fn('lineTo'),
        fill: fn('fill'),
        stroke: fn('stroke'),
        setLineDash: fn('setLineDash'),
        fillText: fn('fillText'),
        globalAlpha: 1,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
    };
}

test('manifest.json 符合 WMCX Extension API v1 規範', () => {
    const raw = fs.readFileSync(path.join(rootDir, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw);

    assert.equal(manifest.id, EXTENSION_ID);
    assert.match(manifest.id, /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*)+$/i);
    assert.ok(manifest.name && typeof manifest.name === 'string');
    assert.match(manifest.version, /^\d+\.\d+\.\d+/);
    assert.equal(manifest.apiVersion, 1);
    assert.equal(manifest.entry, 'index.js');
    assert.equal(manifest.runtime, 'trusted');
    assert.ok(manifest.homepage.startsWith('https://'));

    const allowedPerms = new Set([
        'editor:read',
        'editor:write',
        'chart:read',
        'view:read',
        'playback:read',
        'playback:seek',
        'render:overlay',
        'commands:register',
        'events:subscribe',
        'settings:read',
        'settings:override',
        'assets:read',
        'assets:override',
        'ui:toast',
        'ui:menu',
        'ui:popover',
        'ui:overlay',
        'storage',
        'i18n:register',
    ]);
    assert.ok(Array.isArray(manifest.permissions));
    for (const perm of manifest.permissions) {
        assert.ok(allowedPerms.has(perm), `未定義權限: ${perm}`);
    }
});

test('getNoteScreenPos 正確換算外鍵與 Touch 座標', () => {
    const p1 = getNoteScreenPos(1);
    const p8 = getNoteScreenPos(8);
    assert.ok(p1.x > 0 && p1.y < 0, '1 號鍵應位於右上方');
    assert.ok(p8.x < 0 && p8.y < 0, '8 號鍵應位於左上方');

    const c = getNoteScreenPos({ touchPos: 'C', pos: 1 });
    assert.deepEqual(c, { x: 0, y: 0 });

    const a3 = getNoteScreenPos('A3');
    assert.ok(a3.x > 0 && a3.y > 0, 'A3 應位於右下方');
});

test('凍結快照音符不會拋出 TypeError，並正確回傳 WeakMap 映射與統計', () => {
    const frozenNotes = Object.freeze([
        Object.freeze({ type: 'tap', pos: 8, time: 1.0 }),
        Object.freeze({ type: 'tap', pos: 1, time: 1.0 }),
    ]);

    const res = computeHandAssignments(frozenNotes);
    assert.equal(res.assignments.get(frozenNotes[0]).hand, 'L');
    assert.equal(res.assignments.get(frozenNotes[1]).hand, 'R');
    assert.equal(res.stats.total, 2);
    assert.equal(res.stats.left, 1);
    assert.equal(res.stats.right, 1);
    assert.equal(frozenNotes[0].hand, undefined);
});

test('高速異鍵交互 (1,2,1,2) 應交替雙手，不會單手跳打', () => {
    const notes = [
        { type: 'tap', pos: 1, time: 1.0 },
        { type: 'tap', pos: 2, time: 1.12 },
        { type: 'tap', pos: 1, time: 1.24 },
        { type: 'tap', pos: 2, time: 1.36 },
    ];
    const { assignments } = computeHandAssignments(notes);
    const hands = notes.map((n) => assignments.get(n).hand);
    assert.notEqual(hands[0], hands[1]);
    assert.notEqual(hands[1], hands[2]);
    assert.notEqual(hands[2], hands[3]);
});

test('中速同鍵連打應保持同手而不無故換手', () => {
    const notes = [
        { type: 'tap', pos: 2, time: 1.0 },
        { type: 'tap', pos: 2, time: 1.22 },
        { type: 'tap', pos: 2, time: 1.44 },
    ];
    const { assignments } = computeHandAssignments(notes);
    const hands = notes.map((n) => assignments.get(n).hand);
    assert.equal(hands[0], 'R');
    assert.equal(hands[1], 'R');
    assert.equal(hands[2], 'R');
});

test('單向圓周刷鍵 (1~8 與 8~1) 應維持單手順刷不斷手', () => {
    const cwNotes = Array.from({ length: 8 }, (_, i) => ({
        type: 'tap',
        pos: i + 1,
        time: 1.0 + i * 0.08,
    }));
    const cwRes = computeHandAssignments(cwNotes);
    const cwHands = cwNotes.map((n) => cwRes.assignments.get(n).hand);
    assert.ok(cwHands.every((h) => h === 'R'), `順時針刷鍵應全由右手執行，實際: ${cwHands.join(',')}`);

    const ccwNotes = Array.from({ length: 8 }, (_, i) => ({
        type: 'tap',
        pos: 8 - i,
        time: 1.0 + i * 0.08,
    }));
    const ccwRes = computeHandAssignments(ccwNotes);
    const ccwHands = ccwNotes.map((n) => ccwRes.assignments.get(n).hand);
    assert.ok(ccwHands.every((h) => h === 'L'), `逆時針刷鍵應全由左手執行，實際: ${ccwHands.join(',')}`);
});

test('Hold 佔用鎖定期間，其他鍵位音符應由空閒手接取', () => {
    const notes = [
        { type: 'hold', pos: 7, time: 1.0, holdDuration: 1.2 },
        { type: 'tap', pos: 2, time: 1.3 },
        { type: 'tap', pos: 3, time: 1.6 },
    ];
    const { assignments } = computeHandAssignments(notes);
    assert.equal(assignments.get(notes[0]).hand, 'L');
    assert.equal(assignments.get(notes[1]).hand, 'R');
    assert.equal(assignments.get(notes[2]).hand, 'R');

    // 同側雙鍵也不應使用已被 Hold 鎖定的同一隻手
    const sameSideNotes = [
        { type: 'hold', pos: 7, time: 1.0, holdDuration: 1.2 },
        { type: 'tap', pos: 6, time: 1.3 },
        { type: 'tap', pos: 8, time: 1.6 },
    ];
    const sameSideRes = computeHandAssignments(sameSideNotes);
    const holdHand = sameSideRes.assignments.get(sameSideNotes[0]).hand;
    assert.notEqual(sameSideRes.assignments.get(sameSideNotes[1]).hand, holdHand);
    assert.notEqual(sameSideRes.assignments.get(sameSideNotes[2]).hand, holdHand);
});

test('Slide 星星頭一致性與並發連鎖 Slide 各別追蹤', () => {
    const notes = [
        // 左側連鎖 8-6-4
        { type: 'tap', pos: 8, time: 1.0, isStar: true },
        {
            type: 'slide',
            index: 10,
            pos: 8,
            slideEnd: 6,
            slideType: '-',
            firstSlide: true,
            lastSlide: false,
            time: 1.0,
            slideDelay: 0.25,
            slideDuration: 0.4,
            path: makeLinearPath(8, 6),
        },
        {
            type: 'slide',
            index: 10,
            pos: 6,
            slideEnd: 4,
            slideType: '-',
            firstSlide: false,
            lastSlide: true,
            time: 1.0,
            slideDelay: 0.65,
            slideDuration: 0.4,
            path: makeLinearPath(6, 4),
        },
        // 右側同時連鎖 1-3-5 (與左側同 index / time)
        { type: 'tap', pos: 1, time: 1.0, isStar: true },
        {
            type: 'slide',
            index: 10,
            pos: 1,
            slideEnd: 3,
            slideType: '-',
            firstSlide: true,
            lastSlide: false,
            time: 1.0,
            slideDelay: 0.25,
            slideDuration: 0.4,
            path: makeLinearPath(1, 3),
        },
        {
            type: 'slide',
            index: 10,
            pos: 3,
            slideEnd: 5,
            slideType: '-',
            firstSlide: false,
            lastSlide: true,
            time: 1.0,
            slideDelay: 0.65,
            slideDuration: 0.4,
            path: makeLinearPath(3, 5),
        },
    ];

    const { assignments } = computeHandAssignments(notes);
    assert.equal(assignments.get(notes[0]).hand, 'L');
    assert.equal(assignments.get(notes[1]).hand, 'L');
    assert.equal(assignments.get(notes[2]).hand, 'L');
    assert.equal(assignments.get(notes[3]).hand, 'R');
    assert.equal(assignments.get(notes[4]).hand, 'R');
    assert.equal(assignments.get(notes[5]).hand, 'R');
});

test('WiFi (w slide) 應指派 BOTH 並分類左右翼軌跡', () => {
    const wifiNote = {
        type: 'slide',
        index: 1,
        pos: 1,
        slideEnd: 5,
        slideType: 'w',
        firstSlide: true,
        lastSlide: true,
        time: 1.0,
        slideDelay: 0.25,
        slideDuration: 0.5,
        path: makeLinearPath(1, 5),
        wPaths: {
            w1: makeLinearPath(1, 4),
            w2: makeLinearPath(1, 6),
        },
    };
    const notes = [
        { type: 'tap', pos: 1, time: 1.0, isStar: true },
        wifiNote,
    ];
    const { assignments } = computeHandAssignments(notes);
    const meta = assignments.get(wifiNote);
    assert.equal(meta.hand, 'BOTH');
    assert.ok(meta.wLeftPath);
    assert.ok(meta.wRightPath);
    assert.ok(meta.wLeftPath.getPointAt(1).x < meta.wRightPath.getPointAt(1).x);

    const cursors = getHandCursorStates(notes, 1.5, scaleBase, assignments);
    assert.equal(cursors.L.state, 'sliding');
    assert.equal(cursors.R.state, 'sliding');
    assert.ok(cursors.L.x < cursors.R.x);
});

test('支援手動手順覆寫 (manualHand 與 manualOverrides)', () => {
    const n1 = Object.freeze({ type: 'tap', pos: 1, time: 2.0, manualHand: 'L' });
    const n2 = Object.freeze({ type: 'tap', pos: 8, time: 2.0 });
    const nMine = Object.freeze({ type: 'tap', pos: 2, time: 3.0, isMine: true });

    const manualOverrides = new Map([[getNoteOverrideKey(nMine), 'L']]);
    const { assignments, stats } = computeHandAssignments([n1, n2, nMine], { manualOverrides });

    assert.equal(assignments.get(n1).hand, 'L');
    assert.equal(assignments.get(n1).isManual, true);
    assert.equal(assignments.get(n2).hand, 'R');
    assert.equal(assignments.get(nMine).hand, 'L');
    assert.equal(assignments.get(nMine).isManual, true);
    assert.equal(stats.manual, 2);
});

test('Extension activate(ctx) 整合：註冊疊加圖層、選單、指令並可安全繪製與釋放', () => {
    const notes = Object.freeze([
        Object.freeze({ type: 'tap', pos: 8, time: 1.0 }),
        Object.freeze({ type: 'tap', pos: 1, time: 1.5, isStar: true }),
        Object.freeze({
            type: 'slide',
            index: 2,
            pos: 1,
            slideEnd: 5,
            slideType: '-',
            firstSlide: true,
            lastSlide: true,
            time: 1.5,
            slideDelay: 0.25,
            slideDuration: 0.6,
            path: makeLinearPath(1, 5),
        }),
    ]);

    const overlays = [];
    const commands = new Map();
    const menuItems = [];
    const events = new Map();
    const toasts = [];
    const storageMap = new Map();
    let redrawCount = 0;

    const mockCtx = {
        apiVersion: 1,
        extensionId: EXTENSION_ID,
        hasPermission: () => true,
        chart: {
            getSnapshot: () => ({ difficulty: 4, maidata: {}, duration: 10, notes, tags: [] }),
        },
        settings: {
            get: (_k, def) => def,
        },
        render: {
            registerOverlay: (opts) => {
                overlays.push(opts);
                return () => {
                    const idx = overlays.indexOf(opts);
                    if (idx >= 0) overlays.splice(idx, 1);
                };
            },
            requestRedraw: () => {
                redrawCount += 1;
            },
        },
        commands: {
            register: (id, handler, meta) => {
                commands.set(id, { handler, meta });
                return () => commands.delete(id);
            },
        },
        events: {
            on: (name, cb) => {
                events.set(name, cb);
                return () => events.delete(name);
            },
        },
        ui: {
            registerMenuItem: (item) => {
                menuItems.push(item);
                return () => {};
            },
            getSettings: (schema) => {
                const out = {};
                for (const f of schema) out[f.key] = f.default;
                return out;
            },
            openPopover: () => ({ close: () => {}, getValues: () => ({}) }),
            toast: (msg) => toasts.push(msg),
        },
        storage: {
            get: (k, d = null) => (storageMap.has(k) ? storageMap.get(k) : d),
            set: (k, v) => {
                storageMap.set(k, v);
                return true;
            },
        },
        i18n: {
            registerTranslations: () => () => {},
            t: (k) => `ext.${EXTENSION_ID}.${k}`,
        },
    };

    const dispose = activate(mockCtx);
    assert.equal(overlays.length, 2, '應註冊 main 與 visual 兩個疊加圖層');
    assert.equal(menuItems.length, 3, '應註冊 3 個頂欄選單項目');
    assert.ok(commands.has('toggleCursor'));
    assert.ok(commands.has('showStats'));
    assert.ok(redrawCount >= 1);

    const mainOverlay = overlays.find((o) => o.target === 'main');
    const visualOverlay = overlays.find((o) => o.target === 'visual');

    const c2dMain = makeMockCanvasCtx();
    mainOverlay.draw({
        ctx: c2dMain,
        width: 1280,
        height: 720,
        scale: 1,
        scaleBase,
        unitPx: 7.2,
        globalTime: 1.9,
        isPlaying: true,
        isRenderingVideo: false,
        target: 'main',
        phase: 'afterNotes',
    });
    assert.ok(c2dMain.ops.length > 0, '主畫布應成功繪製游標與角標');

    const c2dVisual = makeMockCanvasCtx();
    visualOverlay.draw({
        ctx: c2dVisual,
        width: 600,
        height: 800,
        scale: 200,
        scaleBase,
        unitPx: 200,
        globalTime: 1.0,
        isPlaying: false,
        target: 'visual',
        phase: 'afterNotes',
    });
    assert.ok(c2dVisual.ops.length > 0, '視覺編輯器應成功繪製手順標記');

    commands.get('showStats').handler();
    assert.equal(toasts.length, 1);
    assert.match(toasts[0].content, /共 3 音符/);

    commands.get('toggleCursor').handler();
    assert.equal(toasts.length, 2);

    dispose();
    assert.equal(overlays.length, 0, '清理函式應完整移除疊加圖層');
});

test('Slide 抵達終點後手順角標不得於尾端殘留', () => {
    const notes = Object.freeze([
        Object.freeze({
            type: 'slide',
            index: 1,
            pos: 1,
            slideEnd: 5,
            slideType: '-',
            firstSlide: true,
            lastSlide: true,
            time: 1.0,
            slideDelay: 0.2,
            slideDuration: 0.5,
            path: makeLinearPath(1, 5),
        }),
    ]);

    const overlays = [];
    const mockCtx = {
        apiVersion: 1,
        extensionId: EXTENSION_ID,
        hasPermission: () => true,
        chart: {
            getSnapshot: () => ({ difficulty: 4, maidata: {}, duration: 10, notes, tags: [] }),
        },
        settings: { get: (_k, def) => def },
        render: {
            registerOverlay: (opts) => {
                overlays.push(opts);
                return () => {};
            },
            requestRedraw: () => {},
        },
        ui: {
            getSettings: () => ({
                showHandCursor: false,
                showHandNoteBadge: true,
                showHandNoteHalo: false,
                showVisualHandHint: false,
                cursorScale: 1.0,
                badgeOpacity: 0.92,
                includeInVideo: false,
            }),
        },
    };

    const dispose = activate(mockCtx);
    const mainOverlay = overlays.find((o) => o.target === 'main');

    // Slide 進行中 (1.0 + 0.2 <= 1.45 < 1.7) 應繪製角標
    const duringCtx = makeMockCanvasCtx();
    mainOverlay.draw({
        ctx: duringCtx,
        width: 1280,
        height: 720,
        scale: 1,
        scaleBase,
        unitPx: 7.2,
        globalTime: 1.45,
        isPlaying: true,
        isRenderingVideo: false,
        target: 'main',
        phase: 'afterNotes',
    });
    const duringTexts = duringCtx.ops.filter((op) => op[0] === 'fillText');
    assert.equal(duringTexts.length, 1, 'Slide 滑動期間應繪製 1 個手順角標');

    // Slide 結束後 (1.75 > 1.7，仍在 0.3s 回溯視窗內) 不應再殘留角標
    const afterCtx = makeMockCanvasCtx();
    mainOverlay.draw({
        ctx: afterCtx,
        width: 1280,
        height: 720,
        scale: 1,
        scaleBase,
        unitPx: 7.2,
        globalTime: 1.75,
        isPlaying: true,
        isRenderingVideo: false,
        target: 'main',
        phase: 'afterNotes',
    });
    const afterTexts = afterCtx.ops.filter((op) => op[0] === 'fillText');
    assert.equal(afterTexts.length, 0, 'Slide 結束後角標不應殘留於尾端');

    dispose();
});

test('應優先指派移動距離較近的手並避免反手交叉', () => {
    // 1. 中慢速相鄰移動應由較近的手接取（不該硬讓遠手跨區）
    const nearNotes = [
        { type: 'tap', pos: 7, time: 1.0 },
        { type: 'tap', pos: 3, time: 1.1 },
        { type: 'tap', pos: 6, time: 1.45 }, // 距 L(7) 極近，距 R(3) 極遠
        { type: 'tap', pos: 2, time: 1.50 }, // 距 R(3) 極近，距 L(6) 極遠
    ];
    const nearRes = computeHandAssignments(nearNotes);
    assert.equal(nearRes.assignments.get(nearNotes[0]).hand, 'L');
    assert.equal(nearRes.assignments.get(nearNotes[1]).hand, 'R');
    assert.equal(nearRes.assignments.get(nearNotes[2]).hand, 'L');
    assert.equal(nearRes.assignments.get(nearNotes[3]).hand, 'R');

    // 2. 避免反手：雙押與單向滑軌不應出現 L 在 R 右側之交叉情形
    const antiCrossNotes = [
        { type: 'tap', pos: 1, time: 1.0 },
        { type: 'tap', pos: 8, time: 1.0 },
        { type: 'hold', pos: 3, time: 1.3, holdDuration: 1.0 },
        { type: 'tap', pos: 8, time: 1.5 },
        { type: 'tap', pos: 6, time: 1.8 },
    ];
    const antiRes = computeHandAssignments(antiCrossNotes);
    assert.equal(antiRes.assignments.get(antiCrossNotes[0]).hand, 'R');
    assert.equal(antiRes.assignments.get(antiCrossNotes[1]).hand, 'L');
    assert.equal(antiRes.assignments.get(antiCrossNotes[2]).hand, 'R');
    assert.equal(antiRes.assignments.get(antiCrossNotes[3]).hand, 'L');
    assert.equal(antiRes.assignments.get(antiCrossNotes[4]).hand, 'L');

    // 3. 閒置超過 1.4 秒後手部回歸休息區，右側音符應由右手接取
    const restReturnNotes = [
        { type: 'tap', pos: 1, time: 1.0, manualHand: 'L' },
        { type: 'tap', pos: 1, time: 3.0 },
    ];
    const restRes = computeHandAssignments(restReturnNotes);
    assert.equal(restRes.assignments.get(restReturnNotes[1]).hand, 'R');
});

test('Hold 鎖手期間即使音符位於同側且需遠手跨區，仍絕不指派被鎖定的手', () => {
    const notes = [
        { type: 'hold', pos: 6, time: 1.0, holdDuration: 2.0 },
        { type: 'tap', pos: 2, time: 1.1 },
        { type: 'tap', pos: 7, time: 1.25 },
        { type: 'tap', pos: 8, time: 1.45 },
        { type: 'tap', pos: 7, time: 1.65 },
        { type: 'tap', pos: 8, time: 1.85 },
        { type: 'slide', index: 5, pos: 5, slideEnd: 1, slideType: '-', firstSlide: true, lastSlide: true, time: 2.1, slideDelay: 0.1, slideDuration: 0.4, path: makeLinearPath(5, 1) },
    ];
    const { assignments } = computeHandAssignments(notes);
    const lockedHand = assignments.get(notes[0]).hand;
    assert.equal(lockedHand, 'L');
    for (let i = 1; i < notes.length; i++) {
        assert.notEqual(
            assignments.get(notes[i]).hand,
            lockedHand,
            `第 ${i} 顆音符 (t=${notes[i].time}) 發生於 Hold 鎖手期間，不得使用被鎖定的 ${lockedHand}`
        );
    }
});


