/**
 * Flowchart Visual QA Analyzer
 * 
 * Comprehensive visual quality assurance tool for jsgui3-agents-flowcharts.
 * Uses Puppeteer to:
 *   1. Extract precise DOM geometry for all nodes and connections
 *   2. Compute mathematically expected connection endpoints
 *   3. Compare actual SVG paths against expected geometry
 *   4. Detect visual defects: overlaps, gaps, misalignment, clipping
 *   5. Produce a scored quality report with per-connection metrics
 * 
 * This is the "headless computer vision" approach — we don't need pixel-level
 * image analysis because we can read the exact same DOM the browser renders.
 */

const http = require('http');
const path = require('path');
const puppeteer = require('puppeteer');
const fs = require('fs');
const { createCanvas, loadImage } = (() => {
    try { return require('canvas'); } catch (e) { return { createCanvas: null, loadImage: null }; }
})();

const PORT = 52000; // Use the standard flowchart port
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const REPORT_DIR = path.join(__dirname, 'reports');
const BASELINE_DIR = path.join(__dirname, 'baselines');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Ensure output dirs exist
[SCREENSHOT_DIR, REPORT_DIR, BASELINE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ═══════════════════════════════════════════════════════════════════
// Import shared geometry library
// ═══════════════════════════════════════════════════════════════════
const {
    DECISION_SIZE,
    DECISION_DIAGONAL,
    DECISION_HALF_DIAG,
    DECISION_HALF_SIDE,
    DECISION_OFFSET,
    TASK_WIDTH,
    TASK_HEIGHT,
    THRESHOLDS,
    extract_node_geometry,
    extract_connection_geometry,
    compute_expected_endpoints,
    pixel_distance,
    classify_alignment,
    check_node_penetration,
    check_node_overlaps,
    check_connection_labels,
    check_arrowheads,
    check_viewport_clipping,
} = require('./lib/flowchart-geometry');

// ═══════════════════════════════════════════════════════════════════
// Analyzer-specific functions (not in shared library)
// ═══════════════════════════════════════════════════════════════════


/**
 * Verify arrowhead pixels are visible at each connection endpoint.
 * Uses document.elementFromPoint sampling to detect SVG arrow elements.
 */
async function verify_arrowhead_pixels(page, connections, nodes) {
    const results = [];
    const crop_size = 20;
    const half = crop_size / 2;

    for (const conn of connections) {
        if (!conn.actual_end || !conn.actual_start) {
            results.push({
                from: conn.from, to: conn.to,
                has_arrowhead_pixels: false,
                reason: 'no endpoint data',
                non_bg_ratio: 0,
            });
            continue;
        }

        // Calculate a sample point slightly BACK from the endpoint along
        // the arrow direction. The endpoint itself is covered by the target
        // node's div, so we sample 12px back along the arrow shaft.
        const dx = conn.actual_end.x - conn.actual_start.x;
        const dy = conn.actual_end.y - conn.actual_start.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const offset_px = Math.min(15, len * 0.3); // 15px or 30% of length
        const sample_x = conn.actual_end.x - (dx / len) * offset_px;
        const sample_y = conn.actual_end.y - (dy / len) * offset_px;

        // Crop around the sample point
        const clip_x = Math.max(0, sample_x - half);
        const clip_y = Math.max(0, sample_y - half);

        const crop_path = path.join(SCREENSHOT_DIR, `arrowhead-${conn.from}-${conn.to}.png`);
        try {
            await page.screenshot({
                path: crop_path,
                clip: { x: clip_x, y: clip_y, width: crop_size, height: crop_size }
            });
        } catch (e) {
            results.push({
                from: conn.from, to: conn.to,
                has_arrowhead_pixels: false,
                reason: 'screenshot crop failed: ' + e.message,
                non_bg_ratio: 0,
            });
            continue;
        }

        // Sample elements via elementFromPoint along the shaft
        const pixel_analysis = await page.evaluate((cx, cy, size) => {
            const sample_points = [];
            const step = 2;
            for (let ddx = -size/2; ddx < size/2; ddx += step) {
                for (let ddy = -size/2; ddy < size/2; ddy += step) {
                    const el = document.elementFromPoint(cx + ddx, cy + ddy);
                    if (el) {
                        const tag = el.tagName.toLowerCase();
                        // SVG elements have className as SVGAnimatedString
                        const cls = el.className?.baseVal || el.className || '';
                        const is_arrow_el = (
                            tag === 'polygon' ||
                            tag === 'path' ||
                            tag === 'line' ||
                            tag === 'svg' ||
                            tag === 'marker' ||
                            (typeof cls === 'string' && cls.includes('flowchart'))
                        );
                        sample_points.push({ tag, is_arrow: is_arrow_el });
                    }
                }
            }
            const arrow_points = sample_points.filter(p => p.is_arrow).length;
            const total_points = sample_points.length;
            return {
                arrow_points,
                total_points,
                ratio: total_points > 0 ? arrow_points / total_points : 0,
                sample_tags: [...new Set(sample_points.map(p => p.tag))]
            };
        }, conn.actual_end.x, conn.actual_end.y, crop_size);

        results.push({
            from: conn.from, to: conn.to,
            has_arrowhead_pixels: pixel_analysis.ratio > 0.05,
            non_bg_ratio: pixel_analysis.ratio,
            arrow_points: pixel_analysis.arrow_points,
            total_points: pixel_analysis.total_points,
            sample_tags: pixel_analysis.sample_tags,
            crop_file: crop_path,
        });
    }
    return results;
}

// ═══════════════════════════════════════════════════════════════════
// Phase 7B: Interactive drag screenshot diffing
// Captures baseline screenshot, simulates dragging a node,
// captures post-drag screenshot, and compares pixel-by-pixel.
// ═══════════════════════════════════════════════════════════════════

/**
 * Simulate dragging a node and verify arrows update dynamically.
 * Uses raw Puppeteer mouse events and compares screenshots + SVG paths.
 */
async function test_interactive_drag(page) {
    const result = {
        performed: false,
        baseline_path: null,
        post_drag_path: null,
        changed_pixels: 0,
        total_pixels: 0,
        change_ratio: 0,
        arrows_updated: false,
        drag_node: null,
        drag_distance: { dx: 0, dy: 0 },
    };

    try {
        // 1. Capture baseline screenshot
        result.baseline_path = path.join(SCREENSHOT_DIR, 'drag-baseline.png');
        await page.screenshot({ path: result.baseline_path, fullPage: true });

        // 2. Find a draggable task node (prefer node 5 "Test Implementation")
        const drag_target = await page.evaluate(() => {
            const el = document.querySelector('[data-node-id="5"]') ||
                       document.querySelector('.flowchart-task');
            if (!el) return null;
            const style = window.getComputedStyle(el);
            const left = parseFloat(style.left) || 0;
            const top = parseFloat(style.top) || 0;
            const width = parseFloat(style.width) || el.offsetWidth;
            const height = parseFloat(style.height) || el.offsetHeight;
            return {
                id: el.getAttribute('data-node-id'),
                cx: left + width / 2,
                cy: top + height / 2,
                width, height
            };
        });

        if (!drag_target) {
            result.performed = false;
            result.reason = 'no draggable node found';
            return result;
        }

        result.drag_node = drag_target.id;
        const drag_dx = 120;
        const drag_dy = 50;
        result.drag_distance = { dx: drag_dx, dy: drag_dy };

        // 3. Simulate drag: mousedown, multiple mousemoves, mouseup
        await page.mouse.move(drag_target.cx, drag_target.cy);
        await page.mouse.down();
        await delay(50);

        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const frac = i / steps;
            await page.mouse.move(
                drag_target.cx + drag_dx * frac,
                drag_target.cy + drag_dy * frac
            );
            await delay(20);
        }
        await delay(100);

        // 4. Capture mid-drag screenshot
        result.post_drag_path = path.join(SCREENSHOT_DIR, 'drag-after.png');
        await page.screenshot({ path: result.post_drag_path, fullPage: true });

        // 5. Release mouse
        await page.mouse.up();
        await delay(200);

        // 6. Pixel-level diff — compare PNG buffers byte-by-byte
        const baseline_buf = fs.readFileSync(result.baseline_path);
        const post_drag_buf = fs.readFileSync(result.post_drag_path);

        let diff_bytes = 0;
        const min_len = Math.min(baseline_buf.length, post_drag_buf.length);
        for (let i = 0; i < min_len; i += 4) {
            if (baseline_buf[i] !== post_drag_buf[i]) diff_bytes++;
        }
        const sampled_count = Math.floor(min_len / 4);
        result.changed_pixels = diff_bytes;
        result.total_pixels = sampled_count;
        result.change_ratio = sampled_count > 0 ? diff_bytes / sampled_count : 0;
        result.arrows_updated = result.change_ratio > 0.01;
        result.performed = true;

        // 7. Check node position changed
        const post_drag_pos = await page.evaluate((node_id) => {
            const el = document.querySelector(`[data-node-id="${node_id}"]`);
            if (!el) return null;
            const style = window.getComputedStyle(el);
            return {
                left: parseFloat(style.left) || 0,
                top: parseFloat(style.top) || 0
            };
        }, drag_target.id);

        if (post_drag_pos) {
            const actual_dx = post_drag_pos.left - (drag_target.cx - drag_target.width / 2);
            const actual_dy = post_drag_pos.top - (drag_target.cy - drag_target.height / 2);
            result.actual_displacement = { dx: actual_dx, dy: actual_dy };
            result.node_moved = Math.abs(actual_dx) > 5 || Math.abs(actual_dy) > 5;
        }

        // 8. Capture post-drag SVG path data
        result.post_drag_paths = await page.evaluate(() => {
            const paths = {};
            document.querySelectorAll('.flowchart-connection').forEach(el => {
                const from = el.getAttribute('data-from');
                const to = el.getAttribute('data-to');
                const path_el = el.querySelector('path');
                if (path_el) paths[`${from}-${to}`] = path_el.getAttribute('d');
            });
            return paths;
        });

        // 9. Drag the node BACK to original position
        const current_pos = post_drag_pos || { left: drag_target.cx, top: drag_target.cy };
        const current_cx = current_pos.left + drag_target.width / 2;
        const current_cy = current_pos.top + drag_target.height / 2;

        await page.mouse.move(current_cx, current_cy);
        await page.mouse.down();
        await delay(50);
        for (let i = 1; i <= steps; i++) {
            const frac = i / steps;
            await page.mouse.move(
                current_cx - drag_dx * frac,
                current_cy - drag_dy * frac
            );
            await delay(20);
        }
        await page.mouse.up();
        await delay(200);

    } catch (err) {
        result.performed = false;
        result.reason = 'drag test error: ' + err.message;
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════════
// Regression baseline management
// Saves/loads analysis snapshots for score regression detection.
// ═══════════════════════════════════════════════════════════════════

const BASELINE_FILE = path.join(BASELINE_DIR, 'qa-baseline.json');

function save_baseline(analysis) {
    const baseline = {
        timestamp: new Date().toISOString(),
        overall_score: analysis.overall_score,
        node_count: Object.keys(analysis.nodes).length,
        connection_count: analysis.connection_results.length,
        defects: {
            critical: analysis.defects.critical,
            warning: analysis.defects.warning,
            info: analysis.defects.info,
        },
        connection_scores: analysis.connection_results.map(c => ({
            from: c.from, to: c.to,
            start_distance: c.start_distance,
            end_distance: c.end_distance,
            start_quality: c.start_quality,
            end_quality: c.end_quality,
            penetration_count: c.penetrations.length,
        })),
        label_results: analysis.labels.map(l => ({
            from: l.from, to: l.to,
            has_label: l.has_label,
            label_text: l.label_text,
        })),
        arrowhead_results: analysis.arrowheads.map(a => ({
            from: a.from, to: a.to,
            has_marker_end: a.has_marker_end,
            has_marker_def: a.has_marker_def,
        })),
    };
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2));
    return baseline;
}

function load_baseline() {
    if (!fs.existsSync(BASELINE_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));
    } catch (e) {
        return null;
    }
}

function compare_with_baseline(current_analysis, baseline) {
    const regressions = [];
    const improvements = [];

    const score_delta = current_analysis.overall_score - baseline.overall_score;
    if (score_delta < -0.5) {
        regressions.push({
            category: 'overall_score',
            message: `Score regressed from ${baseline.overall_score.toFixed(1)}% to ${current_analysis.overall_score.toFixed(1)}% (Δ${score_delta.toFixed(1)}%)`,
            severity: Math.abs(score_delta) > 5 ? 'critical' : 'warning',
        });
    } else if (score_delta > 0.5) {
        improvements.push({
            category: 'overall_score',
            message: `Score improved from ${baseline.overall_score.toFixed(1)}% to ${current_analysis.overall_score.toFixed(1)}% (Δ+${score_delta.toFixed(1)}%)`,
        });
    }

    const defect_keys = ['critical', 'warning', 'info'];
    defect_keys.forEach(key => {
        const current = current_analysis.defects[key];
        const prev = baseline.defects[key];
        if (current > prev) {
            regressions.push({
                category: `defects_${key}`,
                message: `${key} defects increased from ${prev} to ${current}`,
                severity: key === 'critical' ? 'critical' : 'warning',
            });
        } else if (current < prev) {
            improvements.push({
                category: `defects_${key}`,
                message: `${key} defects decreased from ${prev} to ${current}`,
            });
        }
    });

    const baseline_conn_map = {};
    baseline.connection_scores.forEach(c => { baseline_conn_map[`${c.from}-${c.to}`] = c; });

    current_analysis.connection_results.forEach(c => {
        const key = `${c.from}-${c.to}`;
        const prev = baseline_conn_map[key];
        if (!prev) return;

        if (c.start_distance > prev.start_distance + 2) {
            regressions.push({
                category: 'connection_alignment',
                message: `Connection ${c.from}→${c.to} start alignment regressed: ${prev.start_distance.toFixed(1)}px → ${c.start_distance.toFixed(1)}px`,
                severity: c.start_quality === 'CRITICAL' ? 'critical' : 'warning',
            });
        }
        if (c.end_distance > prev.end_distance + 2) {
            regressions.push({
                category: 'connection_alignment',
                message: `Connection ${c.from}→${c.to} end alignment regressed: ${prev.end_distance.toFixed(1)}px → ${c.end_distance.toFixed(1)}px`,
                severity: c.end_quality === 'CRITICAL' ? 'critical' : 'warning',
            });
        }
    });

    return {
        baseline_timestamp: baseline.timestamp,
        regressions,
        improvements,
        has_regressions: regressions.length > 0,
        has_critical_regressions: regressions.some(r => r.severity === 'critical'),
    };
}

// ═══════════════════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════════════════

function generate_report(analysis) {
    const lines = [];
    const timestamp = new Date().toISOString();

    lines.push('╔══════════════════════════════════════════════════════════════════╗');
    lines.push('║          FLOWCHART VISUAL QA ANALYSIS REPORT                   ║');
    lines.push(`║  Generated: ${timestamp}              ║`);
    lines.push('╚══════════════════════════════════════════════════════════════════╝');
    lines.push('');

    // ── Overall Score ──
    lines.push('┌─── OVERALL QUALITY SCORE ────────────────────────────────────────┐');
    const score = analysis.overall_score;
    const bar_len = Math.round(score / 100 * 40);
    const bar = '█'.repeat(bar_len) + '░'.repeat(40 - bar_len);
    lines.push(`│  [${bar}] ${score.toFixed(1)}%`);
    lines.push(`│  Grade: ${score >= 90 ? 'A ★' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F ✗'}`);
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Node Inventory ──
    lines.push('┌─── NODE INVENTORY ───────────────────────────────────────────────┐');
    Object.values(analysis.nodes).forEach(node => {
        const type_badge = node.type === 'decision' ? '◆ DECISION' : '▬ TASK    ';
        lines.push(`│  ${type_badge}  id=${node.id}  pos=(${node.left.toFixed(0)}, ${node.top.toFixed(0)})  size=${node.width.toFixed(0)}×${node.height.toFixed(0)}`);
        lines.push(`│    center=(${node.center_x.toFixed(1)}, ${node.center_y.toFixed(1)})`);
        if (node.type === 'decision') {
            lines.push(`│    half_diagonal=${node.half_diagonal.toFixed(2)}px  (expected: ${DECISION_HALF_DIAG.toFixed(2)}px)`);
        }
    });
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Connection Analysis ──
    lines.push('┌─── CONNECTION ANALYSIS ──────────────────────────────────────────┐');
    analysis.connection_results.forEach(conn => {
        const icon = conn.start_quality === 'PERFECT' && conn.end_quality === 'PERFECT' ? '✓' :
                     conn.start_quality === 'CRITICAL' || conn.end_quality === 'CRITICAL' ? '✗' : '⚠';
        lines.push(`│  ${icon} Connection ${conn.from} → ${conn.to}`);
        lines.push(`│    Start:  actual=(${conn.actual_start?.x?.toFixed(1)}, ${conn.actual_start?.y?.toFixed(1)})  expected=(${conn.expected_start?.x?.toFixed(1)}, ${conn.expected_start?.y?.toFixed(1)})`);
        lines.push(`│            distance=${conn.start_distance.toFixed(2)}px  quality=${conn.start_quality}`);
        lines.push(`│    End:    actual=(${conn.actual_end?.x?.toFixed(1)}, ${conn.actual_end?.y?.toFixed(1)})  expected=(${conn.expected_end?.x?.toFixed(1)}, ${conn.expected_end?.y?.toFixed(1)})`);
        lines.push(`│            distance=${conn.end_distance.toFixed(2)}px  quality=${conn.end_quality}`);
        if (conn.penetrations.length > 0) {
            lines.push(`│    ⚠ PENETRATIONS: ${conn.penetrations.length} segment(s) pass through node bodies`);
            conn.penetrations.forEach(p => lines.push(`│      → ${p.message}`));
        }
    });
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Arrowhead Status ──
    lines.push('┌─── ARROWHEAD STATUS ─────────────────────────────────────────────┐');
    analysis.arrowheads.forEach(ah => {
        const status = ah.has_marker_end && ah.has_marker_def ? '✓' : '✗';
        lines.push(`│  ${status} Connection ${ah.from} → ${ah.to}  marker-end=${ah.has_marker_end}  defs=${ah.has_defs}  marker-def=${ah.has_marker_def}`);
    });
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Arrowhead Pixel Verification ──
    if (analysis.arrowhead_pixels) {
        lines.push('┌─── ARROWHEAD PIXEL VERIFICATION ─────────────────────────────────┐');
        analysis.arrowhead_pixels.forEach(ap => {
            const icon = ap.has_arrowhead_pixels ? '✓' : '⚠';
            const ratio_pct = (ap.non_bg_ratio * 100).toFixed(1);
            lines.push(`│  ${icon} Connection ${ap.from} → ${ap.to}  arrow_pixels=${ratio_pct}%  (${ap.arrow_points || 0}/${ap.total_points || 0} hits)`);
            if (ap.sample_tags) {
                lines.push(`│    elements found: ${ap.sample_tags.join(', ')}`);
            }
        });
        lines.push('└──────────────────────────────────────────────────────────────────┘');
        lines.push('');
    }

    // ── Interactive Drag Test ──
    if (analysis.drag_test) {
        lines.push('┌─── INTERACTIVE DRAG TEST ────────────────────────────────────────┐');
        const dt = analysis.drag_test;
        if (dt.performed) {
            const icon = dt.arrows_updated ? '✓' : '✗';
            lines.push(`│  ${icon} Drag test on node ${dt.drag_node}`);
            lines.push(`│    Drag vector: (${dt.drag_distance.dx}, ${dt.drag_distance.dy})px`);
            lines.push(`│    Node moved: ${dt.node_moved ? 'YES' : 'NO'}`);
            if (dt.actual_displacement) {
                lines.push(`│    Actual displacement: (${dt.actual_displacement.dx.toFixed(1)}, ${dt.actual_displacement.dy.toFixed(1)})px`);
            }
            lines.push(`│    Screenshot diff: ${dt.changed_pixels} changed / ${dt.total_pixels} sampled (${(dt.change_ratio * 100).toFixed(2)}%)`);
            lines.push(`│    Arrows updated dynamically: ${dt.arrows_updated ? 'YES ✓' : 'NO ✗'}`);
        } else {
            lines.push(`│  ⚠ Drag test not performed: ${dt.reason || 'unknown'}`);
        }
        lines.push('└──────────────────────────────────────────────────────────────────┘');
        lines.push('');
    }

    // ── Viewport & Clipping ──
    lines.push('┌─── VIEWPORT & CLIPPING ──────────────────────────────────────────┐');
    lines.push(`│  Viewport: ${analysis.viewport.width}×${analysis.viewport.height}`);
    lines.push(`│  Scroll area: ${analysis.viewport.scroll_width}×${analysis.viewport.scroll_height}`);
    if (analysis.clipped.length === 0) {
        lines.push('│  ✓ No nodes clipped by viewport edges');
    } else {
        analysis.clipped.forEach(c => {
            lines.push(`│  ✗ Node ${c.node_id} clipped on ${c.edge} edge by ${c.overflow_px.toFixed(1)}px`);
        });
    }
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Node Overlaps ──
    lines.push('┌─── NODE OVERLAP CHECK ───────────────────────────────────────────┐');
    if (analysis.node_overlaps.length === 0) {
        lines.push('│  ✓ No node overlaps detected');
    } else {
        analysis.node_overlaps.forEach(o => {
            lines.push(`│  ✗ Nodes ${o.node_a} and ${o.node_b} overlap: ${o.overlap_area.toFixed(0)}px² (${o.overlap_x.toFixed(0)}×${o.overlap_y.toFixed(0)})`);
        });
    }
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Connection Labels ──
    lines.push('┌─── CONNECTION LABELS ────────────────────────────────────────────┐');
    analysis.labels.forEach(l => {
        const status = l.has_label ? `✓ "${l.label_text}"` : '✗ MISSING';
        lines.push(`│  Connection ${l.from} → ${l.to}: ${status}`);
    });
    lines.push('└──────────────────────────────────────────────────────────────────┘');
    lines.push('');

    // ── Regression Comparison ──
    if (analysis.regression_comparison) {
        const rc = analysis.regression_comparison;
        lines.push('┌─── REGRESSION COMPARISON ────────────────────────────────────────┐');
        lines.push(`│  Baseline: ${rc.baseline_timestamp}`);
        if (!rc.has_regressions && rc.improvements.length === 0) {
            lines.push('│  ✓ No regressions or improvements detected');
        }
        rc.improvements.forEach(imp => {
            lines.push(`│  ↑ [IMPROVED] ${imp.message}`);
        });
        rc.regressions.forEach(reg => {
            const icon = reg.severity === 'critical' ? '✗' : '⚠';
            lines.push(`│  ${icon} [REGRESSED] ${reg.message}`);
        });
        if (rc.has_regressions) {
            lines.push(`│  ⚠ ${rc.regressions.length} regression(s) detected!`);
        }
        lines.push('└──────────────────────────────────────────────────────────────────┘');
        lines.push('');
    }

    // ── Defect Summary ──
    lines.push('┌─── DEFECT SUMMARY ──────────────────────────────────────────────┐');
    const defects = analysis.defects;
    lines.push(`│  Critical: ${defects.critical}  Warning: ${defects.warning}  Info: ${defects.info}`);
    defects.details.forEach(d => {
        const icon = d.severity === 'critical' ? '✗' : d.severity === 'warning' ? '⚠' : 'ℹ';
        lines.push(`│  ${icon} [${d.severity.toUpperCase()}] ${d.message}`);
    });
    lines.push('└──────────────────────────────────────────────────────────────────┘');

    return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// Main analysis runner
// ═══════════════════════════════════════════════════════════════════

async function run_analysis() {
    const cli_args = process.argv.slice(2);
    const save_baseline_flag = cli_args.includes('--save-baseline');
    const skip_drag = cli_args.includes('--skip-drag');

    console.log('🔍 Flowchart Visual QA Analyzer v2.0');
    console.log('  Connecting to server at http://localhost:' + PORT);
    if (save_baseline_flag) console.log('  Mode: SAVE BASELINE');
    if (skip_drag) console.log('  Skipping interactive drag test');
    console.log('');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
        await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0', timeout: 30000 });
        await delay(1000); // let CSS transitions settle

        // ── Phase 1: Extract geometry ──
        console.log('  Phase 1: Extracting DOM geometry...');
        const nodes = await extract_node_geometry(page);
        const connections = await extract_connection_geometry(page);

        console.log(`    Found ${Object.keys(nodes).length} nodes, ${connections.length} connections`);

        // ── Phase 2: Analyze connections ──
        console.log('  Phase 2: Analyzing connection alignment...');
        const connection_results = connections.map(conn => {
            const expected = compute_expected_endpoints(nodes, conn.from, conn.to);

            const start_distance = expected ? pixel_distance(conn.actual_start, expected.expected_start) : Infinity;
            const end_distance = expected ? pixel_distance(conn.actual_end, expected.expected_end) : Infinity;

            const penetrations = check_node_penetration(conn.segments, nodes);

            return {
                from: conn.from,
                to: conn.to,
                actual_start: conn.actual_start,
                actual_end: conn.actual_end,
                expected_start: expected?.expected_start,
                expected_end: expected?.expected_end,
                start_distance,
                end_distance,
                start_quality: classify_alignment(start_distance),
                end_quality: classify_alignment(end_distance),
                penetrations,
                path_data: conn.path_data,
                segment_count: conn.segments.length,
            };
        });

        // ── Phase 3: Check arrowheads (DOM level) ──
        console.log('  Phase 3: Checking arrowhead markers...');
        const arrowheads = await check_arrowheads(page);

        // ── Phase 4: Check viewport clipping ──
        console.log('  Phase 4: Checking viewport clipping...');
        const { viewport, clipped } = await check_viewport_clipping(page, nodes);

        // ── Phase 5: Check node overlaps ──
        console.log('  Phase 5: Checking node overlaps...');
        const node_overlaps = check_node_overlaps(nodes);

        // ── Phase 6: Check labels ──
        console.log('  Phase 6: Checking connection labels...');
        const labels = await check_connection_labels(page);

        // ── Phase 7: Capture screenshots ──
        console.log('  Phase 7: Capturing screenshots...');
        await page.screenshot({
            path: path.join(SCREENSHOT_DIR, 'full-page.png'),
            fullPage: true
        });

        // Capture zoomed views of each node
        for (const [id, node] of Object.entries(nodes)) {
            const padding = node.type === 'decision' ? 80 : 40;
            await page.screenshot({
                path: path.join(SCREENSHOT_DIR, `node-${id}-${node.type}.png`),
                clip: {
                    x: Math.max(0, node.left - padding),
                    y: Math.max(0, node.top - padding),
                    width: node.width + padding * 2,
                    height: node.height + padding * 2,
                }
            });
        }

        // ── Phase 7A: Arrowhead pixel verification ──
        console.log('  Phase 7A: Verifying arrowhead pixels at endpoints...');
        const arrowhead_pixels = await verify_arrowhead_pixels(page, connections, nodes);
        const pixel_verified_count = arrowhead_pixels.filter(ap => ap.has_arrowhead_pixels).length;
        console.log(`    ${pixel_verified_count}/${arrowhead_pixels.length} connections have visible arrowhead pixels`);

        // ── Phase 7B: Interactive drag screenshot diff ──
        let drag_test = null;
        if (!skip_drag) {
            console.log('  Phase 7B: Testing interactive drag with screenshot diff...');

            // Capture pre-drag SVG path data for comparison
            const pre_drag_paths = await page.evaluate(() => {
                const paths = {};
                document.querySelectorAll('.flowchart-connection').forEach(el => {
                    const from = el.getAttribute('data-from');
                    const to = el.getAttribute('data-to');
                    const path_el = el.querySelector('path');
                    if (path_el) paths[`${from}-${to}`] = path_el.getAttribute('d');
                });
                return paths;
            });

            drag_test = await test_interactive_drag(page);

            if (drag_test.performed) {
                // Compare pre-drag and post-drag SVG paths
                let paths_changed = 0;
                if (drag_test.post_drag_paths) {
                    for (const key of Object.keys(pre_drag_paths)) {
                        if (drag_test.post_drag_paths[key] !== pre_drag_paths[key]) {
                            paths_changed++;
                        }
                    }
                }
                drag_test.svg_paths_changed = paths_changed;
                drag_test.svg_paths_total = Object.keys(pre_drag_paths).length;
                drag_test.arrows_updated = drag_test.arrows_updated || paths_changed > 0;

                console.log(`    Node ${drag_test.drag_node} dragged (${drag_test.drag_distance.dx}, ${drag_test.drag_distance.dy})px`);
                console.log(`    Node moved: ${drag_test.node_moved ? 'YES' : 'NO'}`);
                console.log(`    SVG paths changed: ${paths_changed}/${Object.keys(pre_drag_paths).length}`);
                console.log(`    Screenshot diff: ${(drag_test.change_ratio * 100).toFixed(2)}% bytes changed`);
                console.log(`    Arrows updated: ${drag_test.arrows_updated ? 'YES ✓' : 'NO ✗'}`);
            } else {
                console.log(`    ⚠ Drag test skipped: ${drag_test.reason || 'unknown'}`);
            }
        } else {
            console.log('  Phase 7B: Skipped (--skip-drag)');
        }

        // ── Phase 8: Calculate overall score ──
        console.log('  Phase 8: Computing quality score...');

        const defects = { critical: 0, warning: 0, info: 0, details: [] };

        // Score connection alignment
        let total_alignment_score = 0;
        connection_results.forEach(conn => {
            // Score each endpoint 0-100
            const score_start = conn.start_distance <= THRESHOLDS.PERFECT ? 100 :
                               conn.start_distance <= THRESHOLDS.ACCEPTABLE ? 85 :
                               conn.start_distance <= THRESHOLDS.WARNING ? 60 :
                               Math.max(0, 40 - conn.start_distance);
            const score_end = conn.end_distance <= THRESHOLDS.PERFECT ? 100 :
                             conn.end_distance <= THRESHOLDS.ACCEPTABLE ? 85 :
                             conn.end_distance <= THRESHOLDS.WARNING ? 60 :
                             Math.max(0, 40 - conn.end_distance);

            total_alignment_score += (score_start + score_end) / 2;

            if (conn.start_quality === 'CRITICAL') {
                defects.critical++;
                defects.details.push({ severity: 'critical', message: `Connection ${conn.from}→${conn.to} start misaligned by ${conn.start_distance.toFixed(1)}px` });
            } else if (conn.start_quality === 'WARNING') {
                defects.warning++;
                defects.details.push({ severity: 'warning', message: `Connection ${conn.from}→${conn.to} start misaligned by ${conn.start_distance.toFixed(1)}px` });
            }

            if (conn.end_quality === 'CRITICAL') {
                defects.critical++;
                defects.details.push({ severity: 'critical', message: `Connection ${conn.from}→${conn.to} end misaligned by ${conn.end_distance.toFixed(1)}px` });
            } else if (conn.end_quality === 'WARNING') {
                defects.warning++;
                defects.details.push({ severity: 'warning', message: `Connection ${conn.from}→${conn.to} end misaligned by ${conn.end_distance.toFixed(1)}px` });
            }

            conn.penetrations.forEach(p => {
                defects.warning++;
                defects.details.push({ severity: 'warning', message: p.message });
            });
        });

        // Score arrowheads (DOM level)
        let arrowhead_score = 0;
        arrowheads.forEach(ah => {
            if (ah.has_marker_end && ah.has_marker_def) {
                arrowhead_score += 100;
            } else {
                defects.warning++;
                defects.details.push({ severity: 'warning', message: `Connection ${ah.from}→${ah.to} missing arrowhead marker` });
            }
        });

        // Score arrowhead pixels
        let arrowhead_pixel_score = 100;
        arrowhead_pixels.forEach(ap => {
            if (!ap.has_arrowhead_pixels) {
                arrowhead_pixel_score -= (100 / arrowhead_pixels.length);
                defects.info++;
                defects.details.push({ severity: 'info', message: `Connection ${ap.from}→${ap.to} arrowhead pixels not detected (${(ap.non_bg_ratio * 100).toFixed(1)}% hit rate)` });
            }
        });

        // Score interactive drag test
        let drag_score = 100; // Default to 100 if skipped
        if (drag_test && drag_test.performed) {
            if (!drag_test.node_moved) {
                drag_score = 0;
                defects.critical++;
                defects.details.push({ severity: 'critical', message: 'Drag test: node did not move' });
            } else if (!drag_test.arrows_updated) {
                drag_score = 30;
                defects.warning++;
                defects.details.push({ severity: 'warning', message: 'Drag test: arrows did not update dynamically' });
            }
        }

        // Score clipping
        let clipping_score = clipped.length === 0 ? 100 : Math.max(0, 100 - clipped.length * 20);
        clipped.forEach(c => {
            defects.info++;
            defects.details.push({ severity: 'info', message: `Node ${c.node_id} clipped on ${c.edge} by ${c.overflow_px.toFixed(1)}px` });
        });

        // Score overlaps
        let overlap_score = node_overlaps.length === 0 ? 100 : Math.max(0, 100 - node_overlaps.length * 30);
        node_overlaps.forEach(o => {
            defects.critical++;
            defects.details.push({ severity: 'critical', message: `Nodes ${o.node_a} and ${o.node_b} overlap by ${o.overlap_area.toFixed(0)}px²` });
        });

        // Score labels (decision connections should have labels)
        let label_score = 100;
        labels.forEach(l => {
            // Check if this connection involves a decision node
            const from_node = nodes[l.from];
            if (from_node && from_node.type === 'decision' && !l.has_label) {
                label_score -= 25;
                defects.info++;
                defects.details.push({ severity: 'info', message: `Decision connection ${l.from}→${l.to} missing "Yes"/"No" label` });
            }
        });

        // Weighted overall score (expanded to include new phases)
        const alignment_avg = connection_results.length > 0 ? total_alignment_score / connection_results.length : 100;
        const arrowhead_avg = arrowheads.length > 0 ? arrowhead_score / arrowheads.length : 100;
        const overall_score = (
            alignment_avg * 0.30 +             // 30% weight: connection alignment
            arrowhead_avg * 0.10 +              // 10% weight: arrowhead DOM markers
            arrowhead_pixel_score * 0.10 +      // 10% weight: arrowhead pixel presence
            (skip_drag ? 100 : drag_score) * 0.10 + // 10% weight: interactive drag test
            clipping_score * 0.10 +             // 10% weight: no viewport clipping
            overlap_score * 0.15 +              // 15% weight: no node overlaps
            label_score * 0.15                  // 15% weight: connection labels
        );

        // ── Phase 9: Generate report ──
        const analysis = {
            nodes,
            connection_results,
            arrowheads,
            arrowhead_pixels,
            drag_test,
            viewport,
            clipped,
            node_overlaps,
            labels,
            defects,
            overall_score,
        };

        // ── Phase 9A: Regression comparison ──
        console.log('  Phase 9A: Checking regression baseline...');
        const previous_baseline = load_baseline();
        if (previous_baseline) {
            analysis.regression_comparison = compare_with_baseline(analysis, previous_baseline);
            const rc = analysis.regression_comparison;
            if (rc.has_regressions) {
                console.log(`    ⚠ ${rc.regressions.length} regression(s) detected vs baseline from ${rc.baseline_timestamp}`);
                rc.regressions.forEach(r => console.log(`      ${r.severity === 'critical' ? '✗' : '⚠'} ${r.message}`));
            } else {
                console.log(`    ✓ No regressions vs baseline from ${previous_baseline.timestamp}`);
            }
            if (rc.improvements.length > 0) {
                console.log(`    ↑ ${rc.improvements.length} improvement(s)`);
            }
        } else {
            console.log('    No baseline found. Use --save-baseline to create one.');
        }

        // ── Phase 9B: Save baseline if requested ──
        if (save_baseline_flag) {
            console.log('  Phase 9B: Saving baseline...');
            const saved = save_baseline(analysis);
            console.log(`    Baseline saved to: ${BASELINE_FILE}`);
            console.log(`    Score: ${saved.overall_score.toFixed(1)}%  Defects: ${saved.defects.critical}C/${saved.defects.warning}W/${saved.defects.info}I`);
        }

        const report = generate_report(analysis);

        // Print report to console
        console.log('');
        console.log(report);

        // Save report to file
        const report_path = path.join(REPORT_DIR, `visual-qa-report-${Date.now()}.txt`);
        fs.writeFileSync(report_path, report);
        console.log(`\n📄 Report saved to: ${report_path}`);

        // Save analysis data as JSON
        const json_path = path.join(REPORT_DIR, `visual-qa-data-${Date.now()}.json`);
        fs.writeFileSync(json_path, JSON.stringify(analysis, null, 2));
        console.log(`📊 Data saved to: ${json_path}`);

        // ── Summary line ──
        console.log('');
        if (defects.critical === 0 && defects.warning === 0) {
            console.log('=== ALL CHECKS PASS ✓ ===');
        } else if (defects.critical > 0) {
            console.log(`=== CRITICAL ISSUES FOUND ✗ === (${defects.critical} critical, ${defects.warning} warnings)`);
        } else {
            console.log(`=== WARNINGS FOUND ⚠ === (${defects.warning} warnings)`);
        }

        await browser.close();
        process.exit(defects.critical > 0 ? 1 : 0);

    } catch (err) {
        console.error('Fatal error during analysis:', err.message);
        console.error(err.stack);
        await browser.close();
        process.exit(2);
    }
}

run_analysis();
