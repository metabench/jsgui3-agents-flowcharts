# Completing Data Binding Implementation with jsgui3 Control System

## Overview

This document outlines a comprehensive approach to completing the data binding implementation in jsgui3-html by leveraging the existing control system and parse-mount templating infrastructure. Instead of implementing Virtual DOM or external templating engines, we'll build upon jsgui3's native strengths: control composition, observable data structures, and the existing HTML-like templating system.

## Current Architecture Analysis

### Existing Strengths

1. **Control System**: Rich compositional architecture with event handling and DOM manipulation
2. **Observable Data**: `Data_Value` and `Data_Object` with change events and validation
3. **ModelBinder**: Two-way binding infrastructure with transformations and computed properties
4. **Parse-Mount Templating**: HTML-like template parsing that instantiates controls from tags
5. **MVVM Foundation**: Separation of data models, view models, and controls

### Current Limitations

1. **Programmatic Binding**: Data binding is currently programmatic rather than declarative
2. **Limited Templating**: No native declarative syntax for reactive UI composition
3. **Manual Synchronization**: Requires explicit event wiring between models
4. **No Virtual DOM**: But this is actually a strength - direct DOM manipulation is more efficient

## Proposed Solution: Declarative Data Binding with Parse-Mount

### Core Concept

Leverage the existing `parse-mount` system to create declarative templates that automatically set up data bindings. Instead of Virtual DOM, use jsgui3's control composition system for efficient, direct DOM updates.

### Key Components

#### 1. Enhanced Parse-Mount with Data Binding

Extend the existing `parse-mount.js` to recognize data binding attributes in templates:

```html
<div data-bind="user.name" data-bind-mode="two-way">
  <input type="text" data-bind="user.email" placeholder="Email">
  <button data-bind-click="saveUser">Save</button>
  <ul data-bind-each="user.hobbies">
    <li data-bind="hobby.name"></li>
  </ul>
</div>
```

#### 2. Binding Context System

Create a binding context that manages the relationship between templates and data models:

```javascript
class BindingContext {
  constructor(data_model, template_context) {
    this.data_model = data_model;
    this.template_context = template_context;
    this.bindings = new Map();
    this.setup_reactive_bindings();
  }
  
  bind_control(control, binding_expression, mode = 'one-way') {
    // Parse binding expression like "user.name"
    const binding = this.parse_binding_expression(binding_expression);
    
    // Create reactive binding between the data model and the control's property
    const binder = new ModelBinder({
      source: this.data_model,
      target: control, // The target is the control itself
      property: binding.property,
      mode: mode,
      transform: binding.transform
    });
    
    this.bindings.set(control, binder);
  }
}
```

#### 3. Template Directives

Implement template directives that extend HTML with reactive capabilities:

- `data-bind`: One-way or two-way data binding
- `data-bind-each`: Iterate over collections
- `data-bind-if`: Conditional rendering
- `data-bind-click`: Event binding to methods
- `data-bind-class`: Dynamic CSS classes
- `data-bind-style`: Dynamic styles

## Implementation Details

### Phase 1: Core Binding Infrastructure

#### Enhanced ModelBinder

Extend the existing `ModelBinder.js` to support declarative bindings:

```javascript
// In html-core/ModelBinder.js

class DeclarativeBinder extends ModelBinder {
  constructor(spec) {
    super(spec);
    this.binding_expressions = spec.binding_expressions || {};
    this.setup_declarative_bindings();
  }
  
  setup_declarative_bindings() {
    Object.entries(this.binding_expressions).forEach(([element_path, expression]) => {
      const element = this.find_element_by_path(element_path);
      if (element) {
        this.bind_element(element, expression);
      }
    });
  }
  
  parse_binding_expression(expr) {
    // Parse expressions like:
    // "user.name"
    // "user.name | uppercase"
    // "user.age + ' years old'"
    
    const parts = expr.split('|').map(s => s.trim());
    const property_path = parts[0];
    const transforms = parts.slice(1);
    
    return {
      property_path: property_path,
      transforms: transforms,
      get_value: (data) => {
        let value = this.get_nested_property(data, property_path);
        transforms.forEach(transform => {
          value = this.apply_transform(value, transform);
        });
        return value;
      }
    };
  }
}
```

#### Integration with lang-mini and fnl

The data binding system leverages lang-mini utilities and fnl monitoring:

- **lang-mini utilities**: Use `each()`, `tof()`, and other functions for type checking and iteration in binding logic.
- **fnl monitoring**: Monitor reactive update functions and computed property evaluations for performance tracking.

#### ExpressionParser (Moved to lang-mini)
```javascript
// In lang-mini/ExpressionParser.js
const {each, tof} = require('lang-mini');

class ExpressionParser {
    static evaluate(expression, context) {
        // Safe evaluation with lang-mini utilities
        try {
            const fn = new Function(...Object.keys(context), `return ${expression};`);
            return fn(...Object.values(context));
        } catch (e) {
            console.error('Expression evaluation error:', expression, e);
            return '';
        }
    }
}
```

#### Template Parser Extensions

Extend `parse-mount.js` to handle binding attributes:

```javascript
// In html-core/parse-mount.js

const BINDING_ATTRIBUTES = {
  'data-bind': 'bind',
  'data-bind-each': 'each', 
  'data-bind-if': 'if',
  'data-bind-click': 'click',
  'data-bind-class': 'class',
  'data-bind-style': 'style'
};

const parse_binding_attributes = (tag_attribs) => {
  const bindings = {};
  
  Object.entries(tag_attribs).forEach(([attr_name, attr_value]) => {
    if (BINDING_ATTRIBUTES[attr_name]) {
      bindings[BINDING_ATTRIBUTES[attr_name]] = attr_value;
      delete tag_attribs[attr_name]; // Remove from regular attributes
    }
  });
  
  return bindings;
};

const create_ctrl_with_bindings = (tag, content, context, binding_context) => {
  const Ctrl = context.control_set[tag.name];
  const attribs = tag.attribs || {};
  const bindings = parse_binding_attributes(attribs);
  
  // Create control with regular attributes
  const ctrl = new Ctrl({ ...attribs, context });
  
  // Apply bindings if binding context provided
  if (binding_context && Object.keys(bindings).length > 0) {
    binding_context.apply_bindings_to_control(ctrl, bindings);
  }
  
  return ctrl;
};
```

### Phase 2: Reactive Template System

#### Control-in-Template Support

Extend templates to support jsgui3 controls directly within HTML-like markup, enabling true component-based templating:

```javascript
// Enhanced parse-mount.js with control tag recognition
const CONTROL_TAG_PATTERN = /^[a-zA-Z][a-zA-Z0-9]*(-[a-zA-Z0-9]+)*$/;

const is_control_tag = (tag_name, control_set) => {
  // Check if it's a registered control
  return control_set && control_set[tag_name] !== undefined;
};

const create_control_from_tag = (tag, content, context, binding_context) => {
  const Ctrl = context.control_set[tag.name];
  const attribs = tag.attribs || {};
  const bindings = parse_binding_attributes(attribs);
  
  // Create control with regular attributes
  const ctrl = new Ctrl({ ...attribs, context });
  
  // Apply bindings if binding context provided
  if (binding_context && Object.keys(bindings).length > 0) {
    binding_context.apply_bindings_to_control(ctrl, bindings);
  }
  
  return ctrl;
};
```

#### ControlRegistry for Component Management

```javascript
// New file: html-core/ControlRegistry.js

class ControlRegistry {
  constructor() {
    this.controls = new Map();
    this.aliases = new Map();
  }
  
  register(name, control_class, options = {}) {
    this.controls.set(name, { class: control_class, options });
    
    // Register kebab-case alias for template usage
    const kebab_name = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    if (kebab_name !== name) {
      this.aliases.set(kebab_name, name);
    }
  }
  
  get(name) {
    // Resolve alias if needed
    const resolved_name = this.aliases.get(name) || name;
    return this.controls.get(resolved_name);
  }
  
  has(name) {
    const resolved_name = this.aliases.get(name) || name;
    return this.controls.has(resolved_name);
  }
  
  // Auto-discover controls from a namespace
  register_namespace(namespace, prefix = '') {
    Object.entries(namespace).forEach(([name, control_class]) => {
      if (typeof control_class === 'function' && control_class.prototype instanceof Control) {
        const full_name = prefix ? `${prefix}-${name}` : name;
        this.register(full_name, control_class);
      }
    });
  }
}

// Global registry instance
const global_control_registry = new ControlRegistry();

// Register core jsgui3 controls
global_control_registry.register_namespace(jsgui3.controls, 'jsgui');
```

#### Enhanced TemplateControl with Component Support

```javascript
// Enhanced html-core/TemplateControl.js

class TemplateControl extends Control {
  constructor(spec) {
    super(spec);
    this.template = spec.template;
    this.data_context = spec.data_context;
    this.binding_context = null;
    this.rendered = false;
    this.control_registry = spec.control_registry || global_control_registry;
  }
  
  async render_template() {
    if (this.rendered) return;
    
    // Parse and mount template with control support
    const [depth_0_ctrls, res_controls] = await parse_mount(
      this.template, 
      this, 
      this.context.control_set,
      this.data_context,
      { control_registry: this.control_registry }
    );
    
    // Create binding context for reactive updates
    this.binding_context = new BindingContext(this.data_context, this.context);
    
    // Apply bindings to all controls
    this.apply_bindings_to_children(depth_0_ctrls);
    
    this.rendered = true;
  }
  
  // Component communication methods
  emit(event_name, data) {
    // Emit to parent template
    if (this.parent && this.parent.handle_child_event) {
      this.parent.handle_child_event(this, event_name, data);
    }
    
    // Also emit as regular control event
    this.raise(event_name, data);
  }
  
  handle_child_event(child_control, event_name, data) {
    // Bubble up to parent or handle locally
    const handler_name = `on_${child_control.constructor.name.toLowerCase()}_${event_name}`;
    if (this[handler_name]) {
      this[handler_name](child_control, data);
    } else if (this.parent && this.parent.handle_child_event) {
      this.parent.handle_child_event(child_control, event_name, data);
    }
  }
}
```

Create a base class for reactive templates:

```javascript
// New file: html-core/TemplateControl.js

class TemplateControl extends Control {
  constructor(spec) {
    super(spec);
    this.template = spec.template;
    this.data_context = spec.data_context;
    this.binding_context = null;
    this.rendered = false;
  }
  
  async render_template() {
    if (this.rendered) return;
    
    // Parse and mount template with data binding
    const [depth_0_ctrls, res_controls] = await parse_mount(
      this.template, 
      this, 
      this.context.control_set,
      this.data_context
    );
    
    // Create binding context for reactive updates
    this.binding_context = new BindingContext(this.data_context, this.context);
    
    // Apply bindings to all controls
    this.apply_bindings_to_children(depth_0_ctrls);
    
    this.rendered = true;
  }
  
  apply_bindings_to_children(controls) {
    const apply_recursive = (ctrls) => {
      ctrls.forEach(ctrl => {
        if (ctrl.binding_expressions) {
          this.binding_context.apply_bindings_to_control(ctrl, ctrl.binding_expressions);
        }
        if (ctrl.content && ctrl.content._arr) {
          apply_recursive(ctrl.content._arr);
        }
      });
    };
    apply_recursive(controls);
  }
  
  update_data_context(new_context) {
    this.data_context = new_context;
    if (this.binding_context) {
      this.binding_context.update_data_model(new_context);
    }
  }
}
```

#### Reactive Collection Binding

Implement reactive arrays for `data-bind-each`:

**Note**: For comprehensive documentation on ReactiveArray including detailed API reference, integration patterns, and Flowchart Control examples, see `docs/ReactiveArray.md`.

```javascript
// New file: html-core/ReactiveArray.js

class ReactiveArray extends Array {
  constructor(items = [], binding_context) {
    super(...items);
    this.binding_context = binding_context;
    this.item_template = null;
    this.container_control = null;
  }
  
  set_template(template, container) {
    this.item_template = template;
    this.container_control = container;
  }
  
  async render_items() {
    if (!this.item_template || !this.container_control) return;
    
    // Clear existing items
    this.container_control.clear();
    
    // Render each item
    for (let i = 0; i < this.length; i++) {
      const item_data = this[i];
      const item_context = { ...this.binding_context.data_model, item: item_data, index: i };
      
      const [item_controls] = await parse_mount(
        this.item_template,
        this.container_control,
        this.container_control.context.control_set,
        item_context
      );
      
      item_controls.forEach(ctrl => this.container_control.add(ctrl));
    }
  }
  
  push(...items) {
    const result = super.push(...items);
    this.render_items();
    return result;
  }
  
  splice(start, deleteCount, ...items) {
    const result = super.splice(start, deleteCount, ...items);
    this.render_items();
    return result;
  }
}
```

### Phase 3: API Design

#### Declarative Template API

```javascript
// Usage example
const user_form = new TemplateControl({
  template: `
    <div class="user-form">
      <h2 data-bind="'Welcome, ' + user.name + '!'"></h2>
      
      <div class="form-group">
        <label>Name:</label>
        <input type="text" data-bind="user.name" data-bind-mode="two-way">
      </div>
      
      <div class="form-group">
        <label>Email:</label>
        <input type="email" data-bind="user.email" data-bind-mode="two-way">
      </div>
      
      <div class="hobbies" data-bind-each="user.hobbies">
        <div class="hobby-item">
          <span data-bind="item.name"></span>
          <button data-bind-click="removeHobby(item)">Remove</button>
        </div>
      </div>
      
      <button data-bind-click="addHobby" data-bind-if="user.hobbies.length < 5">
        Add Hobby
      </button>
      
      <button data-bind-click="saveUser" data-bind-class="{'saving': is_saving}">
        Save Profile
      </button>
    </div>
  `,
  
  data_context: new Data_Object({
    user: new Data_Object({
      name: 'John Doe',
      email: 'john@example.com',
      hobbies: new ReactiveArray([
        { name: 'Reading' },
        { name: 'Coding' }
      ], binding_context)
    }),
    is_saving: false
  }),
  
  methods: {
    addHobby() {
      this.data_context.user.hobbies.push({ name: 'New Hobby' });
    },
    
    removeHobby(hobby) {
      const index = this.data_context.user.hobbies.indexOf(hobby);
      if (index > -1) {
        this.data_context.user.hobbies.splice(index, 1);
      }
    },
    
    async saveUser() {
      this.data_context.is_saving = true;
      try {
        await this.save_to_server(this.data_context.user);
        alert('Profile saved!');
      } finally {
        this.data_context.is_saving = false;
      }
    }
  }
});
```

#### Programmatic API

```javascript
// Alternative programmatic API
const binder = new DeclarativeBinder({
  data_model: user_data,
  template: user_form_template,
  container: document.getElementById('user-form'),
  bindings: {
    'input[name]': 'user.name',
    'input[email]': 'user.email',
    '.hobbies': {
      each: 'user.hobbies',
      template: '<li data-bind="item.name"></li>'
    }
  }
});
```

#### Control-Level Data Binding

```javascript
// Enhanced control with built-in data binding
class DataBoundControl extends Data_Model_View_Model_Control {
  constructor(spec) {
    super(spec);
    
    // Automatic binding setup
    if (spec.bindings) {
      this.setup_bindings(spec.bindings);
    }
  }
  
  setup_bindings(bindings_config) {
    Object.entries(bindings_config).forEach(([property, config]) => {
      if (typeof config === 'string') {
        // Simple property binding
        this.bind_property(property, config);
      } else {
        // Complex binding with transforms
        this.bind_property_complex(property, config);
      }
    });
  }
  
  bind_property(control_prop, data_prop) {
    // Two-way binding between control property and data model
    const binder = new ModelBinder({
      source: this.data.model,
      target: this,
      source_property: data_prop,
      target_property: control_prop
    });
    
    // Handle control changes
    this.on('change', e => {
      if (e.name === control_prop) {
        this.data.model[data_prop] = e.value;
      }
    });
  }
}
```

## Examples

### Example 1: User Profile Form

```javascript
// Data model
const user_data = new Data_Object({
  name: 'Alice Johnson',
  email: 'alice@example.com',
  age: 28,
  active: true,
  preferences: new Data_Object({
    theme: 'dark',
    notifications: true
  })
});

// Template control
const profile_form = new TemplateControl({
  template: `
    <div class="profile-form">
      <div class="field">
        <label>Name:</label>
        <input type="text" data-bind="name" data-bind-mode="two-way">
      </div>
      
      <div class="field">
        <label>Email:</label>
        <input type="email" data-bind="email" data-bind-mode="two-way">
      </div>
      
      <div class="field">
        <label>Age:</label>
        <input type="number" data-bind="age" data-bind-mode="two-way">
      </div>
      
      <div class="field">
        <label>
          <input type="checkbox" data-bind="active" data-bind-mode="two-way">
          Active User
        </label>
      </div>
      
      <div class="preferences">
        <h3>Preferences</h3>
        
        <div class="field">
          <label>Theme:</label>
          <select data-bind="preferences.theme" data-bind-mode="two-way">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        
        <div class="field">
          <label>
            <input type="checkbox" data-bind="preferences.notifications" data-bind-mode="two-way">
            Enable Notifications
          </label>
        </div>
      </div>
      
      <div class="actions">
        <button data-bind-click="save">Save Changes</button>
        <button data-bind-click="reset">Reset</button>
      </div>
    </div>
  `,
  
  data_context: user_data,
  
  methods: {
    save() {
      console.log('Saving user data:', this.data_context.toObject());
      // Save to server...
    },
    
    reset() {
      this.data_context.set(user_data.get_original_data());
    }
  }
});

// Mount to page
page_context.add(profile_form);
profile_form.render_template();
```

### Example 2: Todo List with Reactive Collections

```javascript
// Data model with reactive array
const todo_data = new Data_Object({
  todos: new ReactiveArray([
    { id: 1, text: 'Learn jsgui3', completed: false },
    { id: 2, text: 'Build reactive UI', completed: true },
    { id: 3, text: 'Master data binding', completed: false }
  ], binding_context),
  filter: 'all' // all, active, completed
});

// Computed properties
const filtered_todos = new ComputedProperty(() => {
  const todos = todo_data.todos;
  const filter = todo_data.filter;
  
  switch (filter) {
    case 'active': return todos.filter(t => !t.completed);
    case 'completed': return todos.filter(t => t.completed);
    default: return todos;
  }
}, [todo_data.todos, todo_data.filter]);

// Template control
const todo_app = new TemplateControl({
  template: `
    <div class="todo-app">
      <h1>Todo App</h1>
      
      <div class="add-todo">
        <input type="text" placeholder="What needs to be done?" 
               data-bind="new_todo_text" data-bind-mode="two-way">
        <button data-bind-click="add_todo">Add Todo</button>
      </div>
      
      <div class="filters">
        <button data-bind-click="set_filter('all')" 
                data-bind-class="{'active': filter === 'all'}">All</button>
        <button data-bind-click="set_filter('active')" 
                data-bind-class="{'active': filter === 'active'}">Active</button>
        <button data-bind-click="set_filter('completed')" 
                data-bind-class="{'active': filter === 'completed'}">Completed</button>
      </div>
      
      <ul class="todo-list" data-bind-each="filtered_todos">
        <li data-bind-class="{'completed': item.completed}">
          <input type="checkbox" data-bind="item.completed" data-bind-mode="two-way">
          <span data-bind="item.text" 
                data-bind-class="{'completed-text': item.completed}"></span>
          <button data-bind-click="remove_todo(item)">×</button>
        </li>
      </ul>
      
      <div class="stats">
        <span data-bind="todos.filter(t => !t.completed).length + ' items left'"></span>
      </div>
    </div>
  `,
  
  data_context: new Data_Object({
    todos: todo_data.todos,
    filtered_todos: filtered_todos,
    filter: todo_data.filter,
    new_todo_text: ''
  }),
  
  methods: {
    add_todo() {
      if (this.data_context.new_todo_text.trim()) {
        this.data_context.todos.push({
          id: Date.now(),
          text: this.data_context.new_todo_text.trim(),
          completed: false
        });
        this.data_context.new_todo_text = '';
      }
    },
    
    remove_todo(todo) {
      const index = this.data_context.todos.indexOf(todo);
      if (index > -1) {
        this.data_context.todos.splice(index, 1);
      }
    },
    
    set_filter(filter) {
      this.data_context.filter = filter;
    }
  }
});
```

### Example 4: Control-in-Template - Flowchart Builder

```javascript
// Register custom controls for the flowchart builder
const flowchart_registry = new ControlRegistry();

// Register core controls
flowchart_registry.register_namespace(jsgui3.controls, 'jsgui');

// Register custom flowchart controls
flowchart_registry.register('flowchart-node', FlowchartNode);
flowchart_registry.register('flowchart-connection', FlowchartConnection);
flowchart_registry.register('flowchart-canvas', FlowchartCanvas);

// Data model for flowchart
const flowchart_data = new Data_Object({
  nodes: new ReactiveArray([
    { id: 'start', type: 'start', label: 'Start Process', x: 100, y: 100 },
    { id: 'task1', type: 'task', label: 'Process Data', x: 100, y: 200 },
    { id: 'decision', type: 'decision', label: 'Data Valid?', x: 100, y: 300 },
    { id: 'end', type: 'end', label: 'End Process', x: 100, y: 400 }
  ]),
  connections: new ReactiveArray([
    { from: 'start', to: 'task1' },
    { from: 'task1', to: 'decision' },
    { from: 'decision', to: 'end', label: 'Yes' }
  ]),
  selected_node: null,
  zoom: 1.0
});

// Template control with embedded controls
const flowchart_builder = new TemplateControl({
  template: `
    <div class="flowchart-builder">
      <div class="toolbar">
        <jsgui-button data-bind-click="add_node('task')" label="Add Task"></jsgui-button>
        <jsgui-button data-bind-click="add_node('decision')" label="Add Decision"></jsgui-button>
        <jsgui-button data-bind-click="delete_selected" 
                      data-bind-if="selected_node" label="Delete Selected"></jsgui-button>
        <span class="zoom-controls">
          Zoom: <input type="range" min="0.5" max="2" step="0.1" 
                       data-bind="zoom" data-bind-mode="two-way">
          <span data-bind="Math.round(zoom * 100) + '%'"></span>
        </span>
      </div>
      
      <flowchart-canvas class="canvas" 
                        data-bind="nodes" 
                        data-bind-connections="connections"
                        data-bind-selected="selected_node"
                        data-bind-zoom="zoom"
                        data-bind-on-node-select="select_node"
                        data-bind-on-node-move="move_node"
                        data-bind-on-connection-create="create_connection">
        
        <!-- Nodes rendered as controls within the canvas -->
        <div data-bind-each="nodes">
          <flowchart-node data-bind-id="item.id"
                          data-bind-type="item.type"
                          data-bind-label="item.label"
                          data-bind-x="item.x"
                          data-bind-y="item.y"
                          data-bind-selected="selected_node === item.id"
                          data-bind-on-select="select_node(item)"
                          data-bind-on-move="move_node(item, $event)">
          </flowchart-node>
        </div>
        
        <!-- Connections as controls -->
        <div data-bind-each="connections">
          <flowchart-connection data-bind-from="item.from"
                                data-bind-to="item.to"
                                data-bind-label="item.label"
                                data-bind-on-edit="edit_connection(item)">
          </flowchart-connection>
        </div>
        
      </flowchart-canvas>
      
      <div class="properties-panel" data-bind-if="selected_node">
        <h3>Properties</h3>
        <div class="property-group">
          <label>Label:</label>
          <input type="text" 
                 data-bind="selected_node_data.label" 
                 data-bind-mode="two-way">
        </div>
        
        <div class="property-group" data-bind-if="selected_node_data.type === 'task'">
          <label>Task Type:</label>
          <select data-bind="selected_node_data.task_type" data-bind-mode="two-way">
            <option value="manual">Manual</option>
            <option value="auto">Automatic</option>
            <option value="service">Service Call</option>
          </select>
        </div>
        
        <div class="property-group">
          <label>Position:</label>
          <input type="number" placeholder="X" 
                 data-bind="selected_node_data.x" data-bind-mode="two-way">
          <input type="number" placeholder="Y" 
                 data-bind="selected_node_data.y" data-bind-mode="two-way">
        </div>
      </div>
    </div>
  `,
  
  data_context: new Data_Object({
    nodes: flowchart_data.nodes,
    connections: flowchart_data.connections,
    selected_node: flowchart_data.selected_node,
    zoom: flowchart_data.zoom,
    selected_node_data: new ComputedProperty(() => {
      const selected_id = flowchart_data.selected_node;
      return selected_id ? flowchart_data.nodes.find(n => n.id === selected_id) : null;
    }, [flowchart_data.selected_node, flowchart_data.nodes])
  }),
  
  control_registry: flowchart_registry,
  
  methods: {
    add_node(type) {
      const new_node = {
        id: `node_${Date.now()}`,
        type: type,
        label: `New ${type}`,
        x: Math.random() * 400 + 50,
        y: Math.random() * 300 + 50
      };
      
      if (type === 'task') {
        new_node.task_type = 'manual';
      }
      
      this.data_context.nodes.push(new_node);
    },
    
    delete_selected() {
      if (this.data_context.selected_node) {
        const index = this.data_context.nodes.findIndex(n => n.id === this.data_context.selected_node);
        if (index > -1) {
          this.data_context.nodes.splice(index, 1);
          this.data_context.selected_node = null;
        }
      }
    },
    
    select_node(node) {
      this.data_context.selected_node = node.id;
    },
    
    move_node(node, event) {
      node.x = event.x;
      node.y = event.y;
    },
    
    create_connection(from_id, to_id) {
      // Check if connection already exists
      const existing = this.data_context.connections.find(c => 
        c.from === from_id && c.to === to_id
      );
      
      if (!existing) {
        this.data_context.connections.push({
          from: from_id,
          to: to_id,
          label: ''
        });
      }
    },
    
    edit_connection(connection) {
      const new_label = prompt('Connection label:', connection.label || '');
      if (new_label !== null) {
        connection.label = new_label;
      }
    }
  }
});

// Mount the flowchart builder
page_context.add(flowchart_builder);
flowchart_builder.render_template();
```

```javascript
// Data model
const grid_data = new Data_Object({
  items: new ReactiveArray([
    { id: 1, name: 'Alice', age: 25, city: 'New York' },
    { id: 2, name: 'Bob', age: 30, city: 'London' },
    { id: 3, name: 'Charlie', age: 35, city: 'Paris' }
  ]),
  sort_column: null,
  sort_direction: 'asc',
  page: 1,
  page_size: 10,
  total_items: 3
});

// Computed sorted and paginated items
const sorted_items = new ComputedProperty(() => {
  const items = [...grid_data.items];
  const { sort_column, sort_direction } = grid_data;
  
  if (sort_column) {
    items.sort((a, b) => {
      let a_val = a[sort_column];
      let b_val = b[sort_column];
      
      if (typeof a_val === 'string') {
        a_val = a_val.toLowerCase();
        b_val = b_val.toLowerCase();
      }
      
      if (a_val < b_val) return sort_direction === 'asc' ? -1 : 1;
      if (a_val > b_val) return sort_direction === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  return items;
}, [grid_data.items, grid_data.sort_column, grid_data.sort_direction]);

const paginated_items = new ComputedProperty(() => {
  const start = (grid_data.page - 1) * grid_data.page_size;
  return sorted_items.value.slice(start, start + grid_data.page_size);
}, [sorted_items, grid_data.page, grid_data.page_size]);

// Template control
const data_grid = new TemplateControl({
  template: `
    <div class="data-grid">
      <table>
        <thead>
          <tr>
            <th data-bind-click="sort_by('name')">
              Name 
              <span data-bind-if="sort_column === 'name'">
                <span data-bind-if="sort_direction === 'asc'">↑</span>
                <span data-bind-if="sort_direction === 'desc'">↓</span>
              </span>
            </th>
            <th data-bind-click="sort_by('age')">
              Age
              <span data-bind-if="sort_column === 'age'">
                <span data-bind-if="sort_direction === 'asc'">↑</span>
                <span data-bind-if="sort_direction === 'desc'">↓</span>
              </span>
            </th>
            <th data-bind-click="sort_by('city')">City</th>
          </tr>
        </thead>
        <tbody data-bind-each="paginated_items">
          <tr>
            <td data-bind="item.name"></td>
            <td data-bind="item.age"></td>
            <td data-bind="item.city"></td>
          </tr>
        </tbody>
      </table>
      
      <div class="pagination">
        <button data-bind-click="prev_page" 
                data-bind-if="page > 1">Previous</button>
        
        <span data-bind="'Page ' + page + ' of ' + Math.ceil(total_items / page_size)"></span>
        
        <button data-bind-click="next_page" 
                data-bind-if="page < Math.ceil(total_items / page_size)">Next</button>
      </div>
    </div>
  `,
  
  data_context: new Data_Object({
    items: grid_data.items,
    sorted_items: sorted_items,
    paginated_items: paginated_items,
    sort_column: grid_data.sort_column,
    sort_direction: grid_data.sort_direction,
    page: grid_data.page,
    page_size: grid_data.page_size,
    total_items: grid_data.total_items
  }),
  
  methods: {
    sort_by(column) {
      if (this.data_context.sort_column === column) {
        this.data_context.sort_direction = 
          this.data_context.sort_direction === 'asc' ? 'desc' : 'asc';
      } else {
        this.data_context.sort_column = column;
        this.data_context.sort_direction = 'asc';
      }
    },
    
    prev_page() {
      if (this.data_context.page > 1) {
        this.data_context.page--;
      }
    },
    
    next_page() {
      const max_page = Math.ceil(this.data_context.total_items / this.data_context.page_size);
      if (this.data_context.page < max_page) {
        this.data_context.page++;
      }
    }
  }
});
```

## Benefits of This Approach

### 1. **Leverages Existing Strengths**
- Uses jsgui3's proven control system instead of external dependencies
- Builds on existing observable data structures
- Extends parse-mount templating naturally

### 2. **No Virtual DOM Overhead**
- Direct DOM manipulation through control composition
- More efficient than diffing algorithms for typical use cases
- Maintains jsgui3's architectural consistency

### 3. **Declarative Yet Powerful**
- HTML-like templates with binding directives
- Supports complex expressions and transformations
- Maintains programmatic access when needed

### 4. **Isomorphic Ready**
- Works on both server and client
- Consistent behavior across environments
- Leverages existing serialization systems

### 6. **Control-in-Template Composition**
- Direct embedding of jsgui3 controls within HTML-like templates
- Component-based architecture with `<jsgui-button>`, `<flowchart-node>`, etc.
- Registry-based control discovery and instantiation
- Props/emit pattern for component communication
- Maintains control lifecycle and event handling

## Implementation Roadmap

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Extend ModelBinder with declarative binding support
- [ ] Enhance parse-mount to recognize binding attributes
- [ ] Create BindingContext class
- [ ] Implement basic data-bind directive
- [ ] Create ControlRegistry for component management

### Phase 2: Template Directives (Week 3-4)
- [ ] Implement data-bind-each for collections
- [ ] Add data-bind-if for conditional rendering
- [ ] Create data-bind-click for event binding
- [ ] Add data-bind-class and data-bind-style
- [ ] Extend parse-mount for control tag recognition

### Phase 3: Reactive Collections (Week 5-6)
- [ ] Implement ReactiveArray class
- [ ] Add support for array mutations (push, splice, etc.)
- [ ] Create computed properties system
- [ ] Optimize rendering performance
- [ ] Enhance TemplateControl with component support

### Phase 4: Control-in-Template Integration (Week 7-8)
- [ ] Implement control tag parsing and instantiation
- [ ] Add props/emit communication pattern
- [ ] Create component lifecycle management
- [ ] Add control registry integration
- [ ] Implement nested component contexts

### Phase 5: Testing and Optimization (Week 9-10)
- [ ] Write unit tests for all components
- [ ] Performance benchmarking
- [ ] Browser compatibility testing
- [ ] Create example applications

## Conclusion

This approach completes the data binding implementation by building upon jsgui3's existing strengths rather than introducing external dependencies. By extending the parse-mount templating system with declarative data binding capabilities, we create a powerful, efficient, and maintainable reactive UI framework that stays true to jsgui3's architectural principles.

The result is a system that provides the declarative convenience of modern frameworks while maintaining the performance and control benefits of direct DOM manipulation through jsgui3's compositional architecture.