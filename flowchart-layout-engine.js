/**
 * Flowchart Layout Engine
 * Implements Sugiyama algorithm for automatic flowchart positioning
 */

class FlowchartLayoutEngine {
  constructor(options = {}) {
    this.options = {
      nodeWidth: 200,
      nodeHeight: 40,
      horizontalSpacing: 50,
      verticalSpacing: 80,
      decisionHeight: 200,
      ...options
    };
  }

  layout(nodes, connections) {
    this.graph = this.buildGraph(nodes, connections);
    const layers = this.assignLayers();
    const orderedLayers = this.orderNodes(layers);
    const positions = this.assignCoordinates(orderedLayers);
    const routedConnections = this.routeEdges(positions, connections);
    return { positions, routedConnections };
  }

  buildGraph(nodes, connections) {
    const graph = {
      nodes: new Map(),
      edges: [],
      adjacencyList: new Map()
    };

    // Convert nodes to graph format
    nodes.forEach(node => {
      graph.nodes.set(node.id, {
        id: node.id,
        type: node.type,
        width: node.type === 'task' ? this.options.nodeWidth : this.options.nodeWidth,
        height: node.type === 'task' ? this.options.nodeHeight : this.options.decisionHeight,
        incoming: [],
        outgoing: []
      });
    });

    // Build edges and adjacency lists
    connections.forEach(conn => {
      const edge = {
        from: conn.from,
        to: conn.to,
        label: conn.label
      };
      graph.edges.push(edge);

      // Update adjacency lists
      if (!graph.adjacencyList.has(conn.from)) {
        graph.adjacencyList.set(conn.from, []);
      }
      graph.adjacencyList.get(conn.from).push(conn.to);

      // Update node degrees
      graph.nodes.get(conn.from).outgoing.push(conn.to);
      graph.nodes.get(conn.to).incoming.push(conn.from);
    });

    return graph;
  }

  assignLayers() {
    const layers = [];
    const visited = new Set();
    const tempVisited = new Set();

    // Find start nodes (no incoming edges)
    const startNodes = Array.from(this.graph.nodes.values())
      .filter(node => node.incoming.length === 0)
      .map(node => node.id);

    // Handle cycles by allowing revisits for back edges
    const assignNodeLayer = (nodeId, currentLayer) => {
      if (visited.has(nodeId)) return;

      if (tempVisited.has(nodeId)) {
        // Cycle detected - this is a back edge, place in same or next layer
        return;
      }

      tempVisited.add(nodeId);

      // Ensure we have enough layers
      while (layers.length <= currentLayer) {
        layers.push([]);
      }

      if (!layers[currentLayer].includes(nodeId)) {
        layers[currentLayer].push(nodeId);
      }

      // Process outgoing edges
      const outgoing = this.graph.adjacencyList.get(nodeId) || [];
      outgoing.forEach(targetId => {
        assignNodeLayer(targetId, currentLayer + 1);
      });

      tempVisited.delete(nodeId);
      visited.add(nodeId);
    };

    startNodes.forEach(nodeId => assignNodeLayer(nodeId, 0));

    // Handle any remaining nodes (cycles)
    Array.from(this.graph.nodes.keys()).forEach(nodeId => {
      if (!visited.has(nodeId)) {
        assignNodeLayer(nodeId, 0);
      }
    });

    return layers;
  }

  orderNodes(layers) {
    // Simple ordering for now - sort by type and ID
    return layers.map(layer =>
      layer.sort((a, b) => {
        const nodeA = this.graph.nodes.get(a);
        const nodeB = this.graph.nodes.get(b);

        // Decisions first, then tasks
        if (nodeA.type !== nodeB.type) {
          return nodeA.type === 'decision' ? -1 : 1;
        }

        return a - b; // Fallback to ID
      })
    );
  }

  assignCoordinates(layers) {
    const positions = {};
    let cumulative_y = 0;

    layers.forEach((layer, layerIndex) => {
      // Calculate layer height based on tallest node type in this layer
      let layerHeight = this.options.nodeHeight;
      if (layer.some(id => this.graph.nodes.get(id).type === 'decision')) {
        layerHeight = this.options.decisionHeight;
      }

      // Layer Y is the center of nodes in this layer (cumulative avoids Y inversions)
      const layerY = cumulative_y + layerHeight / 2;

      // Advance cumulative position for next layer
      cumulative_y += layerHeight + this.options.verticalSpacing;

      // For single nodes in a layer, center them horizontally
      // For multiple nodes, space them out
      if (layer.length === 1) {
        // Single node - center it
        positions[layer[0]] = [0, layerY];
      } else {
        // Multiple nodes - distribute horizontally
        const totalWidth = layer.length * this.options.nodeWidth + (layer.length - 1) * this.options.horizontalSpacing;
        const startX = -totalWidth / 2 + this.options.nodeWidth / 2;

        layer.forEach((nodeId, nodeIndex) => {
          const nodeX = startX + nodeIndex * (this.options.nodeWidth + this.options.horizontalSpacing);
          positions[nodeId] = [nodeX, layerY];
        });
      }
    });

    return positions;
  }

  routeEdges(positions, connections) {
    const SQRT2 = Math.sqrt(2);

    return connections.map(conn => {
      const fromPos = positions[conn.from];
      const toPos = positions[conn.to];

      if (!fromPos || !toPos) return null;

      const fromNode = this.graph.nodes.get(conn.from);
      const toNode = this.graph.nodes.get(conn.to);

      const dx = toPos[0] - fromPos[0];
      const dy = toPos[1] - fromPos[1];

      // Calculate EXIT point from source node using diamond vertex geometry for decisions
      let exit_x, exit_y;
      if (fromNode.type === 'decision') {
        const half_diag = fromNode.width * SQRT2 / 2;
        if (Math.abs(dx) <= half_diag) {
          // Target within diamond lateral span — exit from bottom vertex
          exit_x = fromPos[0];
          exit_y = fromPos[1] + half_diag;
        } else if (dx > 0) {
          // Target far to the right — exit from right vertex
          exit_x = fromPos[0] + half_diag;
          exit_y = fromPos[1];
        } else {
          // Target far to the left — exit from left vertex
          exit_x = fromPos[0] - half_diag;
          exit_y = fromPos[1];
        }
      } else {
        // Task node — always exit from bottom edge
        exit_x = fromPos[0];
        exit_y = fromPos[1] + fromNode.height / 2;
      }

      // Calculate ENTRY point to target node using diamond vertex geometry
      let entry_x, entry_y;
      if (toNode.type === 'decision') {
        const half_diag = toNode.width * SQRT2 / 2;
        if (dy >= 0 && Math.abs(dx) <= half_diag) {
          // Coming from above or same layer, within span — enter from top vertex
          entry_x = toPos[0];
          entry_y = toPos[1] - half_diag;
        } else if (dy < 0 && fromPos[0] <= toPos[0]) {
          // Backward flow from the left — enter from left vertex
          entry_x = toPos[0] - half_diag;
          entry_y = toPos[1];
        } else if (dy < 0) {
          // Backward flow from the right — enter from right vertex
          entry_x = toPos[0] + half_diag;
          entry_y = toPos[1];
        } else {
          // Default — enter from top vertex
          entry_x = toPos[0];
          entry_y = toPos[1] - half_diag;
        }
      } else {
        // Task node — always enter from top edge
        entry_x = toPos[0];
        entry_y = toPos[1] - toNode.height / 2;
      }

      // Case 1: Straight vertical (same X column)
      if (Math.abs(exit_x - entry_x) < 1) {
        return {
          from: conn.from, to: conn.to, label: conn.label,
          segments: [{ type: 'vertical', start: [exit_x, exit_y], end: [entry_x, entry_y] }]
        };
      }

      // Case 2: Decision far-lateral exit (target outside diamond span) — L-shaped route
      if (fromNode.type === 'decision' && Math.abs(dx) > fromNode.width * SQRT2 / 2 && dy >= 0) {
        return {
          from: conn.from, to: conn.to, label: conn.label,
          segments: [
            { type: 'horizontal', start: [exit_x, exit_y], end: [entry_x, exit_y] },
            { type: 'vertical', start: [entry_x, exit_y], end: [entry_x, entry_y] }
          ]
        };
      }

      // Case 3: Backward flow (loop — target is above source)
      if (dy < 0) {
        const loop_margin = 30;
        let outer_x;
        if (fromPos[0] <= toPos[0]) {
          // Source is left of target — route around left side
          outer_x = Math.min(fromPos[0], toPos[0]) - this.options.nodeWidth / 2 - loop_margin;
        } else {
          // Source is right of target — route around right side
          outer_x = Math.max(fromPos[0], toPos[0]) + this.options.nodeWidth / 2 + loop_margin;
        }

        return {
          from: conn.from, to: conn.to, label: conn.label,
          segments: [
            { type: 'vertical', start: [exit_x, exit_y], end: [exit_x, exit_y + loop_margin] },
            { type: 'horizontal', start: [exit_x, exit_y + loop_margin], end: [outer_x, exit_y + loop_margin] },
            { type: 'vertical', start: [outer_x, exit_y + loop_margin], end: [outer_x, entry_y] },
            { type: 'horizontal', start: [outer_x, entry_y], end: [entry_x, entry_y] }
          ]
        };
      }

      // Case 4: Forward flow with lateral offset — Z-shaped route
      const midY = (exit_y + entry_y) / 2;
      return {
        from: conn.from, to: conn.to, label: conn.label,
        segments: [
          { type: 'vertical', start: [exit_x, exit_y], end: [exit_x, midY] },
          { type: 'horizontal', start: [exit_x, midY], end: [entry_x, midY] },
          { type: 'vertical', start: [entry_x, midY], end: [entry_x, entry_y] }
        ]
      };
    }).filter(Boolean);
  }
}

module.exports = {
  FlowchartLayoutEngine
};