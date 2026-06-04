const jsgui = require('jsgui3-client');
const {controls, Control, mixins} = jsgui;
const {dragable} = mixins;
const {Flowchart_Task, Flowchart_Decision, Flowchart_Connection} = require('./flowchart-controls');
const {SVGArrowCalculator, Point} = require('./svg-arrow-calculator');
const {FlowchartLayoutEngine} = require('./flowchart-layout-engine');
const {Text_Node} = jsgui;

const Active_HTML_Document = require('jsgui3-server/controls/Active_HTML_Document');

// Maybe better to include it within an Active_HTML_Document.

// Is currently a decent demo of a small active control running from the server, activated on the client.
//   This square box is really simple, and it demonstrates the principle of the code for the draggable square box not being all that complex
//   compared to a description of it.

// A container with reorderable internal draggable items could help.

// would be nice to be able to have all code in 1 file...???
//  Though the sever code should be separate.


// Relies on extracting CSS from JS files.
// Usage of windows should be very easy on this level.
// Load flowchart1.json - hardcoded for now since fs is not available in browser bundle
const flowchartData = {
    "nodes": [
        {"id": 1, "type": "task", "label": "Define Task(s)"},
        {"id": 2, "type": "task", "label": "Plan Implementation"},
        {"id": 3, "type": "decision", "label": "Implementation Complete?"},
        {"id": 4, "type": "task", "label": "Fix Issues"},
        {"id": 5, "type": "task", "label": "Test Implementation"}
    ],
    "connections": [
        {"from": 1, "to": 2},
        {"from": 2, "to": 3},
        {"from": 3, "to": 4, "label": "No"},
        {"from": 3, "to": 5, "label": "Yes"},
        {"from": 4, "to": 3}
    ]
};

class Demo_UI extends Active_HTML_Document {
    constructor(spec = {}) {
        spec.__type_name = 'demo_ui';
        super(spec);
        const {context} = this;
        
        this.add_class('demo-ui');

        const compose = () => {
            // Use layout engine to calculate positions
            const layoutEngine = new FlowchartLayoutEngine();
            const {positions, routedConnections} = layoutEngine.layout(
                flowchartData.nodes,
                flowchartData.connections
            );

            // Update node positions with calculated layout
            flowchartData.nodes.forEach(node => {
                if (positions[node.id]) {
                    // Convert to positive coordinates for jsgui3 positioning
                    node.position = [positions[node.id][0] + 400, positions[node.id][1] + 50];
                }
            });

            // Create node map for easy lookup
            const nodeMap = {};
            flowchartData.nodes.forEach(node => {
                nodeMap[node.id] = node;
            });

            // Create controls for each flowchart node
            flowchartData.nodes.forEach((node) => {
                let control;
                let offset_x = 0;
                let offset_y = 0;

                if (node.type === 'task') {
                    control = new Flowchart_Task({
                        context: context,
                        text: node.label
                    });
                    offset_x = 100; // half of 200px width
                    offset_y = 20;  // half of 40px height
                } else if (node.type === 'decision') {
                    control = new Flowchart_Decision({
                        context: context,
                        text: node.label
                    });
                    offset_x = 100; // half of 200px width
                    offset_y = 100; // half of 200px height
                }

                if (control) {
                    // Tag node with HTML data attribute for client-side selection
                    control.dom.attributes['data-node-id'] = node.id;

                    // Position the control centered on its layout position
                    const node_left = node.position[0] - offset_x;
                    const node_top = node.position[1] - offset_y;

                    control.style({
                        position: 'absolute',
                        left: node_left + 'px',
                        top: node_top + 'px'
                    });
                    this.add(control);
                }
            });

            // Create connections using routed segments for straighter lines
            routedConnections.forEach((routedConn) => {
                const connectionControl = new Flowchart_Connection({
                    context: context
                });

                // Tag connection with source and target node IDs
                connectionControl.dom.attributes['data-from'] = routedConn.from;
                connectionControl.dom.attributes['data-to'] = routedConn.to;

                const from_node = nodeMap[routedConn.from];
                const to_node = nodeMap[routedConn.to];

                // Offset connection coordinates by the same amount as node coordinates (+400 x, +50 y)
                const shifted_segments = routedConn.segments.map(segment => ({
                    ...segment,
                    start: [segment.start[0] + 400, segment.start[1] + 50],
                    end: [segment.end[0] + 400, segment.end[1] + 50]
                }));

                // Use the new segment-based routing (layout engine already computes diamond vertices)
                connectionControl.setSegments(shifted_segments, routedConn.label);

                this.add(connectionControl);
            });
        }
        if (!spec.el) {
            compose();
        }
    }

    activate() {
        if (!this.__active) {
            super.activate();
            this._setup_dragging();
        }
    }

    _setup_dragging() {
        if (typeof document === 'undefined') return;

        const nodes = flowchartData.nodes.map(n => {
            const el = document.querySelector(`[data-node-id="${n.id}"]`);
            return {
                id: n.id,
                type: n.type,
                el: el
            };
        }).filter(n => n.el);

        const connections = flowchartData.connections.map(c => {
            const el = document.querySelector(`[data-from="${c.from}"][data-to="${c.to}"]`);
            return {
                from: c.from,
                to: c.to,
                el: el
            };
        }).filter(c => c.el);

        // Helper to get element coordinates relative to demo-ui container
        const get_rect = (el) => {
            const style = window.getComputedStyle(el);
            const left = parseFloat(style.left) || 0;
            const top = parseFloat(style.top) || 0;
            const width = parseFloat(style.width) || el.offsetWidth || 0;
            const height = parseFloat(style.height) || el.offsetHeight || 0;
            return { left, top, width, height, cx: left + width / 2, cy: top + height / 2 };
        };

        // Helper to update connection paths using routed segments
        const update_connections = () => {
            const positions = {};
            const graph_nodes = {};

            nodes.forEach(n => {
                const r = get_rect(n.el);
                // Center coordinate in local space
                positions[n.id] = [r.cx, r.cy];
                graph_nodes[n.id] = {
                    width: r.width,
                    height: n.type === 'decision' ? 200 : r.height, // unrotated decision height
                    type: n.type
                };
            });

            connections.forEach(conn => {
                const from_pos = positions[conn.from];
                const to_pos = positions[conn.to];
                if (!from_pos || !to_pos) return;

                const from_node = graph_nodes[conn.from];
                const to_node = graph_nodes[conn.to];

                const dx = to_pos[0] - from_pos[0];
                const dy = to_pos[1] - from_pos[1];
                const SQRT2 = Math.sqrt(2);

                // Calculate EXIT point using diamond vertex geometry for decisions
                let exit_x, exit_y;
                if (from_node.type === 'decision') {
                    const half_diag = from_node.width * SQRT2 / 2;
                    if (Math.abs(dx) <= half_diag) {
                        exit_x = from_pos[0];
                        exit_y = from_pos[1] + half_diag;
                    } else if (dx > 0) {
                        exit_x = from_pos[0] + half_diag;
                        exit_y = from_pos[1];
                    } else {
                        exit_x = from_pos[0] - half_diag;
                        exit_y = from_pos[1];
                    }
                } else {
                    exit_x = from_pos[0];
                    exit_y = from_pos[1] + from_node.height / 2;
                }

                // Calculate ENTRY point using diamond vertex geometry
                let entry_x, entry_y;
                if (to_node.type === 'decision') {
                    const half_diag = to_node.width * SQRT2 / 2;
                    if (dy >= 0 && Math.abs(dx) <= half_diag) {
                        entry_x = to_pos[0];
                        entry_y = to_pos[1] - half_diag;
                    } else if (dy < 0 && from_pos[0] <= to_pos[0]) {
                        entry_x = to_pos[0] - half_diag;
                        entry_y = to_pos[1];
                    } else if (dy < 0) {
                        entry_x = to_pos[0] + half_diag;
                        entry_y = to_pos[1];
                    } else {
                        entry_x = to_pos[0];
                        entry_y = to_pos[1] - half_diag;
                    }
                } else {
                    entry_x = to_pos[0];
                    entry_y = to_pos[1] - to_node.height / 2;
                }

                // Build route segments
                let segments = [];
                if (Math.abs(exit_x - entry_x) < 1) {
                    // Straight vertical
                    segments = [{ type: 'vertical', start: [exit_x, exit_y], end: [entry_x, entry_y] }];
                } else if (from_node.type === 'decision' && Math.abs(dx) > from_node.width * SQRT2 / 2 && dy >= 0) {
                    // Decision far-lateral exit — L-shaped
                    segments = [
                        { type: 'horizontal', start: [exit_x, exit_y], end: [entry_x, exit_y] },
                        { type: 'vertical', start: [entry_x, exit_y], end: [entry_x, entry_y] }
                    ];
                } else if (dy < 0) {
                    // Backward flow (loop) — route around the outside
                    const loop_margin = 30;
                    const node_half_width = from_node.width / 2;
                    let outer_x;
                    if (from_pos[0] <= to_pos[0]) {
                        outer_x = Math.min(from_pos[0], to_pos[0]) - node_half_width - loop_margin;
                    } else {
                        outer_x = Math.max(from_pos[0], to_pos[0]) + node_half_width + loop_margin;
                    }
                    segments = [
                        { type: 'vertical', start: [exit_x, exit_y], end: [exit_x, exit_y + loop_margin] },
                        { type: 'horizontal', start: [exit_x, exit_y + loop_margin], end: [outer_x, exit_y + loop_margin] },
                        { type: 'vertical', start: [outer_x, exit_y + loop_margin], end: [outer_x, entry_y] },
                        { type: 'horizontal', start: [outer_x, entry_y], end: [entry_x, entry_y] }
                    ];
                } else {
                    // Forward flow with lateral offset — Z-shaped
                    const mid_y = (exit_y + entry_y) / 2;
                    segments = [
                        { type: 'vertical', start: [exit_x, exit_y], end: [exit_x, mid_y] },
                        { type: 'horizontal', start: [exit_x, mid_y], end: [entry_x, mid_y] },
                        { type: 'vertical', start: [entry_x, mid_y], end: [entry_x, entry_y] }
                    ];
                }

                // Recalculate bounding box for segments
                let min_x = Infinity, min_y = Infinity, max_x = -Infinity, max_y = -Infinity;
                segments.forEach(seg => {
                    min_x = Math.min(min_x, seg.start[0], seg.end[0]);
                    min_y = Math.min(min_y, seg.start[1], seg.end[1]);
                    max_x = Math.max(max_x, seg.start[0], seg.end[0]);
                    max_y = Math.max(max_y, seg.start[1], seg.end[1]);
                });

                const padding = 20;
                min_x -= padding;
                min_y -= padding;
                max_x += padding;
                max_y += padding;

                const width = max_x - min_x;
                const height = max_y - min_y;

                let path_data = '';
                segments.forEach((seg, index) => {
                    const start_x = seg.start[0] - min_x;
                    const start_y = seg.start[1] - min_y;
                    const end_x = seg.end[0] - min_x;
                    const end_y = seg.end[1] - min_y;

                    if (index === 0) {
                        path_data += `M ${start_x} ${start_y}`;
                    }
                    path_data += ` L ${end_x} ${end_y}`;
                });

                const svg = conn.el.querySelector('svg');
                const path = conn.el.querySelector('path');
                if (svg && path) {
                    svg.setAttribute('width', width + 'px');
                    svg.setAttribute('height', height + 'px');
                    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
                    path.setAttribute('d', path_data);

                    conn.el.style.left = min_x + 'px';
                    conn.el.style.top = min_y + 'px';
                    conn.el.style.width = width + 'px';
                    conn.el.style.height = height + 'px';
                }
            });
        };

        // Enable dragging on each node element
        nodes.forEach(node => {
            node.el.style.cursor = 'move';
            node.el.style.userSelect = 'none';

            node.el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                e.preventDefault();
                const r = get_rect(node.el);
                const start_x = e.clientX;
                const start_y = e.clientY;

                const on_mouse_move = (move_e) => {
                    const dx = move_e.clientX - start_x;
                    const dy = move_e.clientY - start_y;
                    node.el.style.left = (r.left + dx) + 'px';
                    node.el.style.top = (r.top + dy) + 'px';
                    update_connections();
                };

                const on_mouse_up = () => {
                    document.removeEventListener('mousemove', on_mouse_move);
                    document.removeEventListener('mouseup', on_mouse_up);
                };

                document.addEventListener('mousemove', on_mouse_move);
                document.addEventListener('mouseup', on_mouse_up);
            });
        });
    }
}

// Include this in bundling.
//  Want CSS bundling so that styles are read out from the JS document and compiled to a stylesheet.
/*...*/

//controls.Demo_UI = Demo_UI;

// A css file may be an easier way to get started...?
//  Want to support but not require css in js.

// But need to set up the serving of the CSS both on the server, and on the client.
//  Ofc setting it up on the server first is important - then can that stage set it up in the doc sent to the client?

// Including the CSS from the JS like before.
//  Needs to extract the CSS and serve it as a separate CSS file.
//  Should also have end-to-end regression tests so this does not break again in the future.
//   The code was kind of clunky and got refactored away.
//   

// Would need to parse the JS files to extract the CSS.
//  Maybe could do it an easier way??? Now that it's easy, want a faster way.


Demo_UI.css = `

* {
    margin: 0;
    padding: 0;
}

body {
    overflow-x: hidden;
    overflow-y: hidden;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
}

.demo-ui {
    position: relative;
    width: 100%;
    min-height: 100vh;
}

/* Flowchart Task styles */
.flowchart-task {
    position: absolute;
    width: 200px;
    height: 40px;
    border: 2px solid #27ae60;
    background-color: #d5f4e6;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    color: #2c3e50;
    box-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    transition: all 0.3s ease;
    cursor: pointer;
}

.flowchart-task:hover {
    transform: translateY(-2px);
    box-shadow: 4px 4px 8px rgba(0,0,0,0.2);
    background-color: #c8f7c5 !important;
}

/* Flowchart Decision styles */
.flowchart-decision {
    position: absolute;
    width: 200px;
    height: 200px;
    border: 2px solid #e74c3c;
    background-color: #fadbd8;
    transform: rotate(45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    color: #2c3e50;
    box-shadow: 2px 2px 4px rgba(0,0,0,0.1);
    transition: all 0.3s ease;
    cursor: pointer;
}

.flowchart-decision:hover {
    transform: rotate(45deg) translateY(-2px);
    box-shadow: 4px 4px 8px rgba(0,0,0,0.2);
    background-color: #f8c6c3 !important;
}

/* Decision text container - counter-rotates to keep text horizontal */
.flowchart-decision-text {
    transform: rotate(-45deg);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    width: 100%;
    height: 100%;
    font-family: Arial, sans-serif;
    font-size: 14px;
    font-weight: bold;
    color: #2c3e50;
}

/* Flowchart Connection styles */
.flowchart-connection {
    position: absolute;
    pointer-events: none;
}

.flowchart-arrow {
    width: 100%;
    height: 100%;
}

.flowchart-arrow-path {
    stroke: #3498db;
    stroke-width: 3;
    fill: none;
    marker-end: url(#arrowhead);
}

.flowchart-arrow-marker polygon {
    fill: #3498db;
}
`;

controls.Demo_UI = Demo_UI;
module.exports = jsgui;