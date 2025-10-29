# ReactiveArray

## Overview

`ReactiveArray` is a specialized array implementation that extends the native JavaScript Array with reactive capabilities for data binding and automatic UI updates. It integrates seamlessly with jsgui3's data binding system to provide observable array mutations that automatically trigger DOM updates in bound templates.

## Architecture

`ReactiveArray` combines three key capabilities:

1. **Array Interface**: Full compatibility with native Array methods
2. **Change Detection**: Observable mutations that emit events
3. **Template Integration**: Automatic DOM updates for bound collections

## Constructor

```javascript
class ReactiveArray extends Array {
    constructor(items = [], binding_context = null, item_template = '', container_control = null) {
        super(...items);

        this.binding_context = binding_context;
        this.item_template = item_template;
        this.container_control = container_control;

        this.item_controls = new Map(); // Maps array indices to rendered controls
        this._setup_reactive_methods();
    }
}
```

## Key Features

### Reactive Method Overrides

All mutating array methods are overridden to emit change events:

```javascript
_setup_reactive_methods() {
    const methods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];

    methods.forEach(method => {
        const original = this[method];
        this[method] = (...args) => {
            const result = original.apply(this, args);
            this._emit_change(method, args, result);
            return result;
        };
    });
}
```

### Change Event Emission

```javascript
_emit_change(method, args, result) {
    const change_event = {
        type: 'array-mutation',
        method: method,
        args: args,
        result: result,
        array: this,
        timestamp: Date.now()
    };

    // Emit on the array itself
    this.emit('change', change_event);

    // Emit on binding context if available
    if (this.binding_context) {
        this.binding_context.handle_array_mutation(change_event);
    }
}
```

## Core Methods

### set_template(template, container)

Configures the template and container for automatic rendering.

```javascript
set_template(template, container) {
    this.item_template = template;
    this.container_control = container;

    // Initial render
    this.render_items();
}
```

### render_items()

Renders all array items using the configured template.

```javascript
async render_items() {
    if (!this.item_template || !this.container_control) {
        console.warn('ReactiveArray: template or container not set');
        return;
    }

    // Clear existing rendered items
    this._clear_rendered_items();

    // Render each item
    for (let i = 0; i < this.length; i++) {
        await this._render_item(i);
    }
}
```

### _render_item(index)

Renders a single item at the specified index.

```javascript
async _render_item(index) {
    const item_data = this[index];
    if (!item_data) return;

    // Create item context with array metadata
    const item_context = {
        ...this.binding_context?.data_model,
        item: item_data,
        index: index,
        first: index === 0,
        last: index === this.length - 1,
        even: index % 2 === 0,
        odd: index % 2 === 1
    };

    try {
        // Parse and mount item template
        const result = await parse_mount_reactive(
            this.item_template,
            this.container_control,
            this.container_control.context?.control_set,
            item_context
        );

        // Store reference to rendered controls
        this.item_controls.set(index, result.controls);

        // Add controls to container
        result.controls.forEach(control => {
            this.container_control.add(control);
        });

    } catch (error) {
        console.error(`Error rendering item at index ${index}:`, error);
    }
}
```

### update_item(index, new_data)

Updates a specific item and re-renders it.

```javascript
update_item(index, new_data) {
    if (index < 0 || index >= this.length) {
        throw new Error(`Index ${index} out of bounds`);
    }

    this[index] = new_data;
    this._update_item_rendering(index);
}
```

### _update_item_rendering(index)

Efficiently updates the rendering of a single item.

```javascript
_update_item_rendering(index) {
    // Remove existing controls for this item
    const existing_controls = this.item_controls.get(index);
    if (existing_controls) {
        existing_controls.forEach(control => {
            if (control.parent) {
                control.parent.remove(control);
            }
        });
    }

    // Re-render the item
    this._render_item(index);
}
```

### _clear_rendered_items()

Clears all rendered controls from the container.

```javascript
_clear_rendered_items() {
    this.item_controls.forEach(controls => {
        controls.forEach(control => {
            if (control.parent) {
                control.parent.remove(control);
            }
        });
    });

    this.item_controls.clear();
}
```

## Array Method Overrides

### push(...items)

Adds items to the end of the array.

```javascript
push(...items) {
    const result = super.push(...items);

    // Render new items
    for (let i = result - items.length; i < result; i++) {
        this._render_item(i);
    }

    this._emit_change('push', items, result);
    return result;
}
```

### pop()

Removes and returns the last item.

```javascript
pop() {
    const removed_item = super.pop();

    if (removed_item !== undefined) {
        // Remove rendered controls
        const last_index = this.length;
        const controls = this.item_controls.get(last_index);
        if (controls) {
            controls.forEach(control => {
                if (control.parent) {
                    control.parent.remove(control);
                }
            });
            this.item_controls.delete(last_index);
        }

        this._emit_change('pop', [], removed_item);
    }

    return removed_item;
}
```

### splice(start, deleteCount, ...items)

Changes the contents of the array by removing or replacing elements.

```javascript
splice(start, deleteCount, ...items) {
    // Store original length for re-indexing
    const original_length = this.length;

    const result = super.splice(start, deleteCount, ...items);

    // Handle deletions
    for (let i = 0; i < deleteCount; i++) {
        const index = start + i;
        const controls = this.item_controls.get(index);
        if (controls) {
            controls.forEach(control => {
                if (control.parent) {
                    control.parent.remove(control);
                }
            });
        }
    }

    // Re-index remaining items
    this._reindex_items(start);

    // Render new items
    const new_items_count = items.length;
    for (let i = 0; i < new_items_count; i++) {
        this._render_item(start + i);
    }

    this._emit_change('splice', [start, deleteCount, ...items], result);
    return result;
}
```

### _reindex_items(start_index)

Re-indexes rendered controls after array mutations.

```javascript
_reindex_items(start_index) {
    const new_controls = new Map();

    this.item_controls.forEach((controls, old_index) => {
        if (old_index >= start_index) {
            const new_index = old_index + (this.length - (old_index + 1));
            if (new_index >= 0 && new_index < this.length) {
                new_controls.set(new_index, controls);
            }
        } else {
            new_controls.set(old_index, controls);
        }
    });

    this.item_controls = new_controls;
}
```

## Advanced Features

### Sorting and Reversing

```javascript
sort(compareFn) {
    const result = super.sort(compareFn);

    // Full re-render for sorting (could be optimized)
    this.render_items();

    this._emit_change('sort', [compareFn], result);
    return result;
}

reverse() {
    const result = super.reverse();

    // Re-index all items
    this._reindex_all_items();

    this._emit_change('reverse', [], result);
    return result;
}
```

### Filtering and Mapping

```javascript
// Create filtered reactive array
filter(predicate) {
    const filtered = new ReactiveArray(
        super.filter(predicate),
        this.binding_context
    );

    // Set up reactive filtering
    this.on('change', () => {
        const new_filtered = super.filter(predicate);
        filtered.splice(0, filtered.length, ...new_filtered);
    });

    return filtered;
}

// Create mapped reactive array
map(callback) {
    const mapped = new ReactiveArray(
        super.map(callback),
        this.binding_context
    );

    // Set up reactive mapping
    this.on('change', () => {
        const new_mapped = super.map(callback);
        mapped.splice(0, mapped.length, ...new_mapped);
    });

    return mapped;
}
```

## Integration with Data Binding

### Template Usage

```html
<!-- Basic list rendering -->
<ul data-bind-each="items">
  <li data-bind="item.name"></li>
</ul>

<!-- With conditional rendering -->
<ul data-bind-each="items">
  <li data-bind="item.name" data-bind-if="item.visible"></li>
</ul>

<!-- Complex item templates -->
<div data-bind-each="products">
  <div class="product-card">
    <h3 data-bind="item.name"></h3>
    <p data-bind="item.description"></p>
    <span data-bind="'$' + item.price"></span>
    <button data-bind-click="add_to_cart(item)">Add to Cart</button>
  </div>
</div>
```

### Programmatic Usage

```javascript
// Create reactive array
const items = new ReactiveArray([
    { id: 1, name: 'Item 1', visible: true },
    { id: 2, name: 'Item 2', visible: false }
]);

// Set up template rendering
items.set_template(
    '<li data-bind="item.name" data-bind-if="item.visible"></li>',
    list_container_control
);

// Reactive operations
items.push({ id: 3, name: 'Item 3', visible: true }); // Auto-renders
items[1].visible = true; // Triggers re-render of item 2
items.splice(0, 1); // Removes first item and re-renders
```

## Performance Optimizations

### Batching Updates

```javascript
// Batch multiple operations
batch_update(callback) {
    this._batch_mode = true;
    this._batch_changes = [];

    try {
        callback();
    } finally {
        this._batch_mode = false;

        if (this._batch_changes.length > 0) {
            this._emit_batch_changes();
        }
    }
}

_emit_change(method, args, result) {
    if (this._batch_mode) {
        this._batch_changes.push({ method, args, result });
    } else {
        // Normal emission
        super._emit_change(method, args, result);
    }
}

_emit_batch_changes() {
    // Emit single batch event
    this.emit('batch-change', {
        type: 'batch-mutation',
        changes: this._batch_changes,
        array: this
    });

    this._batch_changes = [];
}
```

### Selective Re-rendering

```javascript
// Only re-render changed items
update_range(start, end) {
    for (let i = start; i <= end; i++) {
        this._update_item_rendering(i);
    }
}

// Smart diffing for large arrays
smart_update(new_items) {
    // Calculate minimal changes needed
    const diff = this._calculate_diff(this, new_items);

    // Apply minimal updates
    diff.forEach(change => {
        switch (change.type) {
            case 'add':
                this.splice(change.index, 0, change.item);
                break;
            case 'remove':
                this.splice(change.index, 1);
                break;
            case 'update':
                this.update_item(change.index, change.item);
                break;
        }
    });
}
```

## Flowchart Control Integration

`ReactiveArray` is crucial for the Flowchart Control's dynamic node and connection management:

```javascript
class FlowchartControl extends TemplateControl {
    constructor(spec) {
        super(spec);

        // Reactive arrays for nodes and connections
        this.data_context.nodes = new ReactiveArray([], this.binding_context);
        this.data_context.connections = new ReactiveArray([], this.binding_context);

        // Set up templates
        this.data_context.nodes.set_template(`
            <div class="flowchart-node"
                 data-bind-style="'left: ' + item.x + 'px; top: ' + item.y + 'px'"
                 data-bind-class="{'selected': item.selected}"
                 data-bind="item.text">
            </div>
        `, this.node_container);

        this.data_context.connections.set_template(`
            <svg class="flowchart-connection">
                <line data-bind="connection_path(item)"></line>
            </svg>
        `, this.connection_container);
    }

    add_node(node_data) {
        this.data_context.nodes.push({
            id: Date.now(),
            x: node_data.x,
            y: node_data.y,
            text: node_data.text || 'New Node',
            selected: false
        });
    }

    remove_node(node_id) {
        const index = this.data_context.nodes.findIndex(n => n.id === node_id);
        if (index > -1) {
            this.data_context.nodes.splice(index, 1);

            // Also remove connections to this node
            const connections_to_remove = [];
            this.data_context.connections.forEach((conn, conn_index) => {
                if (conn.from === node_id || conn.to === node_id) {
                    connections_to_remove.push(conn_index);
                }
            });

            // Remove in reverse order to maintain indices
            connections_to_remove.reverse().forEach(index => {
                this.data_context.connections.splice(index, 1);
            });
        }
    }

    connection_path(connection) {
        const from_node = this.data_context.nodes.find(n => n.id === connection.from);
        const to_node = this.data_context.nodes.find(n => n.id === connection.to);

        if (from_node && to_node) {
            return `x1="${from_node.x + 50}" y1="${from_node.y + 25}" x2="${to_node.x + 50}" y2="${to_node.y + 25}"`;
        }

        return '';
    }
}
```

## Error Handling

### Template Rendering Errors

```javascript
async _render_item(index) {
    try {
        // ... rendering logic
    } catch (error) {
        console.error(`ReactiveArray render error at index ${index}:`, error);

        // Render error placeholder
        this._render_error_item(index, error);
    }
}

_render_error_item(index, error) {
    const error_control = new Control({
        text: `Error rendering item ${index}: ${error.message}`
    });

    this.item_controls.set(index, [error_control]);
    this.container_control.add(error_control);
}
```

### Array Operation Validation

```javascript
push(...items) {
    // Validate items
    items.forEach((item, i) => {
        if (!this._validate_item(item)) {
            throw new Error(`Invalid item at index ${i} in push operation`);
        }
    });

    const result = super.push(...items);
    this._emit_change('push', items, result);
    return result;
}

_validate_item(item) {
    // Item validation logic
    return item && typeof item === 'object';
}
```

## Testing

### Unit Tests

```javascript
describe('ReactiveArray', () => {
    it('should emit change events on push', () => {
        const array = new ReactiveArray();
        const changes = [];

        array.on('change', change => changes.push(change));

        array.push('item1', 'item2');

        expect(changes).toHaveLength(1);
        expect(changes[0].method).toBe('push');
        expect(changes[0].args).toEqual(['item1', 'item2']);
    });

    it('should render items with template', async () => {
        const container = new Control();
        const array = new ReactiveArray(['item1', 'item2']);

        array.set_template('<div data-bind="item"></div>', container);

        // Wait for rendering
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(container.content._arr).toHaveLength(2);
        expect(container.content._arr[0].text).toBe('item1');
    });

    it('should handle splice operations correctly', () => {
        const array = new ReactiveArray([1, 2, 3, 4, 5]);
        const changes = [];

        array.on('change', change => changes.push(change));

        array.splice(1, 2, 'a', 'b');

        expect(array).toEqual([1, 'a', 'b', 4, 5]);
        expect(changes[0].method).toBe('splice');
    });
});
```

### Integration Tests

```javascript
describe('ReactiveArray Integration', () => {
    it('should work with data binding', async () => {
        const data_context = { items: new ReactiveArray(['a', 'b']) };
        const template = '<ul data-bind-each="items"><li data-bind="item"></li></ul>';
        const control = new TemplateControl({ template, data_context });

        await control.render_template();

        // Check initial rendering
        const list_items = control.dom.el.querySelectorAll('li');
        expect(list_items).toHaveLength(2);

        // Test reactive updates
        data_context.items.push('c');
        await next_tick();

        const updated_items = control.dom.el.querySelectorAll('li');
        expect(updated_items).toHaveLength(3);
    });
});
```

## Best Practices

### Memory Management

```javascript
// Clean up when no longer needed
destroy() {
    this._clear_rendered_items();

    // Remove all event listeners
    this.removeAllListeners();

    // Clear references
    this.binding_context = null;
    this.container_control = null;
    this.item_template = '';
}
```

### Performance Tips

```javascript
// Use batch updates for multiple operations
array.batch_update(() => {
    array.push(item1);
    array.push(item2);
    array.splice(0, 1);
}); // Only triggers one render

// For large arrays, consider virtualization
class VirtualReactiveArray extends ReactiveArray {
    constructor(items, binding_context, viewport_size = 50) {
        super(items, binding_context);
        this.viewport_size = viewport_size;
        this.viewport_start = 0;
    }

    // Only render visible items
    render_viewport() {
        const end = Math.min(this.viewport_start + this.viewport_size, this.length);
        for (let i = this.viewport_start; i < end; i++) {
            this._render_item(i);
        }
    }
}
```

## Conclusion

`ReactiveArray` provides the foundation for reactive collection management in jsgui3's data binding system. By combining observable array operations with automatic template rendering, it enables efficient, declarative UI updates for dynamic lists and collections. Its integration with the Flowchart Control demonstrates its power for managing complex, interactive data structures that require real-time UI synchronization.</content>
<parameter name="filePath">c:\Users\james\Documents\repos\jsgui3-agents-flowcharts\docs\ReactiveArray.md