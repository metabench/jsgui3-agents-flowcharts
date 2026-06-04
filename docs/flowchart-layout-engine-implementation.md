# Flowchart Layout Engine Implementation Plan

## Overview

This document details how to implement the sophisticated flowchart layout engine within the jsgui3 codebase, integrating it with the existing flowchart controls and rendering system.

## Current Architecture Analysis

### Existing Components
- **client.js**: Contains `Demo_UI` class that loads flowchart data and creates controls
- **flowchart-controls.js**: Defines `Flowchart_Task`, `Flowchart_Decision`, `Flowchart_Connection` classes
- **svg-arrow-calculator.js**: Handles arrow positioning and path calculation
- **flowchart1.json**: Sample data with nodes and connections

### Integration Points
- Layout engine will be called during `Demo_UI.compose()` method
- Positions will be calculated before controls are created
- Connection routing will use layout engine output for straighter lines

## Implementation Plan

### Phase 1: Core Layout Engine

#### 1. Create Layout Engine Module
**File**: `flowchart-layout-engine.js`

```javascript
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
    const graph = this.buildGraph(nodes, connections);
    const layers = this.assignLayers(graph);
    const orderedLayers = this.orderNodes(layers);
    const positions = this.assignCoordinates(orderedLayers);
    const routedConnections = this.routeEdges(positions, connections);
    return { positions, routedConnections };
  }
}
```

#### 2. Graph Building
```javascript
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
```

#### 3. Layer Assignment (Sugiyama Phase 1)
```javascript
assignLayers(graph) {
  const layers = [];
  const visited = new Set();
  const tempVisited = new Set();

  // Find start nodes (no incoming edges)
  const startNodes = Array.from(graph.nodes.values())
    .filter(node => node.incoming.length === 0)
    .map(node => node.id);

  // Assign layers using longest path
  const assignNodeLayer = (nodeId, currentLayer) => {
    if (visited.has(nodeId)) return;

    const node = graph.nodes.get(nodeId);
    const layerIndex = Math.max(currentLayer, layers.length);

    if (!layers[layerIndex]) {
      layers[layerIndex] = [];
    }

    if (!layers[layerIndex].includes(nodeId)) {
      layers[layerIndex].push(nodeId);
    }

    visited.add(nodeId);

    // Process outgoing edges
    const outgoing = graph.adjacencyList.get(nodeId) || [];
    outgoing.forEach(targetId => {
      assignNodeLayer(targetId, layerIndex + 1);
    });
  };

  startNodes.forEach(nodeId => assignNodeLayer(nodeId, 0));

  return layers;
}
```

#### 4. Node Ordering (Sugiyama Phase 2)
```javascript
orderNodes(layers) {
  // Simple ordering for now - can be enhanced with crossing minimization
  return layers.map(layer =>
    layer.sort((a, b) => {
      // Sort by node type and connections
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
```

#### 5. Coordinate Assignment (Sugiyama Phase 3)
```javascript
assignCoordinates(layers) {
  const positions = {};

  layers.forEach((layer, layerIndex) => {
    const layerY = layerIndex * (this.options.verticalSpacing + this.options.nodeHeight);

    layer.forEach((nodeId, nodeIndex) => {
      const node = this.graph.nodes.get(nodeId);
      const layerWidth = layer.length * (this.options.nodeWidth + this.options.horizontalSpacing);
      const startX = -layerWidth / 2;

      const nodeX = startX + nodeIndex * (this.options.nodeWidth + this.options.horizontalSpacing) + this.options.nodeWidth / 2;

      positions[nodeId] = [nodeX, layerY];
    });
  });

  return positions;
}
```

### Phase 2: Edge Routing

#### 6. Connection Routing
```javascript
routeEdges(positions, connections) {
  return connections.map(conn => {
    const fromPos = positions[conn.from];
    const toPos = positions[conn.to];

    if (!fromPos || !toPos) return null;

    // For straight vertical connections
    if (Math.abs(fromPos[0] - toPos[0]) < 10) {
      return {
        from: conn.from,
        to: conn.to,
        segments: [{
          type: 'vertical',
          start: [fromPos[0], fromPos[1] + this.options.nodeHeight/2],
          end: [toPos[0], toPos[1] - this.options.nodeHeight/2]
        }]
      };
    }

    // For branching connections (L-shaped)
    const midY = (fromPos[1] + toPos[1]) / 2;
    return {
      from: conn.from,
      to: conn.to,
      segments: [
        {
          type: 'vertical',
          start: [fromPos[0], fromPos[1] + this.options.nodeHeight/2],
          end: [fromPos[0], midY]
        },
        {
          type: 'horizontal',
          start: [fromPos[0], midY],
          end: [toPos[0], midY]
        },
        {
          type: 'vertical',
          start: [toPos[0], midY],
          end: [toPos[0], toPos[1] - this.options.nodeHeight/2]
        }
      ]
    };
  }).filter(Boolean);
}
```

### Phase 3: Integration with jsgui3

#### 7. Update client.js
```javascript
const {FlowchartLayoutEngine} = require('./flowchart-layout-engine');

class Demo_UI extends Active_HTML_Document {
  constructor(spec = {}) {
    // ... existing constructor code ...

    const compose = () => {
      // Load flowchart data
      const flowchartData = { /* ... */ };

      // Create layout engine and calculate positions
      const layoutEngine = new FlowchartLayoutEngine();
      const {positions, routedConnections} = layoutEngine.layout(
        flowchartData.nodes,
        flowchartData.connections
      );

      // Update node positions in data
      flowchartData.nodes.forEach(node => {
        if (positions[node.id]) {
          node.position = positions[node.id];
        }
      });

      // Create controls with calculated positions
      flowchartData.nodes.forEach((node) => {
        // ... existing control creation code ...
      });

      // Create connections using routed data
      routedConnections.forEach((routedConn) => {
        const connectionControl = new Flowchart_Connection({
          context: context
        });

        // Use routed segments for straighter lines
        // Implementation depends on updating Flowchart_Connection
        // to accept segment data instead of just start/end points

        this.add(connectionControl);
      });
    };
  }
}
```

#### 8. Update Flowchart_Connection for Segment-Based Routing
```javascript
class Flowchart_Connection extends Control {
  // ... existing constructor ...

  setSegments(segments) {
    // Create SVG path from segments
    let pathData = '';

    segments.forEach((segment, index) => {
      if (index === 0) {
        pathData += `M ${segment.start[0]} ${segment.start[1]}`;
      }

      if (segment.type === 'vertical') {
        pathData += ` L ${segment.end[0]} ${segment.end[1]}`;
      } else if (segment.type === 'horizontal') {
        pathData += ` L ${segment.end[0]} ${segment.end[1]}`;
      }
    });

    // Update SVG path
    this.path.dom.attributes.d = pathData;

    // Calculate bounding box for all segments
    // ... bounding box calculation ...
  }
}
```

### Phase 4: Testing and Refinement

#### 9. Unit Tests
```javascript
// Test layout engine
describe('FlowchartLayoutEngine', () => {
  test('should assign correct layers', () => {
    const engine = new FlowchartLayoutEngine();
    const nodes = [
      {id: 1, type: 'task'},
      {id: 2, type: 'task'},
      {id: 3, type: 'decision'}
    ];
    const connections = [
      {from: 1, to: 2},
      {from: 2, to: 3}
    ];

    const {positions} = engine.layout(nodes, connections);

    expect(positions[1][1]).toBeLessThan(positions[2][1]); // Layer ordering
    expect(positions[2][1]).toBeLessThan(positions[3][1]);
  });
});
```

#### 10. Integration Tests
- Test with `render_html.js` to verify visual output
- Compare layouts with different algorithms
- Performance testing for large flowcharts

## Migration Strategy

### Gradual Rollout
1. **Phase 1**: Implement layout engine alongside existing manual positioning
2. **Phase 2**: Add toggle to switch between manual and automatic layout
3. **Phase 3**: Make automatic layout the default
4. **Phase 4**: Remove manual positioning code

### Backward Compatibility
- Keep existing `position` field in JSON as fallback
- Allow manual override of automatic positioning
- Preserve custom styling and spacing preferences

## Performance Optimizations

### Caching
- Cache layout results for unchanged flowcharts
- Store intermediate graph structures
- Memoize expensive calculations

### Incremental Updates
- Only recalculate layout for changed nodes/connections
- Update positions incrementally rather than full recalculation
- Lazy evaluation of edge routing

## Future Enhancements

### Advanced Features
- **Interactive Layout**: Allow drag-and-drop with automatic repositioning
- **Layout Constraints**: User-defined positioning rules
- **Animation**: Smooth transitions between layout changes
- **Multiple Algorithms**: Support for different layout approaches

### Integration Improvements
- **Real-time Layout**: Update layout as user edits flowchart
- **Layout Presets**: Save and reuse layout configurations
- **Export Options**: Generate layout data for other tools

## Quality Assurance

### Metrics to Track
- **Layout Quality**: Edge straightness, crossing minimization
- **Performance**: Layout calculation time
- **User Experience**: Visual appeal and readability

### Testing Strategy
- **Unit Tests**: Individual algorithm components
- **Integration Tests**: Full layout pipeline
- **Visual Tests**: Screenshot comparisons
- **Performance Tests**: Large flowchart handling

This implementation plan provides a comprehensive roadmap for integrating a sophisticated flowchart layout engine into the jsgui3 codebase, resulting in straighter lines and more professional-looking diagrams.