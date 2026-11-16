/**
 * index.js
 * Web mai Chart X 手順解析引擎擴充程式 (Hand Hint Engine Extension)
 *
 * 參照 web-mai-chart-x `hand` 分支之手順推算與虛擬雙手軌跡演算法，
 * 透過官方 Extension API v1 實作非侵入式手順解析、主圓盤游標/音符角標疊加與視覺編輯器手順提示。
 */

export const EXTENSION_ID = 'com.susuy0725.hand-hint-engine';

// ============================================================================
// 1. 幾何座標與常數定義 (對應 Scripts/core/chartGeometry.js)
// ============================================================================

export const scaleBase = 100;
export const innerCirleBase = (scaleBase * 0.889) / 2;

export const noteRefPos = Array.from({ length: 8 }, (_, i) => {
    const a = ((i - 1.5) * Math.PI) / 4;
    const rot = a + Math.PI / 2;
    return {
        x: Math.cos(a) * innerCirleBase,
        y: Math.sin(a) * innerCirleBase,
        rot,
        cosRot: Math.cos(rot),
        sinRot: Math.sin(rot),
    };
});

export const touchRefPos = {
    A: Array.from({ length: 8 }, (_, i) => {
        const a = ((i - 1.5) * Math.PI) / 4;
        return {
            x: Math.cos(a) * innerCirleBase * 0.833,
            y: Math.sin(a) * innerCirleBase * 0.833,
            rot: a + Math.PI / 2,
        };
    }),
    B: Array.from({ length: 8 }, (_, i) => {
        const a = ((i - 1.5) * Math.PI) / 4;
        return {
            x: Math.cos(a) * innerCirleBase * 0.458,
            y: Math.sin(a) * innerCirleBase * 0.458,
            rot: a + Math.PI / 2,
        };
    }),
    C: [{ x: 0, y: 0 }],
    D: Array.from({ length: 8 }, (_, i) => {
        const a = ((i - 2) * Math.PI) / 4;
        return {
            x: Math.cos(a) * innerCirleBase * 0.854,
            y: Math.sin(a) * innerCirleBase * 0.854,
            rot: a + Math.PI / 2,
        };
    }),
    E: Array.from({ length: 8 }, (_, i) => {
        const a = ((i - 2) * Math.PI) / 4;
        return {
            x: Math.cos(a) * innerCirleBase * 0.645,
            y: Math.sin(a) * innerCirleBase * 0.645,
            rot: a + Math.PI / 2,
        };
    }),
};

export const visualNoteRefPos = Array.from({ length: 9 }, (_, i) => ({
    x: ((4 - i) * innerCirleBase) / 4,
}));

export const HAND_COLORS = {
    L: {
        main: '#38bdf8',
        border: '#0284c7',
        badgeFill: 'rgba(14, 165, 233, 0.92)',
        glow: 'rgba(56, 189, 248, 0.45)',
    },
    R: {
        main: '#fb7185',
        border: '#e11d48',
        badgeFill: 'rgba(244, 63, 94, 0.92)',
        glow: 'rgba(251, 113, 133, 0.45)',
    },
    BOTH: {
        main: '#a855f7',
        border: '#7e22ce',
        badgeFill: 'rgba(147, 51, 234, 0.92)',
        glow: 'rgba(168, 85, 247, 0.45)',
    },
};

const REST_POS = {
    L: { x: -0.28 * scaleBase, y: 0.22 * scaleBase },
    R: { x: 0.28 * scaleBase, y: 0.22 * scaleBase },
};

const clampVal = (v, min, max) => (v < min ? min : (v > max ? max : v));

const easeInOutCubic = (t) => {
    const x = clampVal(t, 0, 1);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

const calcPiecewiseSpeed = (x) => {
    if (x >= 1) return x * 0.8833 + 0.8167;
    if (x <= -1) return x * 0.8833 - 0.8167;
    return x * 1.7;
};

const timeFunction = (x) => (
    0.02160482279616 * x * x * x -
    0.07553691072 * x * x +
    0.43509924 * x +
    0.000250029
);

// ============================================================================
// 2. 手順解析核心演算法 (Beam Search DP + 刷鍵偵測 + WiFi 雙翼分配)
// ============================================================================

/**
 * 取得音符或 Slide 目標在畫布空間 (scaleBase = 100, 原點在圓心) 的座標
 * @param {Object|number|string} noteOrPos
 * @returns {{ x: number, y: number }}
 */
export function getNoteScreenPos(noteOrPos) {
    if (noteOrPos && typeof noteOrPos === 'object') {
        if (noteOrPos.touchPos) {
            const tp = noteOrPos.touchPos;
            if (tp === 'C') {
                return { x: touchRefPos.C[0].x, y: touchRefPos.C[0].y };
            }
            const group = touchRefPos[tp];
            const idx = (noteOrPos.pos || 1) - 1;
            if (group && group[idx]) {
                return { x: group[idx].x, y: group[idx].y };
            }
            return { x: 0, y: 0 };
        }
        const pos = parseInt(noteOrPos.pos, 10);
        if (pos >= 1 && pos <= 8 && noteRefPos[pos - 1]) {
            return { x: noteRefPos[pos - 1].x, y: noteRefPos[pos - 1].y };
        }
        return { x: 0, y: 0 };
    }

    if (typeof noteOrPos === 'number') {
        const idx = noteOrPos - 1;
        if (idx >= 0 && idx < 8 && noteRefPos[idx]) {
            return { x: noteRefPos[idx].x, y: noteRefPos[idx].y };
        }
        return { x: 0, y: 0 };
    }

    if (typeof noteOrPos === 'string') {
        const trimmed = noteOrPos.trim().toUpperCase();
        if (trimmed === 'C' || trimmed === 'C1' || trimmed === 'C2') {
            return { x: 0, y: 0 };
        }
        const touchMatch = trimmed.match(/^([ABCDE])([1-8])$/);
        if (touchMatch) {
            const group = touchRefPos[touchMatch[1]];
            const idx = parseInt(touchMatch[2], 10) - 1;
            if (group && group[idx]) {
                return { x: group[idx].x, y: group[idx].y };
            }
        }
        const num = parseInt(trimmed, 10);
        if (num >= 1 && num <= 8 && noteRefPos[num - 1]) {
            return { x: noteRefPos[num - 1].x, y: noteRefPos[num - 1].y };
        }
    }

    return { x: 0, y: 0 };
}

/**
 * 依據 WiFi 分支幾何分類 wPaths 中的左右翼軌跡
 * 若尚未建立 PathRecorder 實例（例如單元測試），依終點幾何推算兩翼座標
 */
export function resolveWifiWingPaths(slideNote, stateL = REST_POS.L, stateR = REST_POS.R) {
    const w1 = slideNote?.wPaths?.w1 || null;
    const w2 = slideNote?.wPaths?.w2 || null;

    if (!w1 || !w2) {
        const startPt = getNoteScreenPos(slideNote?.pos);
        const endPos = parseInt(slideNote?.slideEnd || slideNote?.pos, 10);
        if (endPos >= 1 && endPos <= 8 && !w1 && !w2) {
            const leftWingEnd = noteRefPos[(endPos - 2 + 8) % 8];
            const rightWingEnd = noteRefPos[endPos % 8];
            const makeLinearWing = (endPt) => ({
                getPointAt: (t) => {
                    const u = clampVal(t, 0, 1);
                    return {
                        x: startPt.x + (endPt.x - startPt.x) * u,
                        y: startPt.y + (endPt.y - startPt.y) * u,
                        rot: Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x),
                    };
                },
            });
            const syn1 = makeLinearWing(leftWingEnd);
            const syn2 = makeLinearWing(rightWingEnd);
            const dist1L2R =
                Math.hypot(leftWingEnd.x - stateL.x, leftWingEnd.y - stateL.y) +
                Math.hypot(rightWingEnd.x - stateR.x, rightWingEnd.y - stateR.y);
            const dist2L1R =
                Math.hypot(rightWingEnd.x - stateL.x, rightWingEnd.y - stateL.y) +
                Math.hypot(leftWingEnd.x - stateR.x, leftWingEnd.y - stateR.y);
            if (Math.abs(leftWingEnd.x - rightWingEnd.x) > 1.5) {
                return leftWingEnd.x < rightWingEnd.x
                    ? { wLeftPath: syn1, wRightPath: syn2 }
                    : { wLeftPath: syn2, wRightPath: syn1 };
            }
            return dist1L2R <= dist2L1R
                ? { wLeftPath: syn1, wRightPath: syn2 }
                : { wLeftPath: syn2, wRightPath: syn1 };
        }

        return {
            wLeftPath: w1 || slideNote?.path || null,
            wRightPath: w2 || slideNote?.path || null,
        };
    }

    const p1 = typeof w1.getPointAt === 'function' ? w1.getPointAt(1) : null;
    const p2 = typeof w2.getPointAt === 'function' ? w2.getPointAt(1) : null;
    if (p1 && p2) {
        if (Math.abs(p1.x - p2.x) > 1.5) {
            return p1.x < p2.x
                ? { wLeftPath: w1, wRightPath: w2 }
                : { wLeftPath: w2, wRightPath: w1 };
        }
        const dist1L2R =
            Math.hypot(p1.x - stateL.x, p1.y - stateL.y) +
            Math.hypot(p2.x - stateR.x, p2.y - stateR.y);
        const dist2L1R =
            Math.hypot(p2.x - stateL.x, p2.y - stateL.y) +
            Math.hypot(p1.x - stateR.x, p1.y - stateR.y);
        return dist1L2R <= dist2L1R
            ? { wLeftPath: w1, wRightPath: w2 }
            : { wLeftPath: w2, wRightPath: w1 };
    }

    return { wLeftPath: w1, wRightPath: w2 };
}

function cloneHandState(s) {
    return { x: s.x, y: s.y, time: s.time, lockUntil: s.lockUntil };
}

function getPosKey(n) {
    return n.touchPos ? `${n.touchPos}${n.touchPos === 'C' ? '' : n.pos}` : String(n.pos);
}

/**
 * 產生穩定的音符識別鍵，供手動手順覆寫查詢使用
 */
export function getNoteOverrideKey(note) {
    if (!note) return '';
    const t = Number(note.time || 0).toFixed(4);
    const posKey = getPosKey(note);
    const type = note.type || 'tap';
    return `${t}|${type}|${posKey}`;
}

function resolveManualHand(note, manualOverrides) {
    if (!note) return null;
    if (note.manualHand === 'L' || note.manualHand === 'R' || note.manualHand === 'BOTH') {
        return note.manualHand;
    }
    if (manualOverrides) {
        const key = getNoteOverrideKey(note);
        const val = manualOverrides instanceof Map ? manualOverrides.get(key) : manualOverrides[key];
        if (val === 'L' || val === 'R' || val === 'BOTH') {
            return val;
        }
    }
    return null;
}

function getSingleOuterButtonPos(step, manualOverrides) {
    if (!step || step.slideItems.length > 0) return null;
    const activeHeads = step.headItems.filter((it) => !it.note.isMine || it.manualHand);
    if (activeHeads.length !== 1) return null;
    const n = activeHeads[0].note;
    if (!n || n.touchPos || n.type === 'hold' || n.holdDuration) return null;
    if (manualOverrides && resolveManualHand(n, manualOverrides)) {
        // 仍允許刷鍵偵測，唯後續 DP 會優先尊重手動指定
    }
    const pos = parseInt(n.pos, 10);
    return pos >= 1 && pos <= 8 ? pos : null;
}

/**
 * 預先標記單向圓周刷鍵區段（如 1,2,3,4,5,6,7,8 或 8,7,6,5,4,3,2,1）
 * 排除來回折返的交互（如 1,2,1,2 或 1,2,1,8）
 */
function markCircularSweepSteps(timelineSteps, manualOverrides) {
    const len = timelineSteps.length;
    if (len < 3) return;

    const singlePositions = new Array(len);
    for (let i = 0; i < len; i++) {
        singlePositions[i] = getSingleOuterButtonPos(timelineSteps[i], manualOverrides);
    }

    const transDirs = new Int8Array(len); // 1: 順時針(+1), -1: 逆時針(-1), 0: 非單向相鄰
    for (let i = 1; i < len; i++) {
        const pPrev = singlePositions[i - 1];
        const pCur = singlePositions[i];
        if (pPrev === null || pCur === null) continue;
        const dt = timelineSteps[i].time - timelineSteps[i - 1].time;
        if (dt < 0.015 || dt > 0.22) continue;
        const diff = (pCur - pPrev + 8) % 8;
        if (diff === 1) {
            transDirs[i] = 1;
        } else if (diff === 7) {
            transDirs[i] = -1;
        }
    }

    let i = 1;
    while (i < len) {
        const dir = transDirs[i];
        if (dir === 0) {
            i++;
            continue;
        }
        const segStart = i;
        while (i + 1 < len && transDirs[i + 1] === dir) {
            i++;
        }
        const segEnd = i;
        const runLen = segEnd - segStart + 1;
        const runStart = segStart - 1;

        let isSweep = false;
        if (runLen >= 3) {
            isSweep = true;
        } else if (runLen === 2) {
            const avgDt = (timelineSteps[segEnd].time - timelineSteps[runStart].time) / 2;
            const prevRev = transDirs[runStart] === -dir;
            const nextRev = segEnd + 1 < len && transDirs[segEnd + 1] === -dir;
            if (avgDt <= 0.13 && !prevRev && !nextRev) {
                isSweep = true;
            }
        }

        if (isSweep) {
            timelineSteps[runStart].sweepStartDir = dir;
            for (let k = segStart; k <= segEnd; k++) {
                timelineSteps[k].isSweepContinuation = true;
                timelineSteps[k].sweepDir = dir;
            }
        }
        i = segEnd + 1;
    }
}

/**
 * 計算手部在指定時間點的有效位置（閒置超過 0.8s 且未鎖定時平滑回歸休息區）
 */
function getEffectiveHandPos(st, hand, actionTime) {
    const idleGap = actionTime - st.time;
    if (idleGap > 0.8 && st.lockUntil <= actionTime) {
        const relaxT = clampVal((idleGap - 0.8) / 0.6, 0, 1);
        const rest = REST_POS[hand];
        return {
            x: st.x + (rest.x - st.x) * relaxT,
            y: st.y + (rest.y - st.y) * relaxT,
        };
    }
    return { x: st.x, y: st.y };
}

/**
 * 評估將單一擊打動作分配給指定手 ('L' | 'R') 的成本與更新後狀態
 */
function scoreAndApplyAction(dpState, hand, nx, ny, actionTime, opts) {
    const {
        endTime,
        lockUntil,
        endX = nx,
        endY = ny,
        isSingleHead = false,
        posKey = null,
        allowLock = true,
        isSlide = false,
        handAtStartPos = null,
        usedHandsOtherPos = null,
        starHeadHand = null,
        isSweepContinuation = false,
        sweepStartDir = 0,
    } = opts;

    const st = hand === 'L' ? dpState.stateL : dpState.stateR;
    const otherHand = hand === 'L' ? 'R' : 'L';
    const otherSt = hand === 'L' ? dpState.stateR : dpState.stateL;
    let deltaCost = 0;

    // 1. Hold / Slide 佔用鎖定懲罰（硬性優先避讓被鎖定的手，除非雙手皆已鎖定）
    if (allowLock && st.lockUntil > actionTime + 0.015) {
        deltaCost += 10000;
    }

    // 2. 同一時間步的頭音符 / 星星頭與滑軌一致性檢查
    if (isSlide) {
        if (handAtStartPos === hand) {
            deltaCost -= 25;
        } else if (usedHandsOtherPos && usedHandsOtherPos.has(hand)) {
            deltaCost += 700;
        }
        if (starHeadHand) {
            if (starHeadHand === hand && !(usedHandsOtherPos && usedHandsOtherPos.has(hand))) {
                deltaCost -= 60;
            } else if (starHeadHand !== hand) {
                deltaCost += 40;
            }
        }
    }

    // 3. 移動距離與二次大幅跨動懲罰（使用閒置平滑回歸後之位置，優先選擇距離較近的手）
    const effPos = getEffectiveHandPos(st, hand, actionTime);
    const dNorm = Math.hypot(nx - effPos.x, ny - effPos.y) / innerCirleBase;
    const dt = Math.max(0.025, actionTime - st.time);
    const distCost =
        isSweepContinuation && dpState.lastHand === hand
            ? 8 * dNorm
            : 42 * dNorm + 65 * (dNorm * dNorm);
    deltaCost += distCost;

    // 4. 刷鍵延續 / 高速連打換手 / 同鍵節奏維持
    if (isSweepContinuation) {
        if (dpState.lastHand === hand) {
            deltaCost -= 140;
        } else if (dpState.lastHand && dpState.lastHand !== hand) {
            deltaCost += 180;
        }
    } else if (!isSlide) {
        if (sweepStartDir === 1 && hand === 'R') {
            deltaCost -= 15;
        } else if (sweepStartDir === -1 && hand === 'L') {
            deltaCost -= 15;
        }

        if (dpState.lastHand === hand && dpState.lastActionTime > -9) {
            const dtPrev = Math.max(0.025, actionTime - dpState.lastActionTime);
            if (dtPrev < 0.28) {
                // 僅在真正高速區間施加同手跳鍵懲罰，避免中慢速 (0.3s+) 硬逼遠手跨區接鍵
                const urgency = (0.28 - dtPrev) / 0.20;
                if (dNorm > 0.05) {
                    const dtEff = Math.max(0.02, dtPrev - 0.04);
                    const vel = dNorm / dtEff;
                    deltaCost += urgency * (135 + 60 * vel);
                } else if (dtPrev >= 0.11) {
                    deltaCost -= 35;
                } else {
                    deltaCost += 45;
                }
            } else if (dtPrev < 0.55 && dNorm <= 0.05) {
                // 中慢速同鍵連打保持同手
                deltaCost -= 35;
            }
        } else if (dpState.lastHand && dpState.lastHand !== hand) {
            deltaCost += 14 * (dNorm / Math.min(0.8, dt));
        }
    }

    // 5. 半場自然偏好 & 6. 強力雙手交叉（反手）避讓（單向刷鍵延續時豁免）
    if (!(isSweepContinuation && dpState.lastHand === hand)) {
        const refX = isSlide ? 0.4 * nx + 0.6 * endX : nx;
        const deadZone = 0.05 * innerCirleBase;
        const halfWeight = isSlide ? 24 : 20;
        if (hand === 'L' && refX > deadZone) {
            deltaCost += halfWeight * (refX / innerCirleBase);
        } else if (hand === 'R' && refX < -deadZone) {
            deltaCost += halfWeight * (-refX / innerCirleBase);
        }

        const otherIdle = actionTime - otherSt.time;
        const otherLocked = otherSt.lockUntil > actionTime + 0.015;
        if (otherLocked || otherIdle < 1.1) {
            const otherEff = getEffectiveHandPos(otherSt, otherHand, actionTime);
            const crossAmount = (x) => {
                if (hand === 'L' && x > otherEff.x + 2) return (x - otherEff.x) / innerCirleBase;
                if (hand === 'R' && x < otherEff.x - 2) return (otherEff.x - x) / innerCirleBase;
                return 0;
            };
            const maxCross = isSlide
                ? Math.max(crossAmount(nx), crossAmount(endX))
                : crossAmount(nx);
            if (maxCross > 0) {
                // 另一隻手鎖定（Hold/Slide）時形成硬反手，施加重罰；一般近期位置交叉亦大幅避讓
                deltaCost += otherLocked
                    ? 140 + 240 * maxCross
                    : 75 + 150 * maxCross;
            }
        }
    }

    const nextL = cloneHandState(dpState.stateL);
    const nextR = cloneHandState(dpState.stateR);
    const targetSt = hand === 'L' ? nextL : nextR;
    targetSt.time = Math.max(targetSt.time, endTime);
    targetSt.lockUntil = Math.max(targetSt.lockUntil, lockUntil);
    targetSt.x = endX;
    targetSt.y = endY;

    return {
        stateL: nextL,
        stateR: nextR,
        lastHand: isSingleHead || isSweepContinuation ? hand : dpState.lastHand,
        lastActionTime: isSingleHead || isSweepContinuation ? actionTime : dpState.lastActionTime,
        lastPosKey: isSingleHead || isSweepContinuation ? posKey : dpState.lastPosKey,
        cost: dpState.cost + deltaCost,
    };
}

/**
 * 自動推算譜面中每顆音符的左右手順 ('L' | 'R' | 'BOTH')
 * 支援凍結唯讀快照（預設不修改傳入之 note 物件），回傳 WeakMap 映射與統計摘要。
 *
 * @param {Array<Object>} notes
 * @param {Object} [options]
 * @param {Map|Object|null} [options.manualOverrides=null]
 * @param {boolean} [options.mutate=false]
 * @returns {{ assignments: WeakMap<Object, Object>, records: Array<Object>, stats: Object }}
 */
export function computeHandAssignments(notes, options = {}) {
    const assignments = new WeakMap();
    const records = [];
    const stats = {
        total: 0,
        left: 0,
        right: 0,
        both: 0,
        manual: 0,
        mines: 0,
        sweeps: 0,
    };

    if (!Array.isArray(notes) || notes.length === 0) {
        return { assignments, records, stats };
    }

    const manualOverrides = options.manualOverrides || null;
    const shouldMutate = Boolean(options.mutate);

    // 1. 建構依實際動作時間排序的動作事件
    const actionItems = [];
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (!n) continue;
        const manualHand = resolveManualHand(n, manualOverrides);
        if (n.type === 'slide') {
            actionItems.push({
                kind: 'slide',
                actionTime: n.time + (n.slideDelay || 0),
                order: 1,
                note: n,
                manualHand,
            });
        } else {
            const pt = getNoteScreenPos(n);
            actionItems.push({
                kind: 'note',
                actionTime: n.time,
                order: 0,
                note: n,
                manualHand,
                nx: pt.x,
                ny: pt.y,
            });
        }
    }

    actionItems.sort((a, b) => a.actionTime - b.actionTime || a.order - b.order);

    // 2. 分組為時間步 timelineSteps
    const timelineSteps = [];
    let idx = 0;
    while (idx < actionItems.length) {
        const stepTime = actionItems[idx].actionTime;
        const headItems = [];
        const slideItems = [];
        let endIdx = idx;
        while (endIdx < actionItems.length && Math.abs(actionItems[endIdx].actionTime - stepTime) < 0.005) {
            const item = actionItems[endIdx];
            if (item.kind === 'slide') {
                slideItems.push(item);
            } else {
                headItems.push(item);
            }
            endIdx++;
        }
        timelineSteps.push({ time: stepTime, headItems, slideItems });
        idx = endIdx;
    }

    // 2.5 預先標記單向圓周刷鍵區段
    markCircularSweepSteps(timelineSteps, manualOverrides);
    for (let i = 0; i < timelineSteps.length; i++) {
        if (timelineSteps[i].isSweepContinuation) {
            stats.sweeps += 1;
        }
    }

    // 3. 執行束搜尋動態規劃 (Beam Search DP, B = 8)
    const BEAM_WIDTH = 8;
    let beam = [{
        stateL: { x: REST_POS.L.x, y: REST_POS.L.y, time: -10, lockUntil: -10 },
        stateR: { x: REST_POS.R.x, y: REST_POS.R.y, time: -10, lockUntil: -10 },
        lastHand: null,
        lastActionTime: -10,
        lastPosKey: null,
        activeChains: [],
        recentStarHeads: [],
        cost: 0,
        prevNode: null,
        stepAssignments: null,
    }];

    for (let sIdx = 0; sIdx < timelineSteps.length; sIdx++) {
        const step = timelineSteps[sIdx];
        const stepTime = step.time;
        const activeHeads = step.headItems.filter((it) => !it.note.isMine || it.manualHand);
        const mineHeads = step.headItems.filter((it) => it.note.isMine && !it.manualHand);

        const nextBeam = [];

        for (const baseState of beam) {
            let headCombinations = [];
            if (activeHeads.length === 0) {
                headCombinations = [{
                    assignments: [],
                    nextState: baseState,
                }];
            } else if (activeHeads.length === 1) {
                const it = activeHeads[0];
                const n = it.note;
                const candidateHands = it.manualHand ? [it.manualHand] : ['L', 'R'];
                const isHold = n.type === 'hold' || (n.type === 'touch' && n.holdDuration);
                const endTime = isHold ? n.time + (n.holdDuration || 0) : n.time;
                const lockUntil = isHold ? endTime : -10;

                for (const h of candidateHands) {
                    if (h === 'BOTH') {
                        headCombinations.push({
                            assignments: [{ note: n, hand: 'BOTH', isManual: Boolean(it.manualHand), nx: it.nx, ny: it.ny }],
                            nextState: baseState,
                        });
                        continue;
                    }
                    const updated = scoreAndApplyAction(baseState, h, it.nx, it.ny, stepTime, {
                        endTime,
                        lockUntil,
                        isSingleHead: true,
                        posKey: getPosKey(n),
                        isSweepContinuation: Boolean(step.isSweepContinuation),
                        sweepStartDir: step.sweepStartDir || 0,
                    });
                    headCombinations.push({
                        assignments: [{ note: n, hand: h, isManual: Boolean(it.manualHand), nx: it.nx, ny: it.ny }],
                        nextState: {
                            ...baseState,
                            ...updated,
                        },
                    });
                }
            } else if (activeHeads.length === 2) {
                const a = activeHeads[0];
                const b = activeHeads[1];
                const pairs = [];
                if (a.manualHand && b.manualHand) {
                    pairs.push([a.manualHand, b.manualHand]);
                } else if (a.manualHand) {
                    pairs.push([a.manualHand, a.manualHand === 'L' ? 'R' : 'L']);
                } else if (b.manualHand) {
                    pairs.push([b.manualHand === 'L' ? 'R' : 'L', b.manualHand]);
                } else {
                    pairs.push(['L', 'R'], ['R', 'L']);
                }

                for (const [hA, hB] of pairs) {
                    const applyOne = (st, item, h) => {
                        if (h === 'BOTH') return st;
                        const isHold = item.note.type === 'hold' || (item.note.type === 'touch' && item.note.holdDuration);
                        const endTime = isHold ? item.note.time + (item.note.holdDuration || 0) : item.note.time;
                        const lockUntil = isHold ? endTime : -10;
                        const u = scoreAndApplyAction(st, h, item.nx, item.ny, stepTime, {
                            endTime,
                            lockUntil,
                            isSingleHead: false,
                        });
                        return { ...st, ...u };
                    };

                    let crossChordPenalty = 0;
                    if (hA === 'L' && hB === 'R' && a.nx > b.nx + 3) {
                        crossChordPenalty = 140 + 260 * ((a.nx - b.nx) / innerCirleBase);
                    } else if (hA === 'R' && hB === 'L' && b.nx > a.nx + 3) {
                        crossChordPenalty = 140 + 260 * ((b.nx - a.nx) / innerCirleBase);
                    }

                    const st1 = applyOne(baseState, a, hA);
                    const st2 = applyOne(st1, b, hB);
                    st2.cost += crossChordPenalty;
                    st2.lastHand = null;

                    headCombinations.push({
                        assignments: [
                            { note: a.note, hand: hA, isManual: Boolean(a.manualHand), nx: a.nx, ny: a.ny },
                            { note: b.note, hand: hB, isManual: Boolean(b.manualHand), nx: b.nx, ny: b.ny },
                        ],
                        nextState: st2,
                    });
                }
            } else {
                // >= 3 押：依半場指派
                let stCur = baseState;
                const assigns = [];
                for (const item of activeHeads) {
                    const h = item.manualHand || (item.nx < 0 ? 'L' : 'R');
                    if (h !== 'BOTH') {
                        const isHold = item.note.type === 'hold' || (item.note.type === 'touch' && item.note.holdDuration);
                        const endTime = isHold ? item.note.time + (item.note.holdDuration || 0) : item.note.time;
                        const lockUntil = isHold ? endTime : -10;
                        const u = scoreAndApplyAction(stCur, h, item.nx, item.ny, stepTime, {
                            endTime,
                            lockUntil,
                            isSingleHead: false,
                        });
                        stCur = { ...stCur, ...u };
                    }
                    assigns.push({ note: item.note, hand: h, isManual: Boolean(item.manualHand), nx: item.nx, ny: item.ny });
                }
                stCur.lastHand = null;
                headCombinations.push({ assignments: assigns, nextState: stCur });
            }

            const mineAssigns = mineHeads.map((it) => ({
                note: it.note,
                hand: it.nx < -1 ? 'L' : 'R',
                isManual: false,
                isMineDefault: true,
            }));

            for (const combo of headCombinations) {
                const nextStarHeads = (baseState.recentStarHeads || []).filter((sh) => sh.time >= stepTime - 2.5);
                for (const a of combo.assignments) {
                    if (a.note.isStar && (a.hand === 'L' || a.hand === 'R')) {
                        nextStarHeads.push({ time: a.note.time, pos: a.note.pos, hand: a.hand });
                    }
                }

                let branchPool = [{
                    state: combo.nextState,
                    chains: (baseState.activeChains || []).filter((c) => c.endTime > stepTime - 0.05),
                    assigns: [...combo.assignments, ...mineAssigns],
                    slideEndHands: [],
                }];

                for (const sItem of step.slideItems) {
                    const s = sItem.note;
                    const sManualHand = sItem.manualHand;
                    const nextPool = [];
                    const startPt =
                        s.path && typeof s.path.getPointAt === 'function'
                            ? s.path.getPointAt(0)
                            : getNoteScreenPos(s.pos);
                    const endPt =
                        s.path && typeof s.path.getPointAt === 'function'
                            ? s.path.getPointAt(1)
                            : getNoteScreenPos(s.slideEnd || s.pos);
                    const sx = startPt ? startPt.x : 0;
                    const sy = startPt ? startPt.y : 0;
                    const ex = endPt ? endPt.x : sx;
                    const ey = endPt ? endPt.y : sy;
                    const slideEnd = s.time + (s.slideDelay || 0) + (s.slideDuration || 0);

                    if (s.isMine && !sManualHand) {
                        for (const p of branchPool) {
                            nextPool.push({
                                ...p,
                                assigns: [...p.assigns, { note: s, hand: sx < -1 ? 'L' : 'R', isManual: false, isMineDefault: true }],
                            });
                        }
                        branchPool = nextPool;
                        continue;
                    }

                    // w slide (WiFi)：預設雙手同時接取並各自沿左右兩翼滑開
                    if (s.slideType === 'w' && !sManualHand) {
                        for (const p of branchPool) {
                            const { wLeftPath, wRightPath } = resolveWifiWingPaths(s, p.state.stateL, p.state.stateR);
                            const wLEnd =
                                wLeftPath && typeof wLeftPath.getPointAt === 'function'
                                    ? wLeftPath.getPointAt(1)
                                    : endPt;
                            const wREnd =
                                wRightPath && typeof wRightPath.getPointAt === 'function'
                                    ? wRightPath.getPointAt(1)
                                    : endPt;

                            let penalty = 0;
                            if (p.state.stateL.lockUntil > stepTime + 0.015) penalty += 10000;
                            if (p.state.stateR.lockUntil > stepTime + 0.015) penalty += 10000;
                            for (const a of combo.assignments) {
                                const d = Math.hypot(a.nx - sx, a.ny - sy);
                                if (d > 0.08 * innerCirleBase) {
                                    penalty += 500;
                                }
                            }

                            const nextL = {
                                x: wLEnd ? wLEnd.x : ex,
                                y: wLEnd ? wLEnd.y : ey,
                                time: Math.max(p.state.stateL.time, slideEnd),
                                lockUntil: Math.max(p.state.stateL.lockUntil, slideEnd),
                            };
                            const nextR = {
                                x: wREnd ? wREnd.x : ex,
                                y: wREnd ? wREnd.y : ey,
                                time: Math.max(p.state.stateR.time, slideEnd),
                                lockUntil: Math.max(p.state.stateR.lockUntil, slideEnd),
                            };

                            nextPool.push({
                                state: {
                                    ...p.state,
                                    stateL: nextL,
                                    stateR: nextR,
                                    lastHand: null,
                                    cost: p.state.cost + penalty,
                                },
                                chains: p.chains,
                                assigns: [
                                    ...p.assigns,
                                    { note: s, hand: 'BOTH', isManual: false, wLeftPath, wRightPath },
                                ],
                                slideEndHands: p.slideEndHands,
                            });
                        }
                        branchPool = nextPool;
                        continue;
                    }

                    const matchingStarHead = nextStarHeads.find(
                        (sh) => sh.pos === s.pos && Math.abs(sh.time - s.time) < 0.005
                    );
                    const starHeadHand = matchingStarHead ? matchingStarHead.hand : null;

                    for (const p of branchPool) {
                        const existingChain = !s.firstSlide
                            ? (
                                p.chains.find(
                                    (c) =>
                                        c.index === s.index &&
                                        Math.abs(c.baseTime - s.time) < 0.002 &&
                                        c.endPos === s.pos &&
                                        Math.abs(c.endTime - stepTime) < 0.01
                                ) ||
                                p.chains.find(
                                    (c) => c.index === s.index && Math.abs(c.baseTime - s.time) < 0.002
                                )
                            )
                            : null;
                        const forcedHand = sManualHand || (existingChain ? existingChain.hand : null);
                        const candHands = forcedHand ? [forcedHand] : ['L', 'R'];

                        let handAtStartPos = null;
                        const usedHandsOtherPos = new Set();
                        for (const a of combo.assignments) {
                            const d = Math.hypot(a.nx - sx, a.ny - sy);
                            if (d <= 0.08 * innerCirleBase) {
                                handAtStartPos = a.hand;
                            } else {
                                usedHandsOtherPos.add(a.hand);
                            }
                        }

                        for (const h of candHands) {
                            const isContinuationFromSameStepHead = handAtStartPos === h;
                            const u = scoreAndApplyAction(p.state, h, sx, sy, stepTime, {
                                endTime: slideEnd,
                                lockUntil: slideEnd,
                                endX: ex,
                                endY: ey,
                                isSingleHead: false,
                                allowLock: !isContinuationFromSameStepHead,
                                isSlide: true,
                                handAtStartPos,
                                usedHandsOtherPos,
                                starHeadHand,
                            });

                            const nextChains = [
                                ...p.chains.filter((c) => c !== existingChain),
                                {
                                    index: s.index,
                                    baseTime: s.time,
                                    endPos: s.slideEnd,
                                    hand: h,
                                    endTime: slideEnd,
                                },
                            ];

                            nextPool.push({
                                state: {
                                    ...p.state,
                                    ...u,
                                },
                                chains: nextChains,
                                assigns: [...p.assigns, { note: s, hand: h, isManual: Boolean(sManualHand) }],
                                slideEndHands: [...p.slideEndHands, { hand: h, ex }],
                            });
                        }
                    }
                    branchPool = nextPool;
                }

                for (const finalBranch of branchPool) {
                    let branchCost = finalBranch.state.cost;
                    if (finalBranch.slideEndHands.length >= 2) {
                        for (let aIdx = 0; aIdx < finalBranch.slideEndHands.length; aIdx++) {
                            for (let bIdx = aIdx + 1; bIdx < finalBranch.slideEndHands.length; bIdx++) {
                                const seA = finalBranch.slideEndHands[aIdx];
                                const seB = finalBranch.slideEndHands[bIdx];
                                if (seA.hand === 'L' && seB.hand === 'R' && seA.ex > seB.ex + 2) {
                                    branchCost += 140 + 240 * ((seA.ex - seB.ex) / innerCirleBase);
                                } else if (seA.hand === 'R' && seB.hand === 'L' && seB.ex > seA.ex + 2) {
                                    branchCost += 140 + 240 * ((seB.ex - seA.ex) / innerCirleBase);
                                }
                            }
                        }
                    }
                    nextBeam.push({
                        ...finalBranch.state,
                        cost: branchCost,
                        activeChains: finalBranch.chains,
                        recentStarHeads: nextStarHeads,
                        prevNode: baseState,
                        stepAssignments: finalBranch.assigns,
                    });
                }
            }
        }

        nextBeam.sort((a, b) => a.cost - b.cost);
        beam = nextBeam.slice(0, BEAM_WIDTH);
    }

    // 4. 回溯最佳路徑並組裝非破壞性映射表
    if (beam.length > 0) {
        const stack = [];
        let cur = beam[0];
        while (cur) {
            if (cur.stepAssignments) {
                stack.push(cur.stepAssignments);
            }
            cur = cur.prevNode;
        }
        for (let s = stack.length - 1; s >= 0; s--) {
            for (const item of stack[s]) {
                const entry = {
                    note: item.note,
                    hand: item.hand,
                    isManual: Boolean(item.isManual),
                    wLeftPath: item.wLeftPath || null,
                    wRightPath: item.wRightPath || null,
                };
                assignments.set(item.note, entry);
                records.push(entry);

                stats.total += 1;
                if (item.isMineDefault) {
                    stats.mines += 1;
                } else {
                    if (item.hand === 'L') stats.left += 1;
                    else if (item.hand === 'R') stats.right += 1;
                    else if (item.hand === 'BOTH') stats.both += 1;
                    if (item.isManual) stats.manual += 1;
                }

                if (shouldMutate && !Object.isFrozen(item.note)) {
                    item.note.hand = item.hand;
                    if (item.wLeftPath) item.note.wLeftPath = item.wLeftPath;
                    if (item.wRightPath) item.note.wRightPath = item.wRightPath;
                }
            }
        }
    }

    return { assignments, records, stats };
}

// ============================================================================
// 3. 虛擬雙手游標時間軸與殘影計算
// ============================================================================

const handTimelineCache = new WeakMap();

function buildHandTimelines(notes, assignmentsMap) {
    const eventsL = [];
    const eventsR = [];

    if (!Array.isArray(notes) || notes.length === 0) {
        return { L: eventsL, R: eventsR };
    }

    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const meta = assignmentsMap ? assignmentsMap.get(n) : null;
        const isManual = Boolean(meta?.isManual || n?.manualHand);
        if (!n || (n.isMine && !isManual)) continue;

        const hand = meta?.hand || n.manualHand || n.hand;
        if (hand !== 'L' && hand !== 'R' && hand !== 'BOTH') continue;

        if (n.type === 'slide') {
            const slideStart = n.time + (n.slideDelay || 0);
            const slideDuration = Math.max(0.001, n.slideDuration || 0);
            const slideEnd = slideStart + slideDuration;

            if (hand === 'BOTH' || (n.slideType === 'w' && !isManual)) {
                const { wLeftPath, wRightPath } =
                    meta?.wLeftPath && meta?.wRightPath
                        ? { wLeftPath: meta.wLeftPath, wRightPath: meta.wRightPath }
                        : n.wLeftPath && n.wRightPath
                            ? { wLeftPath: n.wLeftPath, wRightPath: n.wRightPath }
                            : resolveWifiWingPaths(n, REST_POS.L, REST_POS.R);

                const pushWingEvent = (targetArr, wingPath) => {
                    const usePath = wingPath || n.path || null;
                    const startPt =
                        usePath && typeof usePath.getPointAt === 'function'
                            ? usePath.getPointAt(0)
                            : getNoteScreenPos(n.pos);
                    const endPt =
                        usePath && typeof usePath.getPointAt === 'function'
                            ? usePath.getPointAt(1)
                            : getNoteScreenPos(n.slideEnd || n.pos);
                    targetArr.push({
                        type: 'slide',
                        startTime: slideStart,
                        endTime: slideEnd,
                        startX: startPt ? startPt.x : 0,
                        startY: startPt ? startPt.y : 0,
                        endX: endPt ? endPt.x : 0,
                        endY: endPt ? endPt.y : 0,
                        path: usePath,
                    });
                };

                pushWingEvent(eventsL, wLeftPath);
                pushWingEvent(eventsR, wRightPath);
                continue;
            }

            const targetArr = hand === 'L' ? eventsL : eventsR;
            const startPt =
                n.path && typeof n.path.getPointAt === 'function'
                    ? n.path.getPointAt(0)
                    : getNoteScreenPos(n.pos);
            const endPt =
                n.path && typeof n.path.getPointAt === 'function'
                    ? n.path.getPointAt(1)
                    : getNoteScreenPos(n.slideEnd || n.pos);

            targetArr.push({
                type: 'slide',
                startTime: slideStart,
                endTime: slideEnd,
                startX: startPt ? startPt.x : 0,
                startY: startPt ? startPt.y : 0,
                endX: endPt ? endPt.x : 0,
                endY: endPt ? endPt.y : 0,
                path: n.path || null,
            });
        } else if (n.type === 'hold' || (n.type === 'touch' && n.holdDuration)) {
            if (hand !== 'L' && hand !== 'R') continue;
            const targetArr = hand === 'L' ? eventsL : eventsR;
            const pt = getNoteScreenPos(n);
            const dur = Math.max(0.04, n.holdDuration || 0);
            targetArr.push({
                type: n.type === 'touch' ? 'touchhold' : 'hold',
                startTime: n.time,
                endTime: n.time + dur,
                startX: pt.x,
                startY: pt.y,
                endX: pt.x,
                endY: pt.y,
                path: null,
            });
        } else {
            if (hand !== 'L' && hand !== 'R') continue;
            const targetArr = hand === 'L' ? eventsL : eventsR;
            const pt = getNoteScreenPos(n);
            targetArr.push({
                type: n.type === 'touch' ? 'touch' : 'tap',
                startTime: n.time,
                endTime: n.time + 0.055,
                startX: pt.x,
                startY: pt.y,
                endX: pt.x,
                endY: pt.y,
                path: null,
            });
        }
    }

    const sortAndClean = (list) => {
        list.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
        for (let i = 0; i < list.length - 1; i++) {
            const cur = list[i];
            const next = list[i + 1];
            if ((cur.type === 'tap' || cur.type === 'touch') && cur.endTime > next.startTime) {
                cur.endTime = next.startTime;
            }
        }
        return list;
    };

    return {
        L: sortAndClean(eventsL),
        R: sortAndClean(eventsR),
    };
}

function findEventIndexAtTime(events, t) {
    let lo = 0;
    let hi = events.length - 1;
    let ans = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].startTime <= t) {
            ans = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return ans;
}

function evaluateSingleHandPosition(events, hand, t, scaleFactor) {
    const restX = REST_POS[hand].x * scaleFactor;
    const restY = REST_POS[hand].y * scaleFactor;

    if (!events || events.length === 0) {
        return {
            x: restX,
            y: restY,
            state: 'idle',
            alpha: 0.3,
            holdProgress: 0,
            nextTarget: null,
        };
    }

    const idx = findEventIndexAtTime(events, t);

    if (idx >= 0) {
        const ev = events[idx];
        if (t <= ev.endTime) {
            if (ev.type === 'slide' && ev.path) {
                const dur = Math.max(0.001, ev.endTime - ev.startTime);
                const p = clampVal((t - ev.startTime) / dur, 0, 1);
                const pt = ev.path.getPointAt(p);
                return {
                    x: (pt ? pt.x : ev.startX) * scaleFactor,
                    y: (pt ? pt.y : ev.startY) * scaleFactor,
                    state: 'sliding',
                    alpha: 0.96,
                    holdProgress: p,
                    nextTarget: {
                        x: ev.endX * scaleFactor,
                        y: ev.endY * scaleFactor,
                        timeDiff: Math.max(0, ev.endTime - t),
                    },
                };
            }
            if (ev.type === 'hold' || ev.type === 'touchhold') {
                const dur = Math.max(0.001, ev.endTime - ev.startTime);
                const p = clampVal((t - ev.startTime) / dur, 0, 1);
                return {
                    x: ev.startX * scaleFactor,
                    y: ev.startY * scaleFactor,
                    state: 'holding',
                    alpha: 0.96,
                    holdProgress: p,
                    nextTarget: null,
                };
            }
            return {
                x: ev.startX * scaleFactor,
                y: ev.startY * scaleFactor,
                state: 'tapping',
                alpha: 1.0,
                holdProgress: 0,
                nextTarget: null,
            };
        }
    }

    const prevEv = idx >= 0 ? events[idx] : null;
    const nextEv = idx + 1 < events.length ? events[idx + 1] : null;

    if (!prevEv && nextEv) {
        const timeToNext = nextEv.startTime - t;
        const moveWindow = 0.6;
        if (timeToNext > moveWindow) {
            return {
                x: restX,
                y: restY,
                state: 'idle',
                alpha: 0.35,
                holdProgress: 0,
                nextTarget:
                    timeToNext <= 0.9
                        ? {
                              x: nextEv.startX * scaleFactor,
                              y: nextEv.startY * scaleFactor,
                              timeDiff: timeToNext,
                          }
                        : null,
            };
        }
        const p = easeInOutCubic(1 - timeToNext / moveWindow);
        const nx = nextEv.startX * scaleFactor;
        const ny = nextEv.startY * scaleFactor;
        return {
            x: restX + (nx - restX) * p,
            y: restY + (ny - restY) * p,
            state: 'moving',
            alpha: 0.72 + 0.22 * p,
            holdProgress: 0,
            nextTarget: { x: nx, y: ny, timeDiff: timeToNext },
        };
    }

    if (prevEv && !nextEv) {
        const elapsed = t - prevEv.endTime;
        const px = prevEv.endX * scaleFactor;
        const py = prevEv.endY * scaleFactor;
        if (elapsed > 0.8) {
            const p = easeInOutCubic(Math.min(1, (elapsed - 0.8) / 0.6));
            return {
                x: px + (restX - px) * p,
                y: py + (restY - py) * p,
                state: 'idle',
                alpha: Math.max(0.3, 0.7 - 0.4 * p),
                holdProgress: 0,
                nextTarget: null,
            };
        }
        return {
            x: px,
            y: py,
            state: 'idle',
            alpha: Math.max(0.5, 0.85 - elapsed * 0.4),
            holdProgress: 0,
            nextTarget: null,
        };
    }

    if (prevEv && nextEv) {
        const px = prevEv.endX * scaleFactor;
        const py = prevEv.endY * scaleFactor;
        const nx = nextEv.startX * scaleFactor;
        const ny = nextEv.startY * scaleFactor;
        const gap = Math.max(0.001, nextEv.startTime - prevEv.endTime);
        const timeToNext = nextEv.startTime - t;

        if (gap <= 0.75) {
            const p = easeInOutCubic((t - prevEv.endTime) / gap);
            return {
                x: px + (nx - px) * p,
                y: py + (ny - py) * p,
                state: 'moving',
                alpha: 0.88,
                holdProgress: 0,
                nextTarget: { x: nx, y: ny, timeDiff: timeToNext },
            };
        }

        const moveWindow = 0.6;
        if (timeToNext > moveWindow) {
            return {
                x: px,
                y: py,
                state: 'idle',
                alpha: Math.max(0.42, 0.75 - (t - prevEv.endTime) * 0.25),
                holdProgress: 0,
                nextTarget: timeToNext <= 0.9 ? { x: nx, y: ny, timeDiff: timeToNext } : null,
            };
        }

        const p = easeInOutCubic(1 - timeToNext / moveWindow);
        return {
            x: px + (nx - px) * p,
            y: py + (ny - py) * p,
            state: 'moving',
            alpha: 0.75 + 0.18 * p,
            holdProgress: 0,
            nextTarget: { x: nx, y: ny, timeDiff: timeToNext },
        };
    }

    return {
        x: restX,
        y: restY,
        state: 'idle',
        alpha: 0.3,
        holdProgress: 0,
        nextTarget: null,
    };
}

/**
 * 取得指定時間點左右手的即時虛擬游標座標、狀態、下一目標提示與移動殘影軌跡
 * @param {Array<Object>} notes
 * @param {number} globalTime
 * @param {number} [targetScaleBase=scaleBase]
 * @param {WeakMap|null} [assignmentsMap=null]
 * @returns {{ L: Object, R: Object }}
 */
export function getHandCursorStates(notes, globalTime, targetScaleBase = scaleBase, assignmentsMap = null) {
    let cached = notes ? handTimelineCache.get(notes) : null;
    if ((!cached || cached.assignmentsMap !== assignmentsMap) && Array.isArray(notes)) {
        cached = {
            assignmentsMap,
            timelines: buildHandTimelines(notes, assignmentsMap),
        };
        handTimelineCache.set(notes, cached);
    }

    const eventsL = cached ? cached.timelines.L : [];
    const eventsR = cached ? cached.timelines.R : [];
    const scaleFactor = targetScaleBase / scaleBase;

    const evalWithTrail = (events, hand) => {
        const cur = evaluateSingleHandPosition(events, hand, globalTime, scaleFactor);
        const trailPoints = [{ x: cur.x, y: cur.y }];
        if (cur.state !== 'idle' || (cur.nextTarget && cur.nextTarget.timeDiff <= 0.6)) {
            for (let k = 1; k <= 7; k++) {
                const sampleT = globalTime - k * 0.018;
                const pt = evaluateSingleHandPosition(events, hand, sampleT, scaleFactor);
                trailPoints.push({ x: pt.x, y: pt.y });
            }
        }
        cur.trailPoints = trailPoints;
        return cur;
    };

    return {
        L: evalWithTrail(eventsL, 'L'),
        R: evalWithTrail(eventsR, 'R'),
    };
}

// ============================================================================
// 4. 高效時間視窗索引（確保疊加圖層耗時遠低於 12ms 預算）
// ============================================================================

const chartAnalysisCache = new WeakMap();

function lowerBound(arr, target) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function upperBound(arr, target) {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (arr[mid] <= target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function buildPreparedChartData(notes) {
    const analysis = computeHandAssignments(notes);
    const len = notes ? notes.length : 0;
    let isSorted = true;
    let maxSpan = 0;

    for (let i = 0; i < len; i++) {
        const n = notes[i];
        if (!n) continue;
        if (i > 0 && n.time < notes[i - 1].time) isSorted = false;
        const span =
            (n.holdDuration || 0) +
            (n.slideDelay || 0) +
            (n.slideDuration || 0) +
            (n.isMine ? n.cullSkipExtend || 0 : 0);
        if (span > maxSpan) maxSpan = span;
    }

    let orderedNotes = notes || [];
    if (!isSorted && len > 0) {
        orderedNotes = [...notes].sort((a, b) => (a?.time || 0) - (b?.time || 0));
    }

    const times = new Float64Array(orderedNotes.length);
    for (let i = 0; i < orderedNotes.length; i++) {
        times[i] = orderedNotes[i]?.time || 0;
    }

    return {
        ...analysis,
        orderedNotes,
        times,
        maxSpan,
    };
}

function getPreparedChartData(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
        return null;
    }
    let cached = chartAnalysisCache.get(notes);
    if (!cached) {
        cached = buildPreparedChartData(notes);
        chartAnalysisCache.set(notes, cached);
    }
    return cached;
}

function forEachVisibleNote(prepared, minTime, maxTime, callback) {
    const { orderedNotes, times, maxSpan } = prepared;
    const lo = lowerBound(times, minTime - maxSpan);
    const hi = upperBound(times, maxTime);
    for (let i = lo; i < hi; i++) {
        callback(orderedNotes[i]);
    }
}

// ============================================================================
// 5. Canvas 繪圖輔助函式
// ============================================================================

function drawHandNoteBadge(ctx, x, y, hand, radius = 2.0, isManual = false, alpha = 1) {
    const theme = HAND_COLORS[hand];
    if (!theme) return;
    ctx.save();
    ctx.globalAlpha = clampVal(alpha, 0, 1);
    if (hand === 'BOTH') {
        ctx.beginPath();
        ctx.arc(x, y, radius, Math.PI * 0.5, Math.PI * 1.5);
        ctx.closePath();
        ctx.fillStyle = HAND_COLORS.L.badgeFill;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, radius, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.closePath();
        ctx.fillStyle = HAND_COLORS.R.badgeFill;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
    } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = theme.badgeFill;
        ctx.fill();
    }
    ctx.lineWidth = isManual ? 0.55 : 0.35;
    ctx.strokeStyle = isManual ? '#fde047' : 'rgba(255, 255, 255, 0.92)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    const label = hand === 'BOTH' ? 'LR' : hand;
    ctx.font = `900 ${radius * (hand === 'BOTH' ? 1.05 : 1.35)}px "Plus Jakarta Sans", "Noto Sans TC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + radius * 0.06);
    ctx.restore();
}

function drawHandNoteHalo(ctx, x, y, hand, radius, alpha = 0.78) {
    const theme = HAND_COLORS[hand];
    if (!theme || radius <= 0) return;
    ctx.save();
    ctx.globalAlpha = clampVal(alpha, 0, 1);
    ctx.strokeStyle = theme.main;
    ctx.lineWidth = Math.max(0.6, radius * 0.22);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function drawHandCursors(ctx, notes, globalTime, assignmentsMap, cursorScale = 1, opacity = 1) {
    if (!notes || notes.length === 0) return;
    const handStates = getHandCursorStates(notes, globalTime, scaleBase, assignmentsMap);
    const baseOpacity = clampVal(opacity, 0.1, 1);

    for (const hand of ['L', 'R']) {
        const st = handStates[hand];
        const theme = HAND_COLORS[hand];
        if (!st || !theme) continue;

        ctx.save();

        // 1. 下一個目標預備導引虛線
        if (st.nextTarget && st.nextTarget.timeDiff > 0.01) {
            const guideAlpha =
                Math.max(0.12, Math.min(0.42, (0.75 - st.nextTarget.timeDiff) * 0.7)) *
                st.alpha *
                baseOpacity;
            ctx.save();
            ctx.globalAlpha = guideAlpha;
            ctx.strokeStyle = theme.main;
            ctx.lineWidth = 0.55 * cursorScale;
            ctx.setLineDash([1.6, 1.4]);
            ctx.beginPath();
            ctx.moveTo(st.x, st.y);
            ctx.lineTo(st.nextTarget.x, st.nextTarget.y);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(st.nextTarget.x, st.nextTarget.y, 1.8 * cursorScale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // 2. 漸層移動拖尾軌跡 (Motion Trail)
        if (st.trailPoints && st.trailPoints.length > 1) {
            for (let i = 0; i < st.trailPoints.length - 1; i++) {
                const p0 = st.trailPoints[i];
                const p1 = st.trailPoints[i + 1];
                const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                if (dist < 0.05) continue;
                const fade = 1 - i / st.trailPoints.length;
                ctx.save();
                ctx.globalAlpha = st.alpha * fade * 0.55 * baseOpacity;
                ctx.strokeStyle = theme.main;
                ctx.lineCap = 'round';
                ctx.lineWidth = Math.max(0.5, 2.2 * fade * cursorScale);
                ctx.beginPath();
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
                ctx.stroke();
                ctx.restore();
            }
        }

        // 3. 虛擬手部游標本體與按壓狀態動畫
        const isPressed = st.state === 'tapping' || st.state === 'holding' || st.state === 'sliding';
        const radius = (st.state === 'tapping' ? 3.2 : isPressed ? 3.55 : 3.4) * cursorScale;

        if (isPressed) {
            ctx.save();
            ctx.globalAlpha = st.alpha * 0.45 * baseOpacity;
            ctx.strokeStyle = theme.main;
            ctx.lineWidth = 0.9 * cursorScale;
            ctx.beginPath();
            ctx.arc(st.x, st.y, radius + 1.4 * cursorScale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalAlpha = st.alpha * baseOpacity;
        ctx.beginPath();
        ctx.arc(st.x, st.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = isPressed ? theme.badgeFill : 'rgba(15, 23, 42, 0.72)';
        ctx.fill();

        ctx.lineWidth = 0.75 * cursorScale;
        ctx.strokeStyle = theme.main;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${radius * 1.15}px "Plus Jakarta Sans", "Noto Sans TC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(hand, st.x, st.y + radius * 0.05);

        ctx.restore();
    }
}

// ============================================================================
// 6. 擴充程式設定結構與多語系字典
// ============================================================================

const SETTINGS_SCHEMA = [
    {
        key: 'showHandCursor',
        type: 'boolean',
        default: true,
        label: '顯示虛擬雙手游標與軌跡',
        labelKey: `ext.${EXTENSION_ID}.optShowHandCursor`,
    },
    {
        key: 'showHandNoteBadge',
        type: 'boolean',
        default: true,
        label: '主圓盤顯示 L / R 手順角標',
        labelKey: `ext.${EXTENSION_ID}.optShowHandNoteBadge`,
    },
    {
        key: 'showHandNoteHalo',
        type: 'boolean',
        default: false,
        label: '主圓盤顯示手順色環提示',
        labelKey: `ext.${EXTENSION_ID}.optShowHandNoteHalo`,
    },
    {
        key: 'showVisualHandHint',
        type: 'boolean',
        default: true,
        label: '視覺化編輯器顯示 L / R 手順標記',
        labelKey: `ext.${EXTENSION_ID}.optShowVisualHandHint`,
    },
    {
        key: 'cursorScale',
        type: 'number',
        default: 1.0,
        min: 0.6,
        max: 2.0,
        step: 0.1,
        label: '游標縮放倍率',
        labelKey: `ext.${EXTENSION_ID}.optCursorScale`,
    },
    {
        key: 'badgeOpacity',
        type: 'number',
        default: 0.92,
        min: 0.2,
        max: 1.0,
        step: 0.05,
        label: '手順提示不透明度',
        labelKey: `ext.${EXTENSION_ID}.optBadgeOpacity`,
    },
    {
        key: 'includeInVideo',
        type: 'boolean',
        default: false,
        label: '匯出影片時包含手順疊加圖層',
        labelKey: `ext.${EXTENSION_ID}.optIncludeInVideo`,
    },
];

const TRANSLATIONS = {
    'zh-TW': {
        menuSettings: '手順解析引擎設定',
        menuToggleCursor: '切換虛擬雙手游標',
        menuShowStats: '檢視目前譜面手順統計',
        popoverTitle: '手順解析引擎設定',
        optShowHandCursor: '顯示虛擬雙手游標與軌跡',
        optShowHandNoteBadge: '主圓盤顯示 L / R 手順角標',
        optShowHandNoteHalo: '主圓盤顯示手順色環提示',
        optShowVisualHandHint: '視覺化編輯器顯示 L / R 手順標記',
        optCursorScale: '游標縮放倍率',
        optBadgeOpacity: '手順提示不透明度',
        optIncludeInVideo: '匯出影片時包含手順疊加圖層',
        toastCursorOn: '已開啟虛擬雙手游標',
        toastCursorOff: '已關閉虛擬雙手游標',
        toastBadgesOn: '已開啟手順角標',
        toastBadgesOff: '已關閉手順角標',
        toastNoChart: '目前沒有已解析的音符可供分析',
        toastStats: '手順統計（共 {total} 音符）：L {left} / R {right} / 雙手 {both}（L 佔 {ratio}%）',
    },
    'zh-CN': {
        menuSettings: '手序解析引擎设置',
        menuToggleCursor: '切换虚拟双手游标',
        menuShowStats: '查看当前谱面手序统计',
        popoverTitle: '手序解析引擎设置',
        optShowHandCursor: '显示虚拟双手游标与轨迹',
        optShowHandNoteBadge: '主圆盘显示 L / R 手序角标',
        optShowHandNoteHalo: '主圆盘显示手序色环提示',
        optShowVisualHandHint: '可视化编辑器显示 L / R 手序标记',
        optCursorScale: '游标缩放倍率',
        optBadgeOpacity: '手序提示不透明度',
        optIncludeInVideo: '导出视频时包含手序叠加图层',
        toastCursorOn: '已开启虚拟双手游标',
        toastCursorOff: '已关闭虚拟双手游标',
        toastBadgesOn: '已开启手序角标',
        toastBadgesOff: '已关闭手序角标',
        toastNoChart: '当前没有已解析的音符可供分析',
        toastStats: '手序统计（共 {total} 音符）：L {left} / R {right} / 双手 {both}（L 占 {ratio}%）',
    },
    en: {
        menuSettings: 'Hand Hint Engine Settings',
        menuToggleCursor: 'Toggle Virtual Hand Cursors',
        menuShowStats: 'Show Chart Hand Analysis Stats',
        popoverTitle: 'Hand Hint Engine Settings',
        optShowHandCursor: 'Show Virtual Dual-Hand Cursors & Trails',
        optShowHandNoteBadge: 'Show L / R Badges on Main Disc',
        optShowHandNoteHalo: 'Show Hand Color Halos on Notes',
        optShowVisualHandHint: 'Show L / R Hints in Visual Editor',
        optCursorScale: 'Cursor Scale',
        optBadgeOpacity: 'Hint Opacity',
        optIncludeInVideo: 'Include Overlay in Video Export',
        toastCursorOn: 'Virtual hand cursors enabled',
        toastCursorOff: 'Virtual hand cursors disabled',
        toastBadgesOn: 'Note hand badges enabled',
        toastBadgesOff: 'Note hand badges disabled',
        toastNoChart: 'No decoded notes available for hand analysis',
        toastStats: 'Hand Stats ({total} notes): L {left} / R {right} / BOTH {both} (L {ratio}%)',
    },
    ja: {
        menuSettings: '手順解析エンジン設定',
        menuToggleCursor: '仮想両手カーソル切替',
        menuShowStats: '譜面手順統計を表示',
        popoverTitle: '手順解析エンジン設定',
        optShowHandCursor: '仮想両手カーソルと軌跡を表示',
        optShowHandNoteBadge: 'メイン円盤に L / R バッジを表示',
        optShowHandNoteHalo: 'ノーツに手順カラーリングを表示',
        optShowVisualHandHint: 'ビジュアルエディタに L / R を表示',
        optCursorScale: 'カーソル拡大率',
        optBadgeOpacity: 'ヒント不透明度',
        optIncludeInVideo: '動画書き出しにオーバーレイを含める',
        toastCursorOn: '仮想両手カーソルを有効にしました',
        toastCursorOff: '仮想両手カーソルを無効にしました',
        toastBadgesOn: '手順バッジを有効にしました',
        toastBadgesOff: '手順バッジを無効にしました',
        toastNoChart: '解析可能なノーツがありません',
        toastStats: '手順統計（全 {total} ノーツ）：L {left} / R {right} / 両手 {both}（L {ratio}%）',
    },
    ko: {
        menuSettings: '손배치 분석 엔진 설정',
        menuToggleCursor: '가상 양손 커서 전환',
        menuShowStats: '채보 손배치 통계 보기',
        popoverTitle: '손배치 분석 엔진 설정',
        optShowHandCursor: '가상 양손 커서 및 궤적 표시',
        optShowHandNoteBadge: '메인 원판 L / R 배지 표시',
        optShowHandNoteHalo: '노트 손배치 색상 링 표시',
        optShowVisualHandHint: '비주얼 에디터 L / R 힌트 표시',
        optCursorScale: '커서 배율',
        optBadgeOpacity: '힌트 불투명도',
        optIncludeInVideo: '영상 내보내기에 오버레이 포함',
        toastCursorOn: '가상 양손 커서를 켰습니다',
        toastCursorOff: '가상 양손 커서를 껐습니다',
        toastBadgesOn: '손배치 배지를 켰습니다',
        toastBadgesOff: '손배치 배지를 껐습니다',
        toastNoChart: '분석할 노트가 없습니다',
        toastStats: '손배치 통계 (총 {total}개): L {left} / R {right} / 양손 {both} (L {ratio}%)',
    },
};

// ============================================================================
// 7. 擴充進入點與生命週期整合 (activate)
// ============================================================================

const EXT_SETTINGS_STORAGE_KEY = 'ext_settings_v1';

export function activate(ctx) {
    if (ctx.i18n) {
        ctx.i18n.registerTranslations(TRANSLATIONS);
    }

    const tr = (key, params = {}) => {
        if (ctx.i18n && typeof ctx.i18n.t === 'function') {
            const val = ctx.i18n.t(key, params);
            if (val && !val.startsWith(`ext.${ctx.extensionId}.`)) {
                return val;
            }
        }
        let raw = TRANSLATIONS['zh-TW'][key] || key;
        for (const [k, v] of Object.entries(params)) {
            raw = raw.replaceAll(`{${k}}`, String(v));
        }
        return raw;
    };

    // 讀取並合併設定（支援 Popover 持久化與 ctx.storage 同步）
    const loadExtSettings = () => {
        const fromPopover = ctx.ui && typeof ctx.ui.getSettings === 'function'
            ? ctx.ui.getSettings(SETTINGS_SCHEMA)
            : {};
        const fromStorage = ctx.storage ? ctx.storage.get(EXT_SETTINGS_STORAGE_KEY, null) : null;
        const merged = { ...fromPopover };
        if (fromStorage && typeof fromStorage === 'object') {
            for (const field of SETTINGS_SCHEMA) {
                if (fromPopover[field.key] === field.default && fromStorage[field.key] !== undefined) {
                    merged[field.key] = fromStorage[field.key];
                }
            }
        }
        return merged;
    };

    let extSettings = loadExtSettings();

    // 快取應用程式原生渲染設定（避免每幀呼叫 ctx.settings.getAll() 深層複製）
    const appSettingsCache = {
        speed: 6.5,
        touchSpeed: 7,
        noteBaseSize: 11,
        middleDistance: 0.25,
        visualLayerMode: 'note',
    };

    const refreshAppSettingsCache = () => {
        if (!ctx.settings) return;
        appSettingsCache.speed = Number(ctx.settings.get('speed', 6.5)) || 6.5;
        appSettingsCache.touchSpeed = Number(ctx.settings.get('touchSpeed', 7)) || 7;
        appSettingsCache.noteBaseSize = Number(ctx.settings.get('noteBaseSize', 11)) || 11;
        appSettingsCache.middleDistance = Number(ctx.settings.get('middleDistance', 0.25));
        if (!Number.isFinite(appSettingsCache.middleDistance)) appSettingsCache.middleDistance = 0.25;
        appSettingsCache.visualLayerMode = String(ctx.settings.get('visualLayerMode', 'note') || 'note');
    };
    refreshAppSettingsCache();

    // 預先分析當前譜面（若已載入）
    const warmUpAnalysis = () => {
        if (!ctx.chart) return null;
        const snap = ctx.chart.getSnapshot();
        if (!snap || !Array.isArray(snap.notes) || snap.notes.length === 0) return null;
        return getPreparedChartData(snap.notes);
    };

    // 主圓盤疊加繪圖邏輯
    const drawMainOverlay = (rc) => {
        if (rc.isRenderingVideo && !extSettings.includeInVideo) return;
        if (!extSettings.showHandCursor && !extSettings.showHandNoteBadge && !extSettings.showHandNoteHalo) return;

        const snap = ctx.chart ? ctx.chart.getSnapshot() : null;
        const notes = snap?.notes;
        if (!Array.isArray(notes) || notes.length === 0) return;

        const prepared = getPreparedChartData(notes);
        if (!prepared) return;

        const c2d = rc.ctx;
        const globalTime = rc.globalTime;
        const opacity = clampVal(Number(extSettings.badgeOpacity) || 0.92, 0.1, 1);

        // 確保套用與主渲染器完全一致的 scaleBase = 100 置中座標系
        if (rc.unitPx > 0) {
            c2d.setTransform(rc.unitPx, 0, 0, rc.unitPx, rc.width * 0.5, rc.height * 0.5);
        }

        // 1. 音符手順角標與色環提示
        if (extSettings.showHandNoteBadge || extSettings.showHandNoteHalo) {
            const md = appSettingsCache.middleDistance;
            const baseSize = appSettingsCache.noteBaseSize;
            const speedFactor = calcPiecewiseSpeed(appSettingsCache.speed);
            const touchSpeedFactor = calcPiecewiseSpeed(appSettingsCache.touchSpeed);

            // 依速度推算合理的可見視窗時間（避免低速或變速漏掉，同時保持極高二分搜尋效能）
            const minBaseSpeed = Math.max(0.25, Math.min(Math.abs(speedFactor), Math.abs(touchSpeedFactor)));
            const lookAhead = Math.min(8.0, Math.max(1.8, 3.2 / minBaseSpeed));

            forEachVisibleNote(prepared, globalTime - 0.3, globalTime + lookAhead, (s) => {
                const entry = prepared.assignments.get(s);
                if (!entry) return;
                const hand = entry.hand;
                if (s.isMine && !entry.isManual) return;
                if (hand !== 'L' && hand !== 'R' && hand !== 'BOTH') return;

                const noteT = s.time - globalTime;

                if (s.type === 'slide') {
                    const slideDelay = s.slideDelay || 0;
                    const slideDuration = Math.max(0.001, s.slideDuration || 0);
                    let displaySlideProgress = 0;
                    if (-noteT > slideDelay) {
                        displaySlideProgress = (-noteT - slideDelay) / slideDuration;
                    }
                    // Slide 抵達終點 (progress >= 1) 後立即停止繪製，避免角標在尾端殘留
                    if (displaySlideProgress >= 1) return;

                    const sz = slideDelay < 1e-4 ? 1 : Math.min(1, 1 - (noteT + slideDelay) / slideDelay);
                    if (noteT <= 0 && sz > 0.01 && (!s.hideHead || sz >= 1)) {
                        const p = s.path;
                        if (!p || typeof p.getPointAt !== 'function') return;
                        const prog = Math.min(1, Math.max(0, displaySlideProgress));
                        const pt = p.getPointAt(prog);
                        const starAlpha = (slideDelay < 1e-4 ? 1 : sz) * opacity;
                        const starSize = baseSize * sz * 1.45;

                        if (s.slideType === 'w' && hand === 'BOTH' && s.wPaths?.w1 && s.wPaths?.w2) {
                            const w1Pt = s.wPaths.w1.getPointAt(prog);
                            const w2Pt = s.wPaths.w2.getPointAt(prog);
                            const isW1Left = (entry.wLeftPath && entry.wLeftPath === s.wPaths.w1) || (!entry.wLeftPath && w1Pt.x <= w2Pt.x);
                            const w1Hand = isW1Left ? 'L' : 'R';
                            const w2Hand = isW1Left ? 'R' : 'L';
                            if (extSettings.showHandNoteHalo) {
                                drawHandNoteHalo(c2d, w1Pt.x, w1Pt.y, w1Hand, starSize * 0.44, starAlpha * 0.85);
                                drawHandNoteHalo(c2d, w2Pt.x, w2Pt.y, w2Hand, starSize * 0.44, starAlpha * 0.85);
                            }
                            if (extSettings.showHandNoteBadge) {
                                drawHandNoteBadge(c2d, w1Pt.x, w1Pt.y, w1Hand, starSize * 0.16, false, starAlpha);
                                drawHandNoteBadge(c2d, w2Pt.x, w2Pt.y, w2Hand, starSize * 0.16, false, starAlpha);
                                drawHandNoteBadge(c2d, pt.x, pt.y, 'BOTH', starSize * 0.17, entry.isManual, starAlpha);
                            }
                        } else {
                            if (extSettings.showHandNoteHalo) {
                                drawHandNoteHalo(c2d, pt.x, pt.y, hand, starSize * 0.44, starAlpha * 0.85);
                            }
                            if (extSettings.showHandNoteBadge) {
                                drawHandNoteBadge(c2d, pt.x, pt.y, hand, starSize * 0.16, entry.isManual, starAlpha);
                            }
                        }
                    }
                    return;
                }

                if (s.type === 'touch') {
                    const holdDur = s.holdDuration || 0;
                    if (holdDur > 0 ? -noteT > holdDur : noteT <= 0) return;
                    const t = 1 - timeFunction(noteT * touchSpeedFactor * (s.hispeed || 1));
                    if (t <= -0.9) return;
                    const posGroup = touchRefPos[s.touchPos];
                    const posInfo = posGroup ? posGroup[s.touchPos === 'C' ? 0 : (s.pos || 1) - 1] : null;
                    if (!posInfo) return;
                    const size = baseSize * 0.7;
                    const touchAlpha = Math.max(0, 1 - (1 - Math.min(1, t)) * 0.5) * opacity;

                    if (extSettings.showHandNoteHalo) {
                        drawHandNoteHalo(c2d, posInfo.x, posInfo.y, hand, size * 0.9, touchAlpha * 0.82);
                    }
                    if (extSettings.showHandNoteBadge) {
                        drawHandNoteBadge(c2d, posInfo.x, posInfo.y, hand, size * 0.25, entry.isManual, touchAlpha);
                    }
                    return;
                }

                // 外圈 Tap / Star / Hold
                const isHold = s.type === 'hold';
                if (isHold) {
                    if (-noteT > (s.holdDuration || 0)) return;
                } else if (noteT <= 0) {
                    return;
                }

                const posInfo = noteRefPos[(s.pos || 1) - 1];
                if (!posInfo) return;

                const sp = (s.hispeed === 1 || !s.hispeed) ? speedFactor : calcPiecewiseSpeed(appSettingsCache.speed * s.hispeed);
                const t = 1 - timeFunction(noteT * sp);
                const displayT = isHold ? Math.min(1, Math.max(md, t)) : Math.max(md, t);
                if (displayT <= md) return;

                const currentScale = t < md ? Math.max(0, (t + 0.9) / (0.9 + md)) : 1;
                const size = baseSize * currentScale;
                const nx = posInfo.x * displayT;
                const ny = posInfo.y * displayT;

                if (extSettings.showHandNoteHalo) {
                    drawHandNoteHalo(c2d, nx, ny, hand, size * 0.48, currentScale * opacity * 0.88);
                }
                if (extSettings.showHandNoteBadge) {
                    drawHandNoteBadge(c2d, nx, ny, hand, size * 0.2, entry.isManual, currentScale * opacity);
                }
            });
        }

        // 2. 虛擬雙手游標與移動軌跡
        if (extSettings.showHandCursor) {
            const cursorScale = clampVal(Number(extSettings.cursorScale) || 1.0, 0.5, 2.5);
            drawHandCursors(c2d, notes, globalTime, prepared.assignments, cursorScale, opacity);
        }
    };

    // 視覺化編輯器疊加繪圖邏輯
    const drawVisualOverlay = (rc) => {
        if (!extSettings.showVisualHandHint) return;
        if (appSettingsCache.visualLayerMode !== 'note') return;

        const snap = ctx.chart ? ctx.chart.getSnapshot() : null;
        const notes = snap?.notes;
        if (!Array.isArray(notes) || notes.length === 0) return;

        const prepared = getPreparedChartData(notes);
        if (!prepared) return;

        const c2d = rc.ctx;
        const zoom = rc.scale || 200;
        const p = Math.min(rc.width, rc.height) / (rc.scaleBase || scaleBase);
        const halfH = p > 0 ? (rc.height * 0.5) / p : 50;
        const size = appSettingsCache.noteBaseSize;
        const marginSec = (size * 2) / Math.max(1, zoom);
        const halfSec = halfH / Math.max(1, zoom) + marginSec;
        const opacity = clampVal(Number(extSettings.badgeOpacity) || 0.92, 0.1, 1);

        forEachVisibleNote(prepared, rc.globalTime - halfSec, rc.globalTime + halfSec, (n) => {
            const entry = prepared.assignments.get(n);
            if (!entry) return;
            if (n.isMine && !entry.isManual) return;
            const hand = entry.hand;
            if (hand !== 'L' && hand !== 'R' && hand !== 'BOTH') return;

            const isTouch = n.type === 'touch' || Boolean(n.touchPos);
            const laneIdx = isTouch ? 8 : (n.pos || 1) - 1;
            const laneInfo = visualNoteRefPos[laneIdx];
            if (!laneInfo) return;

            const targetTime = n.type === 'slide' ? n.time + (n.slideDelay || 0) : n.time;
            const t = targetTime - rc.globalTime;
            const x = laneInfo.x;
            const y = t * -zoom;

            if (y < -halfH - size || y > halfH + size) return;

            const r = Math.max(1.8, size * 0.2);
            const bx = x + size * 0.34;
            const by = y - size * 0.34;
            const isPassed = t <= 0;
            const alpha = (isPassed ? 0.72 : 1) * opacity;

            if (extSettings.showHandNoteHalo) {
                drawHandNoteHalo(c2d, x, y, hand, size * 0.42, alpha * 0.78);
            }
            drawHandNoteBadge(c2d, bx, by, hand, r, entry.isManual, alpha);
        });
    };

    let unregisterMainOverlay = null;
    let unregisterVisualOverlay = null;

    const registerCanvasOverlays = () => {
        if (!ctx.render) return;
        if (unregisterMainOverlay) {
            unregisterMainOverlay();
            unregisterMainOverlay = null;
        }
        if (unregisterVisualOverlay) {
            unregisterVisualOverlay();
            unregisterVisualOverlay = null;
        }

        unregisterMainOverlay = ctx.render.registerOverlay({
            target: 'main',
            phase: 'afterNotes',
            order: 20,
            includeInVideo: Boolean(extSettings.includeInVideo),
            draw: drawMainOverlay,
        });

        unregisterVisualOverlay = ctx.render.registerOverlay({
            target: 'visual',
            phase: 'afterNotes',
            order: 20,
            includeInVideo: false,
            draw: drawVisualOverlay,
        });
    };

    registerCanvasOverlays();

    const applySettingsChange = (key, allValues) => {
        const prevIncludeInVideo = Boolean(extSettings.includeInVideo);
        extSettings = { ...extSettings, ...allValues };
        if (ctx.storage) {
            ctx.storage.set(EXT_SETTINGS_STORAGE_KEY, extSettings);
        }
        if (key === 'includeInVideo' && Boolean(extSettings.includeInVideo) !== prevIncludeInVideo) {
            registerCanvasOverlays();
        } else if (ctx.render) {
            ctx.render.requestRedraw();
        }
    };

    const openSettingsPopover = (anchorEl = null) => {
        if (!ctx.ui || typeof ctx.ui.openPopover !== 'function') return;
        ctx.ui.openPopover({
            title: tr('popoverTitle'),
            schema: SETTINGS_SCHEMA,
            anchorEl,
            onChange: (key, _val, allValues) => {
                applySettingsChange(key, allValues);
            },
        });
    };

    const toggleCursor = () => {
        extSettings.showHandCursor = !extSettings.showHandCursor;
        if (ctx.storage) {
            ctx.storage.set(EXT_SETTINGS_STORAGE_KEY, extSettings);
        }
        if (ctx.render) ctx.render.requestRedraw();
        if (ctx.ui) {
            ctx.ui.toast({
                content: tr(extSettings.showHandCursor ? 'toastCursorOn' : 'toastCursorOff'),
                type: 'info',
                timeout: 1500,
            });
        }
    };

    const toggleBadges = () => {
        extSettings.showHandNoteBadge = !extSettings.showHandNoteBadge;
        if (ctx.storage) {
            ctx.storage.set(EXT_SETTINGS_STORAGE_KEY, extSettings);
        }
        if (ctx.render) ctx.render.requestRedraw();
        if (ctx.ui) {
            ctx.ui.toast({
                content: tr(extSettings.showHandNoteBadge ? 'toastBadgesOn' : 'toastBadgesOff'),
                type: 'info',
                timeout: 1500,
            });
        }
    };

    const showStats = () => {
        const prepared = warmUpAnalysis();
        if (!prepared || prepared.stats.total === 0) {
            if (ctx.ui) {
                ctx.ui.toast({ content: tr('toastNoChart'), type: 'warning', timeout: 2200 });
            }
            return;
        }
        const { total, left, right, both } = prepared.stats;
        const singleTotal = left + right;
        const ratio = singleTotal > 0 ? Math.round((left / singleTotal) * 100) : 50;
        if (ctx.ui) {
            ctx.ui.toast({
                content: tr('toastStats', { total, left, right, both, ratio }),
                type: 'info',
                timeout: 3500,
            });
        }
    };

    if (ctx.commands) {
        ctx.commands.register('openSettings', () => openSettingsPopover(), { title: tr('menuSettings') });
        ctx.commands.register('toggleCursor', toggleCursor, { title: tr('menuToggleCursor') });
        ctx.commands.register('toggleBadges', toggleBadges, { title: tr('optShowHandNoteBadge') });
        ctx.commands.register('showStats', showStats, { title: tr('menuShowStats') });
    }

    if (ctx.ui && typeof ctx.ui.registerMenuItem === 'function') {
        ctx.ui.registerMenuItem({
            id: 'open-settings',
            label: tr('menuSettings'),
            labelKey: `ext.${ctx.extensionId}.menuSettings`,
            onClick: ({ anchorEl } = {}) => openSettingsPopover(anchorEl),
        });
        ctx.ui.registerMenuItem({
            id: 'toggle-cursor',
            label: tr('menuToggleCursor'),
            labelKey: `ext.${ctx.extensionId}.menuToggleCursor`,
            commandId: `ext.${ctx.extensionId}.toggleCursor`,
        });
        ctx.ui.registerMenuItem({
            id: 'show-stats',
            label: tr('menuShowStats'),
            labelKey: `ext.${ctx.extensionId}.menuShowStats`,
            commandId: `ext.${ctx.extensionId}.showStats`,
        });
    }

    if (ctx.events) {
        const redrawOnChart = () => {
            warmUpAnalysis();
            if (ctx.render) ctx.render.requestRedraw();
        };
        ctx.events.on('chart:decoded', redrawOnChart);
        ctx.events.on('maidata:changed', redrawOnChart);
        ctx.events.on('project:loaded', redrawOnChart);
        ctx.events.on('settings:changed', () => {
            refreshAppSettingsCache();
            if (ctx.render) ctx.render.requestRedraw();
        });
    }

    // 首次啟用時預熱分析並請求重繪
    warmUpAnalysis();
    if (ctx.render) {
        ctx.render.requestRedraw();
    }

    return () => {
        if (unregisterMainOverlay) {
            unregisterMainOverlay();
            unregisterMainOverlay = null;
        }
        if (unregisterVisualOverlay) {
            unregisterVisualOverlay();
            unregisterVisualOverlay = null;
        }
    };
}

export default activate;
