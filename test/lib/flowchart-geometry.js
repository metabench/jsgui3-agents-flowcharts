/**
 * Flowchart Geometry Library
 * 
 * Reusable module for extracting and analyzing flowchart node/connection
 * geometry from a Puppeteer page. Used by:
 *   - test/visual-qa-analyzer.js (full QA suite)
 *   - test/smoke-test.js (CI smoke test)
 *   - Future E2E tests
 * 
 * All functions that take a `page` parameter expect a Puppeteer Page object
 * connected to a running jsgui3-agents-flowcharts server.
 */

// ═══════════════════════════════════════════════════════════════════
// Mathematical constants for decision diamond geometry
// ═══════════════════════════════════════════════════════════════════
const DECISION_SIZE = 200;
const DECISION_ROTATION = 45;
const DECISION_DIAGONAL = DECISION_SIZE * Math.sqrt(2);
const DECISION_HALF_DIAG = DECISION_DIAGONAL / 2;
const DECISION_HALF_SIDE = DECISION_SIZE / 2;
const DECISION_OFFSET = DECISION_HALF_DIAG - DECISION_HALF_SIDE;

const TASK_WIDTH = 200;
const TASK_HEIGHT = 40;

// ═══════════════════════════════════════════════════════════════════
// Quality thresholds (in pixels)
// ═══════════════════════════════════════════════════════════════════
const THRESHOLDS = {
    PERFECT: 2,
    ACCEPTABLE: 5,
    WARNING: 15,
    CRITICAL: 30,
};

// ═══════════════════════════════════════════════════════════════════
// DOM geometry extraction
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract all node geometries from the DOM
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>} nodes keyed by id
 */
async function extract_node_geometry(page) {
    return await page.evaluate(() => {
        const nodes = {};

        document.querySelectorAll('.flowchart-task').forEach(el => {
            const node_id = el.getAttribute('data-node-id');
            if (!node_id) return;

            const style = window.getComputedStyle(el);
            const left = parseFloat(style.left) || 0;
            const top = parseFloat(style.top) || 0;
            const width = parseFloat(style.width) || el.offsetWidth;
            const height = parseFloat(style.height) || el.offsetHeight;

            nodes[node_id] = {
                id: parseInt(node_id),
                type: 'task',
                left, top, width, height,
                center_x: left + width / 2,
                center_y: top + height / 2,
                anchors: {
                    top: { x: left + width / 2, y: top },
                    bottom: { x: left + width / 2, y: top + height },
                    left: { x: left, y: top + height / 2 },
                    right: { x: left + width, y: top + height / 2 },
                }
            };
        });

        document.querySelectorAll('.flowchart-decision').forEach(el => {
            const node_id = el.getAttribute('data-node-id');
            if (!node_id) return;

            const style = window.getComputedStyle(el);
            const left = parseFloat(style.left) || 0;
            const top = parseFloat(style.top) || 0;
            const width = parseFloat(style.width) || el.offsetWidth;
            const height = parseFloat(style.height) || el.offsetHeight;

            const cx = left + width / 2;
            const cy = top + height / 2;
            const half_diag = (width * Math.sqrt(2)) / 2;

            nodes[node_id] = {
                id: parseInt(node_id),
                type: 'decision',
                left, top, width, height,
                center_x: cx,
                center_y: cy,
                half_diagonal: half_diag,
                anchors: {
                    top: { x: cx, y: cy - half_diag },
                    bottom: { x: cx, y: cy + half_diag },
                    left: { x: cx - half_diag, y: cy },
                    right: { x: cx + half_diag, y: cy },
                }
            };
        });

        return nodes;
    });
}

/**
 * Extract all connection geometries from the DOM
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Array>} connection objects with endpoints and segments
 */
async function extract_connection_geometry(page) {
    return await page.evaluate(() => {
        const connections = [];

        document.querySelectorAll('.flowchart-connection').forEach(el => {
            const from_id = el.getAttribute('data-from');
            const to_id = el.getAttribute('data-to');
            if (!from_id || !to_id) return;

            const style = window.getComputedStyle(el);
            const conn_left = parseFloat(style.left) || 0;
            const conn_top = parseFloat(style.top) || 0;
            const conn_width = parseFloat(style.width) || 0;
            const conn_height = parseFloat(style.height) || 0;

            const svg = el.querySelector('svg');
            const path_el = el.querySelector('path');

            let path_data = '';
            let svg_width = 0;
            let svg_height = 0;
            let viewbox = '';

            if (svg) {
                svg_width = parseFloat(svg.getAttribute('width')) || 0;
                svg_height = parseFloat(svg.getAttribute('height')) || 0;
                viewbox = svg.getAttribute('viewBox') || '';
            }

            if (path_el) {
                path_data = path_el.getAttribute('d') || '';
            }

            let actual_start = null;
            let actual_end = null;
            const segments = [];

            if (path_data) {
                const commands = path_data.trim().split(/(?=[ML])/);
                commands.forEach(cmd => {
                    const parts = cmd.trim().split(/\s+/);
                    const type = parts[0];
                    const x = parseFloat(parts[1]);
                    const y = parseFloat(parts[2]);

                    if (type === 'M') {
                        actual_start = { x: x + conn_left, y: y + conn_top };
                    }

                    segments.push({ type, local_x: x, local_y: y, abs_x: x + conn_left, abs_y: y + conn_top });
                });

                if (segments.length > 0) {
                    const last = segments[segments.length - 1];
                    actual_end = { x: last.abs_x, y: last.abs_y };
                }
            }

            connections.push({
                from: parseInt(from_id),
                to: parseInt(to_id),
                container: { left: conn_left, top: conn_top, width: conn_width, height: conn_height },
                svg: { width: svg_width, height: svg_height, viewbox },
                path_data,
                segments,
                actual_start,
                actual_end,
            });
        });

        return connections;
    });
}

// ═══════════════════════════════════════════════════════════════════
// Geometric analysis (pure functions — no DOM access needed)
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute expected connection endpoints based on node geometry.
 * Mirrors the routing logic in flowchart-layout-engine.js.
 */
function compute_expected_endpoints(nodes, from_id, to_id) {
    const from_node = nodes[from_id];
    const to_node = nodes[to_id];

    if (!from_node || !to_node) return null;

    const dy = to_node.center_y - from_node.center_y;
    const dx = to_node.center_x - from_node.center_x;

    let expected_start, expected_end;

    // EXIT point logic
    if (from_node.type === 'decision') {
        const half_diag = from_node.half_diagonal;
        if (Math.abs(dx) <= half_diag) {
            expected_start = from_node.anchors.bottom;
        } else if (dx > 0) {
            expected_start = from_node.anchors.right;
        } else {
            expected_start = from_node.anchors.left;
        }
    } else {
        expected_start = from_node.anchors.bottom;
    }

    // ENTRY point logic
    if (to_node.type === 'decision') {
        const half_diag = to_node.half_diagonal;
        if (dy >= 0 && Math.abs(dx) <= half_diag) {
            expected_end = to_node.anchors.top;
        } else if (dy < 0 && from_node.center_x <= to_node.center_x) {
            expected_end = to_node.anchors.left;
        } else if (dy < 0) {
            expected_end = to_node.anchors.right;
        } else {
            expected_end = to_node.anchors.top;
        }
    } else {
        expected_end = to_node.anchors.top;
    }

    return { expected_start, expected_end };
}

/**
 * Calculate pixel distance between two points
 */
function pixel_distance(a, b) {
    if (!a || !b) return Infinity;
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Classify alignment quality based on pixel distance
 */
function classify_alignment(distance_px) {
    if (distance_px <= THRESHOLDS.PERFECT) return 'PERFECT';
    if (distance_px <= THRESHOLDS.ACCEPTABLE) return 'ACCEPTABLE';
    if (distance_px <= THRESHOLDS.WARNING) return 'WARNING';
    return 'CRITICAL';
}

/**
 * Check if connection segments pass through a node body
 */
function check_node_penetration(segments, nodes) {
    const issues = [];
    const margin = 5;

    segments.forEach((seg, i) => {
        Object.values(nodes).forEach(node => {
            const in_x = seg.abs_x >= node.left + margin && seg.abs_x <= node.left + node.width - margin;
            const in_y = seg.abs_y >= node.top + margin && seg.abs_y <= node.top + node.height - margin;

            if (in_x && in_y) {
                if (node.type === 'decision') {
                    const rel_x = Math.abs(seg.abs_x - node.center_x);
                    const rel_y = Math.abs(seg.abs_y - node.center_y);
                    if (rel_x + rel_y <= node.half_diagonal - margin) {
                        issues.push({
                            segment_index: i,
                            node_id: node.id,
                            node_type: node.type,
                            penetration_point: { x: seg.abs_x, y: seg.abs_y },
                            message: `Segment ${i} at (${seg.abs_x.toFixed(1)}, ${seg.abs_y.toFixed(1)}) penetrates decision diamond ${node.id}`
                        });
                    }
                } else {
                    issues.push({
                        segment_index: i,
                        node_id: node.id,
                        node_type: node.type,
                        penetration_point: { x: seg.abs_x, y: seg.abs_y },
                        message: `Segment ${i} at (${seg.abs_x.toFixed(1)}, ${seg.abs_y.toFixed(1)}) penetrates task node ${node.id}`
                    });
                }
            }
        });
    });

    return issues;
}

/**
 * Check node overlap (two nodes in the same visual space)
 */
function check_node_overlaps(nodes) {
    const overlaps = [];
    const node_list = Object.values(nodes);

    for (let i = 0; i < node_list.length; i++) {
        for (let j = i + 1; j < node_list.length; j++) {
            const a = node_list[i];
            const b = node_list[j];

            const overlap_x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
            const overlap_y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

            if (overlap_x > 0 && overlap_y > 0) {
                overlaps.push({
                    node_a: a.id,
                    node_b: b.id,
                    overlap_area: overlap_x * overlap_y,
                    overlap_x,
                    overlap_y,
                });
            }
        }
    }

    return overlaps;
}

/**
 * Check connection labels ("Yes"/"No") presence
 * @param {import('puppeteer').Page} page
 */
async function check_connection_labels(page) {
    return await page.evaluate(() => {
        const labels = [];
        document.querySelectorAll('.flowchart-connection').forEach(el => {
            const from = el.getAttribute('data-from');
            const to = el.getAttribute('data-to');
            const text_els = el.querySelectorAll('text, .connection-label, span');
            labels.push({
                from: parseInt(from),
                to: parseInt(to),
                has_label: text_els.length > 0,
                label_text: text_els.length > 0 ? text_els[0].textContent : null,
            });
        });
        return labels;
    });
}

/**
 * Check arrowhead marker presence
 * @param {import('puppeteer').Page} page
 */
async function check_arrowheads(page) {
    return await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.flowchart-connection').forEach(el => {
            const from = el.getAttribute('data-from');
            const to = el.getAttribute('data-to');
            const path_el = el.querySelector('path');
            const marker = el.querySelector('marker');
            const defs = el.querySelector('defs');

            results.push({
                from: parseInt(from),
                to: parseInt(to),
                has_marker_end: path_el ? (path_el.getAttribute('marker-end') || '').includes('arrowhead') : false,
                has_defs: !!defs,
                has_marker_def: !!marker,
                marker_id: marker ? marker.getAttribute('id') : null,
            });
        });
        return results;
    });
}

/**
 * Check viewport clipping
 * @param {import('puppeteer').Page} page
 * @param {Object} nodes - node geometry map
 */
async function check_viewport_clipping(page, nodes) {
    const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        scroll_width: document.documentElement.scrollWidth,
        scroll_height: document.documentElement.scrollHeight,
    }));

    const clipped = [];
    Object.values(nodes).forEach(node => {
        if (node.left < 0) {
            clipped.push({ node_id: node.id, edge: 'left', overflow_px: -node.left });
        }
        if (node.top < 0) {
            clipped.push({ node_id: node.id, edge: 'top', overflow_px: -node.top });
        }
        if (node.left + node.width > viewport.width) {
            clipped.push({ node_id: node.id, edge: 'right', overflow_px: node.left + node.width - viewport.width });
        }
    });

    return { viewport, clipped };
}

/**
 * Run a complete connection analysis: extract geometry, compute expected
 * endpoints, compare actual vs expected, and return scored results.
 * 
 * @param {import('puppeteer').Page} page
 * @returns {Promise<Object>} { nodes, connections, connection_results, arrowheads, labels, viewport, clipped, node_overlaps }
 */
async function analyze_flowchart(page) {
    const nodes = await extract_node_geometry(page);
    const connections = await extract_connection_geometry(page);

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

    const arrowheads = await check_arrowheads(page);
    const labels = await check_connection_labels(page);
    const { viewport, clipped } = await check_viewport_clipping(page, nodes);
    const node_overlaps = check_node_overlaps(nodes);

    return {
        nodes,
        connections,
        connection_results,
        arrowheads,
        labels,
        viewport,
        clipped,
        node_overlaps,
    };
}

module.exports = {
    // Constants
    DECISION_SIZE,
    DECISION_ROTATION,
    DECISION_DIAGONAL,
    DECISION_HALF_DIAG,
    DECISION_HALF_SIDE,
    DECISION_OFFSET,
    TASK_WIDTH,
    TASK_HEIGHT,
    THRESHOLDS,

    // DOM extraction
    extract_node_geometry,
    extract_connection_geometry,

    // Pure analysis
    compute_expected_endpoints,
    pixel_distance,
    classify_alignment,
    check_node_penetration,
    check_node_overlaps,

    // Puppeteer-dependent checks
    check_connection_labels,
    check_arrowheads,
    check_viewport_clipping,

    // High-level
    analyze_flowchart,
};
