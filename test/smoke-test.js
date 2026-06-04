/**
 * Flowchart Visual QA Smoke Test
 * 
 * Self-contained CI-friendly test that:
 *   1. Starts the flowchart server
 *   2. Waits for it to be ready
 *   3. Runs a quick geometry analysis (no drag test)
 *   4. Asserts score ≥95%
 *   5. Shuts everything down
 * 
 * Usage:
 *   node test/smoke-test.js              # Normal run
 *   node test/smoke-test.js --threshold 90  # Custom threshold
 * 
 * Exit codes:
 *   0 = all checks pass
 *   1 = quality below threshold
 *   2 = fatal error (server failed, puppeteer crash, etc.)
 */

const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer');

const {
    analyze_flowchart,
    THRESHOLDS,
    DECISION_HALF_DIAG,
} = require('./lib/flowchart-geometry');

const PORT = 52000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Parse CLI args
const args = process.argv.slice(2);
const threshold_idx = args.indexOf('--threshold');
const SCORE_THRESHOLD = threshold_idx >= 0 ? parseFloat(args[threshold_idx + 1]) : 95;

/**
 * Start the server and wait for it to be ready
 */
function start_server() {
    return new Promise((resolve, reject) => {
        const server_path = path.join(__dirname, '..', 'server.js');
        const proc = spawn('node', [server_path], {
            cwd: path.join(__dirname, '..'),
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let started = false;
        const timeout = setTimeout(() => {
            if (!started) {
                proc.kill();
                reject(new Error('Server failed to start within 30 seconds'));
            }
        }, 30000);

        proc.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('Server ready') || output.includes('server started')) {
                if (!started) {
                    started = true;
                    clearTimeout(timeout);
                    // Give it a moment to fully bind
                    setTimeout(() => resolve(proc), 500);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            // Some stderr is normal (warnings, etc.)
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(new Error('Failed to spawn server: ' + err.message));
        });

        proc.on('exit', (code) => {
            if (!started) {
                clearTimeout(timeout);
                reject(new Error(`Server exited with code ${code} before becoming ready`));
            }
        });
    });
}

/**
 * Compute a weighted quality score from analysis results
 */
function compute_score(analysis) {
    const { connection_results, arrowheads, clipped, node_overlaps, labels, nodes } = analysis;

    // Connection alignment score
    let total_alignment = 0;
    connection_results.forEach(conn => {
        const s = conn.start_distance <= THRESHOLDS.PERFECT ? 100 :
                  conn.start_distance <= THRESHOLDS.ACCEPTABLE ? 85 :
                  conn.start_distance <= THRESHOLDS.WARNING ? 60 :
                  Math.max(0, 40 - conn.start_distance);
        const e = conn.end_distance <= THRESHOLDS.PERFECT ? 100 :
                  conn.end_distance <= THRESHOLDS.ACCEPTABLE ? 85 :
                  conn.end_distance <= THRESHOLDS.WARNING ? 60 :
                  Math.max(0, 40 - conn.end_distance);
        total_alignment += (s + e) / 2;
    });
    const alignment_avg = connection_results.length > 0 ? total_alignment / connection_results.length : 100;

    // Arrowhead score
    let arrowhead_score = 0;
    arrowheads.forEach(ah => {
        if (ah.has_marker_end && ah.has_marker_def) arrowhead_score += 100;
    });
    const arrowhead_avg = arrowheads.length > 0 ? arrowhead_score / arrowheads.length : 100;

    // Clipping score
    const clipping_score = clipped.length === 0 ? 100 : Math.max(0, 100 - clipped.length * 20);

    // Overlap score
    const overlap_score = node_overlaps.length === 0 ? 100 : Math.max(0, 100 - node_overlaps.length * 30);

    // Label score (decision branches should have labels)
    let label_score = 100;
    labels.forEach(l => {
        const from_node = nodes[l.from];
        if (from_node && from_node.type === 'decision' && !l.has_label) {
            label_score -= 25;
        }
    });

    // Weighted total (skip drag test weight — always 100 in smoke mode)
    return (
        alignment_avg * 0.40 +
        arrowhead_avg * 0.15 +
        clipping_score * 0.15 +
        overlap_score * 0.15 +
        label_score * 0.15
    );
}

async function run_smoke_test() {
    console.log('🧪 Flowchart Visual QA Smoke Test');
    console.log(`  Threshold: ${SCORE_THRESHOLD}%`);
    console.log('');

    let server_proc = null;

    try {
        // 1. Start server
        console.log('  Starting server...');
        server_proc = await start_server();
        console.log('  ✓ Server ready on port ' + PORT);

        // 2. Launch Puppeteer
        console.log('  Launching browser...');
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        // 3. Navigate
        console.log('  Loading flowchart...');
        await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0', timeout: 30000 });
        await delay(1000);

        // 4. Analyze
        console.log('  Running geometry analysis...');
        const analysis = await analyze_flowchart(page);

        const node_count = Object.keys(analysis.nodes).length;
        const conn_count = analysis.connection_results.length;
        console.log(`    Found ${node_count} nodes, ${conn_count} connections`);

        // 5. Score
        const score = compute_score(analysis);
        const grade = score >= 90 ? 'A ★' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

        // 6. Count defects
        let critical = 0, warning = 0;
        analysis.connection_results.forEach(c => {
            if (c.start_quality === 'CRITICAL' || c.end_quality === 'CRITICAL') critical++;
            if (c.start_quality === 'WARNING' || c.end_quality === 'WARNING') warning++;
            critical += c.penetrations.length;
        });
        analysis.node_overlaps.forEach(() => critical++);

        // 7. Check alignment details
        let all_perfect = true;
        analysis.connection_results.forEach(c => {
            const s_ok = c.start_quality === 'PERFECT';
            const e_ok = c.end_quality === 'PERFECT';
            const icon = s_ok && e_ok ? '✓' : '✗';
            if (!s_ok || !e_ok) all_perfect = false;
            console.log(`    ${icon} ${c.from}→${c.to}  start=${c.start_distance.toFixed(1)}px  end=${c.end_distance.toFixed(1)}px  pen=${c.penetrations.length}`);
        });

        // 8. Print result
        console.log('');
        console.log(`  Score: ${score.toFixed(1)}% (Grade ${grade})`);
        console.log(`  Defects: ${critical} critical, ${warning} warnings`);
        console.log(`  Diamond half-diagonal: ${analysis.nodes['3']?.half_diagonal?.toFixed(2) || '?'}px (expected ${DECISION_HALF_DIAG.toFixed(2)}px)`);
        console.log('');

        const passed = score >= SCORE_THRESHOLD && critical === 0;

        if (passed) {
            console.log(`  ✓ SMOKE TEST PASSED (${score.toFixed(1)}% ≥ ${SCORE_THRESHOLD}%, 0 critical)`);
        } else {
            if (score < SCORE_THRESHOLD) {
                console.log(`  ✗ SMOKE TEST FAILED — score ${score.toFixed(1)}% < threshold ${SCORE_THRESHOLD}%`);
            }
            if (critical > 0) {
                console.log(`  ✗ SMOKE TEST FAILED — ${critical} critical defect(s)`);
            }
        }

        await browser.close();

        // Kill server
        server_proc.kill();
        process.exit(passed ? 0 : 1);

    } catch (err) {
        console.error('');
        console.error('  ✗ FATAL ERROR:', err.message);
        if (server_proc) server_proc.kill();
        process.exit(2);
    }
}

run_smoke_test();
