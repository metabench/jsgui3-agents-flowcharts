# BindingContext

## Overview

The `BindingContext` is a core component of the jsgui3 data binding system that manages the relationship between declarative templates and reactive data models. It serves as the orchestrator for applying data binding directives, handling reactive updates, and maintaining synchronization between the template DOM and underlying data structures.

## Architecture

The `BindingContext` operates as a bridge between three main components:

1. **Data Models**: Observable data structures from lang-tools (Data_Value, Data_Object)
2. **Template Controls**: jsgui3 controls instantiated from parse-mount templates
3. **Binding Directives**: Declarative syntax for specifying data relationships

## Core Responsibilities

- Parse and apply binding expressions to controls
- Maintain reactive synchronization between data and DOM
- Handle different binding modes (one-way, two-way)
- Manage lifecycle of bindings (creation, updates, cleanup)
- Provide debugging and introspection capabilities

## Constructor

```javascript
class BindingContext {
    constructor(data_model, template_context, options = {}) {
        this.data_model = data_model;
        this.template_context = template_context;
        this.options = {
            debug: false,
            strict: true,
            batch_updates: true,
            ...options
        };

        this.bindings = new Map(); // control -> binding info
        this.data_bindings = new Map(); // data_path -> Set of controls
        this.pending_updates = new Set();
        this.update_scheduled = false;

        this.setup_reactive_listeners();
        this.setup_template_listeners();
    }
}
```

## Key Methods

### setup_reactive_listeners()

Sets up listeners for data model changes to trigger UI updates.

```javascript
setup_reactive_listeners() {
    // Listen to Data_Object/Data_Value change events
    this.data_model.on('change', (e) => {
        this.handle_data_change(e);
    });

    // Listen to deep changes for nested objects
    this.data_model.on('deep-change', (e) => {
        this.handle_deep_change(e);
    });

    // Listen to array mutations
    this.data_model.on('array-mutation', (e) => {
        this.handle_array_mutation(e);
    });
}
```

### apply_bindings_to_control(control, bindings)

Applies binding directives to a control instance.

```javascript
apply_bindings_to_control(control, bindings) {
    const binding_info = {
        control: control,
        bindings: {},
        cleanup: []
    };

    Object.entries(bindings).forEach(([directive, expression]) => {
        const binding = this.parse_binding_directive(directive, expression);
        binding_info.bindings[directive] = binding;

        // Apply the binding
        this.apply_single_binding(control, binding);

        // Store cleanup functions
        binding_info.cleanup.push(() => this.remove_single_binding(control, binding));
    });

    this.bindings.set(control, binding_info);

    // Register data dependencies
    this.register_data_dependencies(control, Object.values(binding_info.bindings));
}
```

### parse_binding_directive(directive, expression)

Parses binding directives like `data-bind`, `data-bind-click`, etc.

```javascript
parse_binding_directive(directive, expression) {
    const binding_types = {
        'bind': 'data',
        'click': 'event',
        'each': 'collection',
        'if': 'conditional',
        'class': 'style',
        'style': 'style'
    };

    const type = binding_types[directive] || 'data';
    const parsed_expr = this.parse_binding_expression(expression);

    return {
        type: type,
        directive: directive,
        expression: expression,
        parsed: parsed_expr,
        paths: this.extract_data_paths(parsed_expr)
    };
}
```

### parse_binding_expression(expression)

Parses complex binding expressions with support for:
- Property access: `user.name`
- Transforms: `user.name | uppercase`
- Complex expressions: `user.age + ' years old'`

```javascript
parse_binding_expression(expr) {
    // Handle transform pipes
    const parts = expr.split('|').map(s => s.trim());
    const data_expr = parts[0];
    const transforms = parts.slice(1);

    // Parse the data access part
    const data_access = this.parse_data_access(data_expr);

    return {
        data_access: data_access,
        transforms: transforms,
        evaluate: (context) => {
            let value = this.evaluate_data_access(data_access, context);
            value = this.apply_transforms(value, transforms);
            return value;
        }
    };
}
```

### handle_data_change(change_event)

Processes data model changes and updates bound controls.

```javascript
handle_data_change(change_event) {
    const { name: changed_path, value, old: old_value, type } = change_event;

    // Find all controls bound to this path or related paths
    const affected_controls = this.find_affected_controls(changed_path);

    if (this.options.batch_updates) {
        // Batch updates for performance
        affected_controls.forEach(control => this.pending_updates.add(control));

        if (!this.update_scheduled) {
            this.update_scheduled = true;
            requestAnimationFrame(() => this.process_pending_updates());
        }
    } else {
        // Immediate updates
        affected_controls.forEach(control => {
            this.update_control_binding(control, changed_path, value, old_value);
        });
    }
}
```

### update_control_binding(control, changed_path, new_value, old_value)

Updates a specific control's binding when data changes.

```javascript
update_control_binding(control, changed_path, new_value, old_value) {
    const binding_info = this.bindings.get(control);
    if (!binding_info) return;

    // Check each binding on this control
    Object.values(binding_info.bindings).forEach(binding => {
        if (this.binding_depends_on_path(binding, changed_path)) {
            this.apply_binding_update(control, binding);
        }
    });
}
```

## Binding Types

### Data Bindings (`data-bind`)

One-way and two-way data synchronization.

```javascript
apply_data_binding(control, binding) {
    const { parsed, mode = 'one-way' } = binding;

    // Initial sync: data -> control
    this.sync_data_to_control(control, binding);

    if (mode === 'two-way') {
        // Set up control -> data sync
        this.setup_control_to_data_sync(control, binding);
    }

    // Listen for data changes
    const data_listener = (e) => {
        if (this.binding_depends_on_path(binding, e.name)) {
            this.sync_data_to_control(control, binding);
        }
    };

    this.data_model.on('change', data_listener);
    binding.cleanup = () => this.data_model.off('change', data_listener);
}
```

### Event Bindings (`data-bind-click`, etc.)

Method binding for control events.

```javascript
apply_event_binding(control, binding) {
    const { directive, expression } = binding;
    const event_name = directive.replace('bind-', ''); // 'click' from 'bind-click'

    const handler = (e) => {
        // Parse method call expression like "saveUser()" or "increment(item)"
        const method_call = this.parse_method_call(expression);
        const method = this.resolve_method(method_call.name);

        if (method) {
            method.apply(this.template_context, method_call.args);
        }
    };

    control.on(event_name, handler);
    binding.cleanup = () => control.off(event_name, handler);
}
```

### Collection Bindings (`data-bind-each`)

Reactive list rendering.

```javascript
apply_collection_binding(control, binding) {
    const { expression, item_template } = binding;

    // Get the collection data
    const collection = this.evaluate_expression(expression, this.data_model);

    // Create a ReactiveArray if not already
    if (!(collection instanceof ReactiveArray)) {
        collection = new ReactiveArray(...collection);
        // Replace in data model
        this.set_nested_value(this.data_model, binding.parsed.data_access.path, collection);
    }

    // Set up the collection rendering
    collection.set_template(item_template, control);
    collection.render_items();

    // Listen for collection changes
    const collection_listener = () => collection.render_items();
    collection.on('change', collection_listener);

    binding.cleanup = () => collection.off('change', collection_listener);
}
```

### Conditional Bindings (`data-bind-if`)

Conditional rendering based on reactive conditions.

```javascript
apply_conditional_binding(control, binding) {
    const { expression } = binding;

    const update_visibility = () => {
        const condition = this.evaluate_expression(expression, this.data_model);
        control.style.display = condition ? '' : 'none';
    };

    // Initial check
    update_visibility();

    // Listen for relevant data changes
    const condition_listener = (e) => {
        if (this.binding_depends_on_path(binding, e.name)) {
            update_visibility();
        }
    };

    this.data_model.on('change', condition_listener);
    binding.cleanup = () => this.data_model.off('change', condition_listener);
}
```

## Advanced Features

### Expression Evaluation

Safe evaluation of complex expressions.

```javascript
evaluate_expression(expression, context) {
    // Use ExpressionParser for complex expressions
    return ExpressionParser.evaluate(expression, context);
}
```

### Transform Pipeline

Support for expression transforms like `| uppercase`, `| currency`, etc.

```javascript
apply_transforms(value, transforms) {
    return transforms.reduce((val, transform) => {
        const transform_fn = this.resolve_transform(transform);
        return transform_fn ? transform_fn(val) : val;
    }, value);
}

resolve_transform(transform_name) {
    // Built-in transforms
    const built_ins = {
        uppercase: (v) => String(v).toUpperCase(),
        lowercase: (v) => String(v).toLowerCase(),
        currency: (v) => `$${Number(v).toFixed(2)}`,
        json: (v) => JSON.stringify(v, null, 2)
    };

    return built_ins[transform_name] ||
           this.template_context.transforms?.[transform_name];
}
```

### Debugging and Introspection

```javascript
get_binding_info(control) {
    return this.bindings.get(control);
}

get_data_dependencies(control) {
    const info = this.bindings.get(control);
    if (!info) return [];

    return Object.values(info.bindings).flatMap(binding =>
        binding.paths || []
    );
}

log_binding_status() {
    if (!this.options.debug) return;

    console.group('BindingContext Status');
    console.log('Active bindings:', this.bindings.size);
    console.log('Data bindings:', this.data_bindings.size);

    this.bindings.forEach((info, control) => {
        console.log(`Control ${control.constructor.name}:`, Object.keys(info.bindings));
    });
    console.groupEnd();
}
```

## Integration with Flowchart Control

The `BindingContext` is particularly important for the Flowchart Control:

```javascript
// Flowchart data binding setup
const flowchart_data = reactive({
    nodes: [
        { id: 'node1', x: 100, y: 100, text: 'Start' },
        { id: 'node2', x: 300, y: 100, text: 'Process' }
    ],
    connections: [
        { from: 'node1', to: 'node2' }
    ]
});

const binding_context = new BindingContext(flowchart_data, flowchart_control);

// Bind node positions (critical for drag-and-drop)
flowchart_control.nodes.forEach(node_control => {
    binding_context.apply_bindings_to_control(node_control, {
        style: `left: ${node_control.node_data.x}px; top: ${node_control.node_data.y}px`
    });
});
```

## Performance Optimizations

### Update Batching

```javascript
process_pending_updates() {
    this.update_scheduled = false;

    // Group updates by control for efficiency
    const updates_by_control = new Map();

    this.pending_updates.forEach(control => {
        const info = this.bindings.get(control);
        if (info) {
            updates_by_control.set(control, info);
        }
    });

    this.pending_updates.clear();

    // Process batched updates
    updates_by_control.forEach((info, control) => {
        this.update_control_all_bindings(control, info);
    });
}
```

### Selective Updates

```javascript
find_affected_controls(changed_path) {
    const affected = new Set();

    // Direct path matches
    if (this.data_bindings.has(changed_path)) {
        this.data_bindings.get(changed_path).forEach(control => affected.add(control));
    }

    // Related paths (e.g., 'user' affects 'user.name')
    this.data_bindings.forEach((controls, path) => {
        if (this.paths_related(changed_path, path)) {
            controls.forEach(control => affected.add(control));
        }
    });

    return affected;
}
```

## Error Handling

```javascript
safe_evaluate_binding(binding, context) {
    try {
        return binding.parsed.evaluate(context);
    } catch (error) {
        if (this.options.strict) {
            throw error;
        }

        console.warn('Binding evaluation error:', error, binding);
        return undefined;
    }
}
```

## Lifecycle Management

### Cleanup

```javascript
destroy() {
    // Clean up all bindings
    this.bindings.forEach(info => {
        info.cleanup.forEach(cleanup_fn => cleanup_fn());
    });

    this.bindings.clear();
    this.data_bindings.clear();
    this.pending_updates.clear();

    // Remove listeners
    if (this.data_model && this.data_model.off) {
        this.data_model.off('change', this.handle_data_change);
        this.data_model.off('deep-change', this.handle_deep_change);
        this.data_model.off('array-mutation', this.handle_array_mutation);
    }
}
```

## Testing

### Unit Tests

```javascript
describe('BindingContext', () => {
    it('should apply data bindings correctly', () => {
        const data = { name: 'Alice' };
        const control = { text: '' };
        const context = new BindingContext(data);

        context.apply_bindings_to_control(control, { bind: 'name' });

        expect(control.text).toBe('Alice');

        data.name = 'Bob';
        // Trigger change event
        context.handle_data_change({ name: 'name', value: 'Bob' });

        expect(control.text).toBe('Bob');
    });

    it('should handle two-way bindings', () => {
        const data = { value: 'initial' };
        const control = { dom: { el: { value: 'initial' } } };
        const context = new BindingContext(data);

        context.apply_bindings_to_control(control, { bind: 'value' }, 'two-way');

        control.dom.el.value = 'updated';
        // Simulate input event
        control.dom.el.dispatchEvent(new Event('input'));

        expect(data.value).toBe('updated');
    });
});
```

## Conclusion

The `BindingContext` is the central orchestrator of the jsgui3 data binding system, providing a clean separation between declarative template syntax and reactive data management. Its design enables efficient, scalable reactive UI development while maintaining jsgui3's architectural integrity and performance characteristics.</content>
<parameter name="filePath">c:\Users\james\Documents\repos\jsgui3-agents-flowcharts\docs\BindingContext.md