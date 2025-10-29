# Data Binding Requirements Document

## Overview

This document outlines the current data binding capabilities within the jsgui3 ecosystem, assesses their suitability for advanced data binding scenarios, and specifies requirements for enhancing data binding functionality. The focus is on enabling reactive, declarative data binding by extending jsgui3's existing control system and parse-mount templating infrastructure, rather than introducing external dependencies or Virtual DOM.

## Current Data Binding Functionality in node_modules

### Existing Capabilities

#### 1. Core Data Models (lang-tools)
- **Data_Value**: Observable value container with validation, type checking, and change events
- **Data_Object**: Observable object with property tracking and change notifications
- **Data_Model**: Base class for data structures with field definitions

Key features:
- Event-driven change notifications (`change` events)
- Type validation and constraints
- Field/property definitions with `field()` and `prop()` functions
- Immutable variants for certain use cases

#### 2. jsgui3-html Data Binding System
- **ModelBinder**: Declarative two-way data binding between models
- **ComputedProperty**: Reactive computed values based on dependencies
- **PropertyWatcher**: Change watchers for specific properties
- **BindingManager**: Orchestrates multiple bindings for controls

Key features:
- Bidirectional binding with transformation functions
- Computed properties with automatic dependency tracking
- Property watching with callbacks
- Binding lifecycle management (activate/deactivate)

#### 3. Control-Level Integration
- **Data_Model_View_Model_Control**: Base class for controls with data/view model separation
- Control data synchronization patterns
- DOM attribute-based model references (`data-jsgui-data-model`, `data-jsgui-view-model`)

#### 4. Parse-Mount Templating System
- **parse-mount.js**: HTML-like template parsing and control instantiation
- Control creation from HTML tags with attribute mapping
- Depth-first recursive control composition
- DOM mounting and activation system

#### 5. lang-mini Utilities
- **Expression Evaluation**: Safe JavaScript expression parsing for template bindings (proposed enhancement)
- **Type Checking**: Advanced type detection with `tof()` and `tf()` functions
- **Iteration Utilities**: `each()` function for collections
- **Functional Helpers**: Various utility functions for data manipulation

#### 6. fnl Functional Monitoring
- **Function IO Monitoring**: Track input/output of reactive update functions
- **Evented Function Calls**: Monitor computed property evaluations and data transformations
- **Performance Tracking**: Measure execution times of reactive operations
- **Reactive Operation Monitoring**: Use fnl to monitor data binding updates and computed property recalculations for debugging and performance optimization

### Assessment of Current Capabilities

#### Strengths
- **Observable Foundation**: Strong event-driven architecture with Data_Value/Data_Object
- **Two-Way Binding**: ModelBinder provides robust bidirectional synchronization
- **Computed Properties**: Dependency-tracked reactive computations
- **Type Safety**: Built-in validation and type checking
- **Control Integration**: Seamless integration with jsgui3 control lifecycle
- **Templating System**: Existing parse-mount provides HTML-like template parsing
- **Control Composition**: Efficient direct DOM manipulation through control hierarchy

#### Limitations
- **Template Syntax**: No declarative data binding attributes in parse-mount templates
- **Directive System**: No built-in directives for common binding patterns
- **Reactive Collections**: Limited support for observable arrays in templates
- **Expression Evaluation**: No safe JavaScript expression evaluation in templates
- **Component Communication**: Limited props/emit patterns for control composition

## Revised Requirements: Leveraging Existing Architecture

### Target Syntax Patterns

#### 1. Enhanced Parse-Mount Templates
```html
<!-- Leverage existing parse-mount with data binding attributes -->
<div class="user-form">
  <input type="text" data-bind="user.name" data-bind-mode="two-way" />
  <span data-bind="user.name"></span>
  <button data-bind-click="increment">Count: <span data-bind="count"></span></button>
  <ul data-bind-each="user.hobbies">
    <li data-bind="item.name"></li>
  </ul>
</div>
```

#### 2. Reactive Data Declaration (Building on Existing Patterns)
```javascript
// Current jsgui3 pattern (enhanced)
this.data = new Data_Object({
    user: new Data_Object({
        name: new Data_Value('John'),
        hobbies: new ReactiveArray(['Reading', 'Coding'])
    }),
    count: new Data_Value(0)
});

// Simplified reactive helper
this.data = reactive({
    user: {
        name: 'John',
        hobbies: ['Reading', 'Coding']
    },
    count: 0
});
```

#### 3. Template Control Composition
```javascript
// Extend existing control patterns
class UserForm extends TemplateControl {
    constructor(spec) {
        super(spec);
        
        this.template = `
            <div class="user-form">
                <input type="text" data-bind="user.name" data-bind-mode="two-way" />
                <button data-bind-click="save">Save</button>
            </div>
        `;
        
        this.data_context = reactive({
            user: { name: 'John' }
        });
        
        this.methods = {
            save: () => this.saveUser()
        };
    }
}
```

### Required Features for Enhanced Data Binding

#### 1. Parse-Mount Extensions
- **Binding Attributes**: Extend parse-mount to recognize `data-bind-*` attributes
- **Expression Evaluation**: Safe JavaScript expression parsing for template bindings
- **Reactive Context**: Binding context management for template-to-data synchronization
- **Control Composition**: Enhanced control instantiation with reactive data binding

#### 2. Enhanced Reactivity (Building on Existing Systems)
- **Deep Reactivity**: Extend Data_Value/Data_Object with nested property tracking
- **Reactive Arrays**: Observable array mutations for `data-bind-each`
- **Computed Properties**: Enhanced computed values with automatic dependency tracking
- **Change Batching**: Efficient batching of multiple simultaneous changes

#### 3. Template Directive System
- **data-bind**: One-way and two-way data binding
- **data-bind-each**: Reactive list rendering with automatic DOM updates
- **data-bind-if**: Conditional rendering based on reactive conditions
- **data-bind-click**: Method binding for event handlers
- **data-bind-class**: Dynamic CSS class binding
- **data-bind-style**: Dynamic style binding

#### 4. Component Communication Patterns
- **Props System**: Declarative property passing between controls
- **Emit System**: Event emission from child to parent controls
- **Context Sharing**: Reactive data sharing through control hierarchy
- **Method Binding**: Template access to control methods

#### 5. Performance Optimizations (Leveraging Control Architecture)
- **Selective Updates**: Fine-grained DOM updates through control composition. When a data property changes, only the corresponding control property is updated, and the control handles its own minimal DOM change.
- **Change Detection**: Efficient dirty checking using existing event system in `lang-tools`.
- **Control Lifecycle**: Optimized activation/deactivation of reactive bindings, managed by the control's lifecycle.
- **Memory Management**: Automatic cleanup of bindings and watchers when controls are removed or deactivated.

## Data Binding Needs for the Flowchart Control

The proposed data binding system is particularly well-suited for a `Flowchart` control. The ability to bind data models directly to control properties allows for an efficient and declarative way to manage the flowchart's state.

### Key Requirements:

1.  **Node Collection Binding**:
    - The system must support binding an array of node data objects from a `Data_Object` to a collection of `Flowchart_Node` controls within the main `Flowchart` control.
    - This should use the `data-bind-each` directive, which will reactively add, remove, or update node controls as the underlying data array changes.

2.  **Node Property Binding**:
    - For each `Flowchart_Node` control, its core properties must be bindable to the corresponding data object in the array.
    - **Position**: `style.left` and `style.top` of the node control should be bound to `x` and `y` properties in the data model. This is critical for enabling drag-and-drop functionality where updating the model repositions the control.
    - **Text/Content**: The `text` or `content` of the node should be bindable.
    - **Style/State**: Attributes like `class` or specific styles should be bindable to reflect the node's state (e.g., `selected`, `invalid`).

3.  **Connection Collection Binding**:
    - Similar to nodes, an array of connection data objects must be bindable to a collection of `Flowchart_Connection` controls.
    - The `data-bind-each` directive will manage the lifecycle of these connection controls.

4.  **Connection Property Binding**:
    - Each `Flowchart_Connection` control needs to bind to the source and destination of the connection.
    - This involves binding properties like `from_node_id`, `to_node_id`, and potentially specific connector points on those nodes.
    - When a node's position changes, the connection controls that are linked to it must automatically update their rendering to stay connected. This can be achieved by having the `Flowchart_Connection` control observe the position of the nodes it connects.

### Example Flowchart Data Model:

```javascript
const flowchart_data = reactive({
    nodes: [
        { id: 'node-1', text: 'Start', x: 50, y: 100, type: 'start' },
        { id: 'node-2', text: 'Process Step 1', x: 250, y: 100, type: 'process' }
    ],
    connections: [
        { from: 'node-1', to: 'node-2', from_port: 'right', to_port: 'left' }
    ]
});
```

By using this data model with `TemplateControl` and the proposed binding directives, the `Flowchart` control can be rendered and manipulated efficiently by simply changing the `flowchart_data` object.

## Implementation Requirements in Existing Libraries

### lang-tools Enhancements

#### 1. Enhanced Data_Value/Data_Object
```javascript
// Required additions to Data_Value.js
class Data_Value {
    // Add deep reactivity tracking
    static reactive(obj) {
        return new ReactiveProxy(obj);
    }
    
    // Add computed property support
    computed(dependencies, computeFn) {
        return new ComputedProperty(this, dependencies, computeFn);
    }
    
    // Add watcher support
    watch(callback, options) {
        return new PropertyWatcher(this, callback, options);
    }
}
```

#### 2. Reactive Proxy System (Compatible with Existing Architecture)
- **ReactiveProxy**: ES6 Proxy-based reactivity for plain objects
- **Deep Tracking**: Automatic nested property observation
- **Array Reactivity**: Observable array mutations (push, splice, etc.)
- **Integration**: Works with existing Data_Value/Data_Object patterns

#### 3. Expression Parser (Safe Template Evaluation)
- **JavaScript Expression Parser**: Safe evaluation of template expressions
- **Scope Resolution**: Context-aware variable resolution
- **Error Handling**: Graceful handling of invalid expressions

### jsgui3-html Enhancements

#### 1. Parse-Mount Extensions
```javascript
// Enhanced parse-mount.js
const parse_binding_attributes = (tag_attribs) => {
    const bindings = {};
    
    Object.entries(tag_attribs).forEach(([attr_name, attr_value]) => {
        if (attr_name.startsWith('data-bind')) {
            const directive = attr_name.replace('data-bind-', '').replace('data-bind', 'bind');
            bindings[directive] = attr_value;
            delete tag_attribs[attr_name]; // Remove from regular attributes
        }
    });
    
    return bindings;
};

const parse_mount_reactive = async function(str_content, target, control_set, data_context) {
    // Extended parse-mount with reactive binding support
    const result = await parse_mount(str_content, target, control_set);
    const binding_context = new BindingContext(data_context, target.context);
    
    // Apply reactive bindings to instantiated controls
    result.controls.forEach(ctrl => {
        if (ctrl.binding_expressions) {
            binding_context.apply_bindings_to_control(ctrl, ctrl.binding_expressions);
        }
    });
    
    return { controls: result.controls, binding_context };
};
```

#### 2. Binding Context System
```javascript
// New BindingContext class
class BindingContext {
    constructor(data_model, template_context) {
        this.data_model = data_model;
        this.template_context = template_context;
        this.bindings = new Map();
        this.control_bindings = new Map();
        this.setup_reactive_bindings();
    }
    
    apply_bindings_to_control(ctrl, bindings) {
        // Apply data-bind, data-bind-click, etc. to controls
    }
    
    handle_data_change(change_event) {
        // Update bound controls when data changes
    }
}
```

#### 3. Template Control Base Class
```javascript
// New TemplateControl class extending Control
class TemplateControl extends Control {
    constructor(spec) {
        super(spec);
        this.template = spec.template;
        this.data_context = spec.data_context;
        this.methods = spec.methods || {};
    }
    
    async render_template() {
        const result = await parse_mount_reactive(
            this.template, 
            this, 
            this.context.control_set,
            this.data_context
        );
        
        this.binding_context = result.binding_context;
        this.rendered = true;
    }
}
```

#### 4. Reactive Array for Collections
```javascript
// New ReactiveArray class
class ReactiveArray extends Array {
    constructor(items = [], binding_context) {
        super(...items);
        this.binding_context = binding_context;
        this.item_template = null;
        this.container_control = null;
    }
    
    async render_items() {
        // Reactive rendering of array items using parse-mount
    }
    
    push(...items) {
        const result = super.push(...items);
        this.render_items(); // Reactive update
        return result;
    }
}
```

### Implementation Priority

#### Phase 1: Core Reactivity Extensions
1. Enhance Data_Value/Data_Object with reactive methods
2. Implement ReactiveProxy compatible with existing patterns
3. Add computed property and watcher utilities

#### Phase 2: Parse-Mount Reactive Extensions
1. Extend parse-mount.js with binding attribute recognition
2. Create BindingContext for template-to-data synchronization
3. Implement basic data-bind directive

#### Phase 3: Template Control System
1. Create TemplateControl base class
2. Implement ReactiveArray for collections
3. Add ExpressionParser for safe template evaluation

#### Phase 4: Advanced Template Directives
1. Add data-bind-if for conditional rendering
2. Implement data-bind-each for reactive collections
3. Add data-bind-click for method binding
4. Create data-bind-class and data-bind-style

#### Phase 5: Component Communication
1. Add props system for control communication
2. Implement emit system for child-to-parent events
3. Add comprehensive testing and documentation

### Migration Strategy

#### Backward Compatibility
- Existing ModelBinder and binding patterns remain fully functional
- New reactive template syntax is completely opt-in
- Gradual migration path for existing controls
- No breaking changes to current API

#### Integration Points
- Extend existing Control class with TemplateControl capabilities
- Maintain compatibility with current data model patterns
- Allow seamless mixing of programmatic and declarative approaches

### Testing and Validation

#### Unit Tests
- Reactive proxy behavior with existing Data_Value/Data_Object
- Parse-mount binding attribute recognition
- Expression evaluation safety
- Template control instantiation

#### Integration Tests
- End-to-end reactive template scenarios
- Control communication patterns
- Performance benchmarks vs existing approaches

#### Compatibility Tests
- Existing jsgui3 applications continue to work unchanged
- Cross-browser functionality
- Memory leak detection in reactive bindings

This revised requirements document focuses on extending jsgui3's existing architectural strengths - particularly the parse-mount templating system and control composition - rather than introducing external dependencies. This approach provides modern reactive capabilities while maintaining jsgui3's performance advantages and architectural consistency.